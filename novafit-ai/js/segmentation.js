/**
 * segmentation.js — NIVEL 2
 *
 * Antes usaba selfie_segmenter (máscara binaria persona/fondo). Ahora usa
 * selfie_multiclass_256x256, un modelo de "human parsing" liviano que separa
 * la persona en categorías: fondo, cabello, piel del cuerpo, piel del
 * rostro, ropa y otros (accesorios).
 *
 * Esto nos da DOS máscaras útiles:
 *   - personMask: cualquier categoría != background -> recorta la silueta
 *     exterior (igual que antes).
 *   - skinMask: categoría "body-skin" (brazos/manos/piernas expuestas) ->
 *     se usa para "recortar" la camiseta donde haya piel real por delante,
 *     logrando oclusión aproximada de brazos.
 *
 * HONESTIDAD TÉCNICA: esto sigue siendo una máscara 2D por categoría, no una
 * reconstrucción 3D del brazo. Funciona muy bien cuando el brazo (piel
 * expuesta) cruza el torso; NO resuelve mangas largas cruzando el torso
 * (tela sobre tela), porque ahí ambas regiones se clasifican como "ropa" y
 * el modelo no sabe cuál capa está delante. Eso sí requeriría profundidad
 * (depth estimation) o un modelo 3D — Nivel 3.
 */
import {
  FilesetResolver,
  ImageSegmenter,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

// Índices de categoría del modelo selfie_multiclass_256x256 (según el model
// card oficial de MediaPipe). Si en tu prueba visual notas que la oclusión
// no coincide con los brazos, es la primera constante a revisar/ajustar.
export const PARSING_CLASSES = {
  BACKGROUND: 0,
  HAIR: 1,
  BODY_SKIN: 2,
  FACE_SKIN: 3,
  CLOTHES: 4,
  OTHERS: 5,
};

export class SegmentationEngine {
  constructor(bus) {
    this.bus = bus;
    this.segmenter = null;
    this.ready = false;
    this._lastVideoTime = -1;
  }

  async init() {
    const fileset = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    this.segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });

    this.ready = true;
    this.bus.emit('segmentation:ready');
  }

  /**
   * Devuelve { data, width, height } con el mapa de categorías crudo
   * (un byte por pixel = índice de PARSING_CLASSES), o null si no hay frame
   * nuevo / el modelo no está listo. El renderer decide qué categorías usar
   * para cada propósito (silueta vs. oclusión de piel).
   */
  segmentForVideo(videoEl, timestampMs) {
    if (!this.ready) return null;
    if (videoEl.currentTime === this._lastVideoTime) return null;
    this._lastVideoTime = videoEl.currentTime;

    const result = this.segmenter.segmentForVideo(videoEl, timestampMs);
    const categoryMask = result.categoryMask; // MPMask
    if (!categoryMask) return null;

    const maskData = categoryMask.getAsUint8Array();
    const w = categoryMask.width;
    const h = categoryMask.height;
    categoryMask.close();

    return { data: maskData, width: w, height: h };
  }

  close() {
    this.segmenter?.close();
    this.ready = false;
  }
}
