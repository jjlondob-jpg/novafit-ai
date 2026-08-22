/**
 * app.js
 * Punto de entrada. Conecta todos los módulos vía EventBus y maneja el
 * requestAnimationFrame loop principal.
 */
import { EventBus, $ } from './utils.js';
import { CameraManager, CAMERA_ERROR_MESSAGES } from './camera.js';
import { PoseEngine, evaluateFraming } from './pose.js';
import { SegmentationEngine } from './segmentation.js';
import { GarmentEngine } from './garment-engine.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';

const bus = new EventBus();
const ui = new UI(bus);

// Estado leve expuesto globalmente para que módulos independientes (como
// js/chatbot.js) puedan leer contexto sin acoplarse al resto de la app.
window.NovafitState = { selectedGarment: null };

// Backend Nivel 3 (FastAPI + Replicate). Cambia esto si despliegas el
// backend en otra URL/puerto.
const AI_BACKEND_URL = 'http://localhost:8001';

const video = $('#camera-video');
const canvas = $('#render-canvas');

const camera = new CameraManager(video, bus);
const poseEngine = new PoseEngine(bus);
const segmentationEngine = new SegmentationEngine(bus);
const garmentEngine = new GarmentEngine();
const renderer = new Renderer({ video, canvas, garmentEngine });

let catalog = [];
let categories = [];
let currentCategory = 'tshirt';
let loadedImages = new Map(); // id -> HTMLImageElement
let selectedGarment = null; // {meta, image}
let running = false;
let rafId = null;
let lastGoodLandmarks = null;
let segEveryNFrames = 2; // el human parsing es más costoso: se corre cada N frames
let frameCount = 0;
let lastParsingMask = null;

async function loadCatalog() {
  const res = await fetch('garments/catalog.json');
  const data = await res.json();
  catalog = data.items;
  categories = data.categories;
  ui.renderCategoryTabs(categories, onSelectCategory);
  applyCategory(categories[0]?.id || 'tshirt');
}

function applyCategory(categoryId) {
  currentCategory = categoryId;
  ui.setActiveTab(categoryId);
  const filtered = catalog.filter((item) => item.category === categoryId);
  ui.renderGarments(filtered, onSelectGarment);
  ui.markGarmentActive(selectedGarment?.meta.id || null);
}

function onSelectCategory(categoryId) {
  applyCategory(categoryId);
}

function preloadImage(item) {
  return new Promise((resolve, reject) => {
    if (loadedImages.has(item.id)) return resolve(loadedImages.get(item.id));
    const img = new Image();
    img.onload = () => {
      loadedImages.set(item.id, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error('GARMENT_IMAGE_NOT_FOUND: ' + item.image));
    img.src = item.image;
  });
}

async function onSelectGarment(item) {
  try {
    const img = await preloadImage(item);
    selectedGarment = { meta: item, image: img };
    renderer.setGarment(item, img);
    ui.markGarmentActive(item.id);
    window.NovafitState.selectedGarment = item; // expuesto para el chatbot (js/chatbot.js)
  } catch (err) {
    ui.showError('No se pudo cargar la imagen de la prenda: ' + item.name);
    console.error(err);
  }
}

function onRemoveGarment() {
  selectedGarment = null;
  renderer.setGarment(null, null);
  ui.markGarmentActive(null);
  window.NovafitState.selectedGarment = null;
}

async function startExperience() {
  ui.showApp();

  if (!CameraManager.isSecureContext()) {
    ui.showError(CAMERA_ERROR_MESSAGES.INSECURE_CONTEXT);
    return;
  }

  try {
    await camera.start('user');
  } catch (err) {
    ui.showError(CAMERA_ERROR_MESSAGES[err.message] || CAMERA_ERROR_MESSAGES.UNKNOWN_CAMERA_ERROR);
    return;
  }

  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());

  ui.setCameraStatus(true);

  try {
    await Promise.all([poseEngine.init(), segmentationEngine.init()]);
  } catch (err) {
    ui.showError('No se pudieron cargar los modelos de IA (pose/segmentación). Revisa tu conexión a internet.');
    console.error(err);
    return;
  }

  ui.setAiStatus(true);
  running = true;
  loop();
}

function stopExperience() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  camera.stop();
  ui.setCameraStatus(false);
  ui.setAiStatus(false);
  ui.setBodyStatus('NOT_DETECTED', '');
}

function loop() {
  if (!running) return;
  const now = performance.now();
  frameCount++;

  const poseResult = poseEngine.detectForVideo(video, now);
  if (poseResult && poseResult.landmarks && poseResult.landmarks.length > 0) {
    lastGoodLandmarks = poseResult.landmarks[0];
    const framing = evaluateFraming(lastGoodLandmarks);
    ui.setBodyStatus(framing.status, framing.message);
  } else if (poseResult && poseResult.landmarks && poseResult.landmarks.length === 0) {
    lastGoodLandmarks = null;
    ui.setBodyStatus('NOT_DETECTED', 'Body not detected');
  }

  if (frameCount % segEveryNFrames === 0) {
    // "parsing mask": mapa de categorías (fondo/piel/ropa/etc), ver segmentation.js
    const mask = segmentationEngine.segmentForVideo(video, now);
    if (mask) lastParsingMask = mask;
  }

  renderer.drawFrame(lastGoodLandmarks, lastParsingMask);
  ui.setFps(renderer.fps);

  rafId = requestAnimationFrame(loop);
}

// --- Bindings de UI -> acciones ---
bus.on('ui:start', startExperience);
bus.on('ui:stop', stopExperience);
bus.on('ui:switch-camera', () => camera.switchCamera());
bus.on('ui:toggle-mirror', () => {
  renderer.mirror = !renderer.mirror;
  ui.setMirrorButtonState(renderer.mirror);
});
bus.on('ui:toggle-skeleton', () => {
  renderer.showSkeleton = !renderer.showSkeleton;
  ui.setSkeletonButtonState(renderer.showSkeleton);
});
bus.on('ui:fullscreen', () => {
  const stage = $('#camera-stage');
  if (!document.fullscreenElement) stage.requestFullscreen?.();
  else document.exitFullscreen?.();
});
bus.on('ui:remove-garment', onRemoveGarment);
bus.on('ui:take-photo', () => {
  const dataUrl = renderer.captureSnapshot();
  ui.showPhotoModal(dataUrl);
});
bus.on('ui:generate-photoreal', generatePhotoreal);

bus.on('camera:error', (err) => {
  ui.showError(CAMERA_ERROR_MESSAGES[err.message] || CAMERA_ERROR_MESSAGES.UNKNOWN_CAMERA_ERROR);
});

// --- Nivel 3: generación fotorrealista vía backend + modelo de difusión ---
async function generatePhotoreal() {
  if (!running) {
    ui.showError('Inicia la cámara primero.');
    return;
  }
  if (!selectedGarment) {
    ui.showError('Selecciona una prenda antes de generar la versión con IA.');
    return;
  }

  const personImage = renderer.captureRawPerson();

  ui.showPhotoLoading('Generando con IA... esto puede tardar 15-25 segundos');

  try {
    const healthRes = await fetch(`${AI_BACKEND_URL}/api/health`).catch(() => null);
    if (!healthRes || !healthRes.ok) {
      throw new Error('BACKEND_UNREACHABLE');
    }

    const res = await fetch(`${AI_BACKEND_URL}/api/vto/photoreal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person_image_base64: personImage,
        garment_id: selectedGarment.meta.id,
        garment_description: `${selectedGarment.meta.name}, cotton t-shirt`,
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.detail || `HTTP_${res.status}`);
    }

    const data = await res.json();
    if (data.status !== 'succeeded' || (!data.image_url && !data.image_base64)) {
      throw new Error(data.error || 'GENERATION_FAILED');
    }

    ui.showPhotoModal(data.image_url || data.image_base64);
  } catch (err) {
    ui.hidePhotoModal();
    if (err.message === 'BACKEND_UNREACHABLE') {
      ui.showError(
        'No se pudo conectar con el backend de IA (¿está corriendo en http://localhost:8001? ver backend/README).'
      );
    } else {
      ui.showError('No se pudo generar la imagen con IA: ' + err.message);
    }
    console.error(err);
  }
}

// --- Init ---
(async function init() {
  ui.setMirrorButtonState(true);
  try {
    await loadCatalog();
  } catch (err) {
    ui.showError('No se pudo cargar el catálogo de prendas (garments/tshirts/catalog.json).');
    console.error(err);
  }

  if (!CameraManager.isSupported()) {
    ui.showError(CAMERA_ERROR_MESSAGES.UNSUPPORTED_BROWSER);
  }
})();
