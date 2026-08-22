/**
 * pose.js
 * Pose estimation en navegador usando MediaPipe Tasks Vision (PoseLandmarker).
 * Corre vía WASM/GPU delegate directamente en el cliente: ningún frame sale
 * del dispositivo del usuario.
 *
 * Índices de landmarks relevantes (33 puntos, formato MediaPipe Pose):
 *   11 left_shoulder   12 right_shoulder
 *   23 left_hip        24 right_hip
 *   13 left_elbow      14 right_elbow
 *   0  nose
 */
import {
  FilesetResolver,
  PoseLandmarker,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

export const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

export class PoseEngine {
  constructor(bus) {
    this.bus = bus;
    this.landmarker = null;
    this.ready = false;
    this._running = false;
    this._lastVideoTime = -1;
  }

  async init() {
    const fileset = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    this.ready = true;
    this.bus.emit('pose:ready');
  }

  /**
   * Debe llamarse una vez por frame (dentro del loop de requestAnimationFrame
   * del renderer). Devuelve el resultado crudo de MediaPipe o null si no hay
   * frame nuevo / el modelo no está listo.
   */
  detectForVideo(videoEl, timestampMs) {
    if (!this.ready) return null;
    if (videoEl.currentTime === this._lastVideoTime) return null; // frame repetido
    this._lastVideoTime = videoEl.currentTime;

    const result = this.landmarker.detectForVideo(videoEl, timestampMs);
    return result;
  }

  close() {
    this.landmarker?.close();
    this.ready = false;
  }
}

/**
 * Evalúa la calidad del encuadre a partir de los landmarks normalizados
 * (0-1 respecto al frame) para dar feedback tipo "Move backward" / "Perfect position".
 */
export function evaluateFraming(landmarks) {
  if (!landmarks) return { status: 'NOT_DETECTED', message: 'Body not detected' };

  const ls = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
  const rs = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
  const lh = landmarks[POSE_LANDMARKS.LEFT_HIP];
  const rh = landmarks[POSE_LANDMARKS.RIGHT_HIP];

  const minVisibility = Math.min(
    ls?.visibility ?? 0,
    rs?.visibility ?? 0,
    lh?.visibility ?? 0,
    rh?.visibility ?? 0
  );
  if (minVisibility < 0.5) {
    return { status: 'PARTIAL', message: 'Body not fully visible' };
  }

  const shoulderWidth = Math.abs(rs.x - ls.x);
  const nearEdge =
    ls.x < 0.03 || rs.x > 0.97 || ls.y < 0.02 || lh.y > 0.98 || rh.y > 0.98;

  if (nearEdge) {
    return { status: 'OUT_OF_FRAME', message: 'Move backward' };
  }
  if (shoulderWidth > 0.55) {
    return { status: 'TOO_CLOSE', message: 'Move backward' };
  }
  if (shoulderWidth < 0.12) {
    return { status: 'TOO_FAR', message: 'Move closer' };
  }
  return { status: 'GOOD', message: 'Perfect position' };
}
