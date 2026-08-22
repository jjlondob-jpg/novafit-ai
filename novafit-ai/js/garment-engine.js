/**
 * garment-engine.js
 *
 * Calcula la malla de 2 triángulos (piecewise-affine warp, ver notas de
 * versiones anteriores) que posiciona una prenda sobre el cuerpo detectado.
 *
 * NOVEDAD: generalizado para soportar dos REGIONES del cuerpo, no solo el
 * torso. Cada prenda del catálogo declara `region: "upper_body"` (camisetas,
 * camisas, chaquetas, hoodies — usa hombros arriba, cadera abajo) o
 * `region: "lower_body"` (jeans — usa cadera arriba, tobillos abajo). El
 * álgebra es idéntica en ambos casos; solo cambian qué landmarks de pose se
 * usan como "esquinas" del quad. Esto es lo que permite agregar más
 * categorías de prenda sin tocar renderer.js ni el resto del pipeline.
 *
 * Los anchors del catálogo ahora usan nombres genéricos:
 *   top_left, top_right, bottom_left, bottom_right
 * (antes eran shoulder_left/hip_left, específicos de camisetas).
 */
import { ExponentialSmoother, computeAffineFromTriangles } from './utils.js';
import { POSE_LANDMARKS } from './pose.js';

const REGIONS = {
  upper_body: {
    topLeft: POSE_LANDMARKS.LEFT_SHOULDER,
    topRight: POSE_LANDMARKS.RIGHT_SHOULDER,
    bottomLeft: POSE_LANDMARKS.LEFT_HIP,
    bottomRight: POSE_LANDMARKS.RIGHT_HIP,
  },
  lower_body: {
    topLeft: POSE_LANDMARKS.LEFT_HIP,
    topRight: POSE_LANDMARKS.RIGHT_HIP,
    bottomLeft: POSE_LANDMARKS.LEFT_ANKLE,
    bottomRight: POSE_LANDMARKS.RIGHT_ANKLE,
  },
};

export class GarmentEngine {
  constructor() {
    this.topLSmoother = new ExponentialSmoother(0.4);
    this.topRSmoother = new ExponentialSmoother(0.4);
    this.bottomLSmoother = new ExponentialSmoother(0.25); // punto inferior: más ruidoso, menos reactivo
    this.bottomRSmoother = new ExponentialSmoother(0.25);
    this._lastValidMesh = null; // "congela" la última malla buena si el frame actual es degenerado
    this._lastRegion = null;
  }

  reset() {
    this.topLSmoother.reset();
    this.topRSmoother.reset();
    this.bottomLSmoother.reset();
    this.bottomRSmoother.reset();
    this._lastValidMesh = null;
    this._lastRegion = null;
  }

  _triangleArea(p1, p2, p3) {
    return 0.5 * Math.abs((p2.x - p1.x) * (p3.y - p1.y) - (p3.x - p1.x) * (p2.y - p1.y));
  }

  /**
   * @param {Array} landmarks
   * @param {{width:number,height:number}} canvasSize
   * @param {object} garment - entrada del catálogo, debe traer .region y .anchors
   * @returns {{triangleA, triangleB, rotation, twist, quad}|null}
   */
  computeMesh(landmarks, canvasSize, garment) {
    const region = REGIONS[garment.region] || REGIONS.upper_body;

    // Si cambiamos de prenda/región desde el último frame, no tiene sentido
    // reutilizar la malla congelada de la región anterior (ej. pasar de una
    // camiseta a un jean) — se reinicia el smoothing.
    if (this._lastRegion !== garment.region) {
      this.reset();
      this._lastRegion = garment.region;
    }

    if (!landmarks) return this._lastValidMesh;

    const topLeftRaw = landmarks[region.topLeft];
    const topRightRaw = landmarks[region.topRight];
    const bottomLeftRaw = landmarks[region.bottomLeft];
    const bottomRightRaw = landmarks[region.bottomRight];
    if (!topLeftRaw || !topRightRaw || !bottomLeftRaw || !bottomRightRaw) return this._lastValidMesh;

    const MIN_VISIBILITY = 0.6;
    const minVis = Math.min(
      topLeftRaw.visibility ?? 1,
      topRightRaw.visibility ?? 1,
      bottomLeftRaw.visibility ?? 1,
      bottomRightRaw.visibility ?? 1
    );
    if (minVis < MIN_VISIBILITY) return this._lastValidMesh;

    const toPx = (p) => ({ x: p.x * canvasSize.width, y: p.y * canvasSize.height });

    const topL = this.topLSmoother.next(toPx(topLeftRaw));
    const topR = this.topRSmoother.next(toPx(topRightRaw));
    const bottomL = this.bottomLSmoother.next(toPx(bottomLeftRaw));
    const bottomR = this.bottomRSmoother.next(toPx(bottomRightRaw));

    const a = garment.anchors;
    const srcTopL = { x: a.top_left[0], y: a.top_left[1] };
    const srcTopR = { x: a.top_right[0], y: a.top_right[1] };
    const srcBottomL = { x: a.bottom_left[0], y: a.bottom_left[1] };
    const srcBottomR = { x: a.bottom_right[0], y: a.bottom_right[1] };

    const MIN_AREA_RATIO = 0.01;
    const canvasArea = canvasSize.width * canvasSize.height;
    const areaA = this._triangleArea(topL, topR, bottomL);
    const areaB = this._triangleArea(topR, bottomR, bottomL);
    if (areaA < canvasArea * MIN_AREA_RATIO || areaB < canvasArea * MIN_AREA_RATIO) {
      return this._lastValidMesh;
    }

    const matA = computeAffineFromTriangles([srcTopL, srcTopR, srcBottomL], [topL, topR, bottomL]);
    const matB = computeAffineFromTriangles([srcTopR, srcBottomR, srcBottomL], [topR, bottomR, bottomL]);
    if (!matA || !matB) return this._lastValidMesh;

    const scaleOf = (m) => Math.hypot(m.a, m.b) + Math.hypot(m.c, m.d);
    const MAX_SCALE = 20;
    if (!isFinite(scaleOf(matA)) || !isFinite(scaleOf(matB)) || scaleOf(matA) > MAX_SCALE || scaleOf(matB) > MAX_SCALE) {
      return this._lastValidMesh;
    }

    const rotation = Math.atan2(topR.y - topL.y, topR.x - topL.x);
    const topWidth = Math.abs(topR.x - topL.x);
    const bottomWidth = Math.abs(bottomR.x - bottomL.x);
    const twist = topWidth > 1 ? (bottomWidth - topWidth) / topWidth : 0;

    const mesh = {
      triangleA: { src: [srcTopL, srcTopR, srcBottomL], dst: [topL, topR, bottomL], matrix: matA },
      triangleB: { src: [srcTopR, srcBottomR, srcBottomL], dst: [topR, bottomR, bottomL], matrix: matB },
      rotation,
      twist,
      quad: { lTop: topL, rTop: topR, lBottom: bottomL, rBottom: bottomR },
    };
    this._lastValidMesh = mesh;
    return mesh;
  }
}
