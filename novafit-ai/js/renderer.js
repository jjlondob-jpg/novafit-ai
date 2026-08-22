/**
 * renderer.js — NIVEL 2
 * Bucle de render en requestAnimationFrame. Por frame:
 *   1. Dibuja el video (mirror opcional).
 *   2. Dibuja la prenda en DOS triángulos independientes (mesh warp), cada
 *      uno con su propia transformación afín — ver garment-engine.js.
 *   3. Recorta la prenda a la silueta de la persona (segmentación).
 *   4. Aplica un sombreado procedural sutil según la rotación del torso
 *      (aproximación visual de volumen, NO física real).
 *   5. Redibuja la piel real (brazos/manos/cuello) por ENCIMA de la prenda
 *      donde el "human parsing" detecta piel — esto es lo que logra que un
 *      brazo cruzando el torso oculte la camiseta correctamente.
 *
 * Reutiliza canvases offscreen fijos para no generar presión sobre el GC.
 */
import { PARSING_CLASSES } from './segmentation.js';

export class Renderer {
  constructor({ video, canvas, garmentEngine }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.garmentEngine = garmentEngine;

    this.mirror = true;
    this.showSkeleton = false;
    this.currentGarment = null; // { meta, image }

    // --- Buffers offscreen reutilizados (creados una sola vez) ---
    this._maskCanvas = document.createElement('canvas'); // silueta persona (recorte exterior)
    this._maskCtx = this._maskCanvas.getContext('2d');
    this._maskImageData = null;

    this._skinMaskCanvas = document.createElement('canvas'); // piel expuesta (oclusión)
    this._skinMaskCtx = this._skinMaskCanvas.getContext('2d');
    this._skinMaskImageData = null;

    this._garmentCanvas = document.createElement('canvas'); // prenda ya recortada+sombreada
    this._garmentCtx = this._garmentCanvas.getContext('2d');

    this._skinLayerCanvas = document.createElement('canvas'); // video recortado a piel
    this._skinLayerCtx = this._skinLayerCanvas.getContext('2d');

    this._fpsCounter = { frames: 0, last: performance.now(), value: 0 };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    [this._maskCanvas, this._skinMaskCanvas, this._garmentCanvas, this._skinLayerCanvas].forEach((c) => {
      c.width = this.canvas.width;
      c.height = this.canvas.height;
    });
  }

  setGarment(meta, image) {
    this.currentGarment = meta && image ? { meta, image } : null;
    this.garmentEngine.reset();
  }

  /**
   * @param {Array|null} landmarks
   * @param {{data:Uint8Array,width:number,height:number}|null} parsingMask - mapa de categorías crudo (ver PARSING_CLASSES)
   */
  drawFrame(landmarks, parsingMask) {
    const { ctx, canvas, video } = this;
    if (!video.videoWidth) return;

    ctx.save();
    if (this.mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    this._drawCover(ctx, video, video.videoWidth, video.videoHeight, canvas.width, canvas.height);
    ctx.restore();

    if (this.currentGarment && landmarks) {
      this._drawGarmentWithMesh(landmarks, parsingMask);
    }

    if (this.showSkeleton && landmarks) {
      this._drawSkeleton(landmarks);
    }

    this._tickFps();
  }

  _drawCover(ctx, source, sw, sh, dw, dh) {
    const scale = Math.max(dw / sw, dh / sh);
    const w = sw * scale;
    const h = sh * scale;
    const x = (dw - w) / 2;
    const y = (dh - h) / 2;
    ctx.drawImage(source, x, y, w, h);
  }

  _mirrorMatrix(m, width) {
    return { a: -m.a, b: m.b, c: -m.c, d: m.d, e: width - m.e, f: m.f };
  }

  _mirrorPoint(p, width) {
    return { x: width - p.x, y: p.y };
  }

  _drawGarmentWithMesh(landmarks, parsingMask) {
    const { meta, image } = this.currentGarment;
    const canvasSize = { width: this.canvas.width, height: this.canvas.height };
    const mesh = this.garmentEngine.computeMesh(landmarks, canvasSize, meta);
    if (!mesh) return;

    const gctx = this._garmentCtx;
    const W = this._garmentCanvas.width;
    gctx.save();
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.clearRect(0, 0, W, this._garmentCanvas.height);
    gctx.globalAlpha = 0.97;

    [mesh.triangleA, mesh.triangleB].forEach((tri) => {
      const dst = this.mirror ? tri.dst.map((p) => this._mirrorPoint(p, W)) : tri.dst;
      const matrix = this.mirror ? this._mirrorMatrix(tri.matrix, W) : tri.matrix;

      gctx.save();
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.beginPath();
      gctx.moveTo(dst[0].x, dst[0].y);
      gctx.lineTo(dst[1].x, dst[1].y);
      gctx.lineTo(dst[2].x, dst[2].y);
      gctx.closePath();
      gctx.clip();

      gctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
      gctx.drawImage(image, 0, 0);
      gctx.restore();
    });
    gctx.globalAlpha = 1;

    // --- Sombreado procedural (aproximación de volumen, NO simulación física) ---
    this._applyProceduralShading(mesh, W);

    // --- Recorte a silueta exterior + máscaras de piel para oclusión ---
    if (parsingMask) {
      this._applySilhouetteClip(parsingMask);
    }

    this.ctx.drawImage(this._garmentCanvas, 0, 0);

    // --- Oclusión: redibuja piel real ENCIMA de la prenda ---
    if (parsingMask) {
      this._drawSkinOcclusion(parsingMask);
    }
  }

  _applyProceduralShading(mesh, W) {
    const gctx = this._garmentCtx;
    const dst = this.mirror
      ? {
          lTop: this._mirrorPoint(mesh.quad.lTop, W),
          rTop: this._mirrorPoint(mesh.quad.rTop, W),
        }
      : mesh.quad;

    const left = Math.min(dst.lTop.x, dst.rTop.x);
    const right = Math.max(dst.lTop.x, dst.rTop.x);
    if (right - left < 4) return;

    // twist > 0 sugiere torso rotado hacia un lado -> oscurecemos ese lado
    // ligeramente para sugerir profundidad. Es un truco visual, no una
    // reconstrucción real de la geometría de la tela.
    const twist = mesh.twist || 0;
    const intensity = Math.min(Math.abs(twist) * 0.6, 0.22);
    if (intensity < 0.02) return;

    const gradient = gctx.createLinearGradient(left, 0, right, 0);
    const darkSideIsMirroredLeft = this.mirror ? twist > 0 : twist < 0;
    if (darkSideIsMirroredLeft) {
      gradient.addColorStop(0, `rgba(0,0,0,${intensity})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, `rgba(0,0,0,${intensity})`);
    }

    gctx.save();
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.globalCompositeOperation = 'source-atop'; // solo pinta sobre pixeles ya opacos de la prenda
    gctx.fillStyle = gradient;
    gctx.fillRect(0, 0, this._garmentCanvas.width, this._garmentCanvas.height);
    gctx.restore();
  }

  _buildCategoryAlphaMask(parsingMask, ctx, imageDataRef, matchFn) {
    const { width: mw, height: mh, data } = parsingMask;
    const outW = ctx.canvas.width;
    const outH = ctx.canvas.height;

    let imageData = imageDataRef;
    if (!imageData || imageData.width !== outW || imageData.height !== outH) {
      imageData = ctx.createImageData(outW, outH);
    }
    const out = imageData.data;

    for (let y = 0; y < outH; y++) {
      const srcY = Math.floor((y / outH) * mh);
      const rowOffset = srcY * mw;
      for (let x = 0; x < outW; x++) {
        const srcX = Math.floor((x / outW) * mw);
        const category = data[rowOffset + srcX];
        const idx = (y * outW + x) * 4;
        const on = matchFn(category);
        out[idx] = 255;
        out[idx + 1] = 255;
        out[idx + 2] = 255;
        out[idx + 3] = on ? 255 : 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return imageData;
  }

  _applySilhouetteClip(parsingMask) {
    this._maskImageData = this._buildCategoryAlphaMask(
      parsingMask,
      this._maskCtx,
      this._maskImageData,
      (cat) => cat !== PARSING_CLASSES.BACKGROUND
    );

    const gctx = this._garmentCtx;
    gctx.save();
    gctx.globalCompositeOperation = 'destination-in';
    gctx.setTransform(this.mirror ? -1 : 1, 0, 0, 1, this.mirror ? this._garmentCanvas.width : 0, 0);
    gctx.drawImage(this._maskCanvas, 0, 0);
    gctx.restore();
  }

  _drawSkinOcclusion(parsingMask) {
    this._skinMaskImageData = this._buildCategoryAlphaMask(
      parsingMask,
      this._skinMaskCtx,
      this._skinMaskImageData,
      (cat) => cat === PARSING_CLASSES.BODY_SKIN || cat === PARSING_CLASSES.FACE_SKIN
    );

    // 1. Copiar el video (ya espejado igual que el frame principal) a un canvas temporal
    const slctx = this._skinLayerCtx;
    const W = this._skinLayerCanvas.width;
    const H = this._skinLayerCanvas.height;
    slctx.save();
    slctx.setTransform(1, 0, 0, 1, 0, 0);
    slctx.clearRect(0, 0, W, H);
    if (this.mirror) {
      slctx.translate(W, 0);
      slctx.scale(-1, 1);
    }
    this._drawCover(slctx, this.video, this.video.videoWidth, this.video.videoHeight, W, H);
    slctx.restore();

    // 2. Recortar ese canvas a la máscara de piel (que viene sin espejar del modelo)
    slctx.save();
    slctx.globalCompositeOperation = 'destination-in';
    slctx.setTransform(this.mirror ? -1 : 1, 0, 0, 1, this.mirror ? W : 0, 0);
    slctx.drawImage(this._skinMaskCanvas, 0, 0);
    slctx.restore();

    // 3. Pintar la piel recortada directamente sobre el canvas principal, encima de la prenda
    this.ctx.drawImage(this._skinLayerCanvas, 0, 0);
  }

  _drawSkeleton(landmarks) {
    const { ctx, canvas } = this;
    const pairs = [
      [11, 12], [11, 23], [12, 24], [23, 24],
      [11, 13], [13, 15], [12, 14], [14, 16],
    ];
    ctx.save();
    if (this.mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.strokeStyle = 'rgba(0, 230, 168, 0.8)';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(0, 230, 168, 0.9)';
    pairs.forEach(([i, j]) => {
      const a = landmarks[i];
      const b = landmarks[j];
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
      ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
      ctx.stroke();
    });
    [11, 12, 23, 24].forEach((i) => {
      const p = landmarks[i];
      if (!p) return;
      ctx.beginPath();
      ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  _tickFps() {
    const c = this._fpsCounter;
    c.frames++;
    const now = performance.now();
    if (now - c.last >= 500) {
      c.value = Math.round((c.frames * 1000) / (now - c.last));
      c.frames = 0;
      c.last = now;
    }
  }

  get fps() {
    return this._fpsCounter.value;
  }

  captureSnapshot() {
    return this.canvas.toDataURL('image/png');
  }

  /**
   * Captura SOLO el frame de video real (sin la prenda superpuesta), en el
   * mismo estado de espejo actual. Esta es la foto que se envía al backend
   * de IA generativa (Nivel 3) — el modelo necesita la persona "limpia",
   * no nuestra versión con overlay 2D.
   */
  captureRawPerson() {
    const tmp = document.createElement('canvas');
    tmp.width = this.canvas.width;
    tmp.height = this.canvas.height;
    const tctx = tmp.getContext('2d');
    if (this.mirror) {
      tctx.translate(tmp.width, 0);
      tctx.scale(-1, 1);
    }
    this._drawCover(tctx, this.video, this.video.videoWidth, this.video.videoHeight, tmp.width, tmp.height);
    return tmp.toDataURL('image/jpeg', 0.92);
  }
}
