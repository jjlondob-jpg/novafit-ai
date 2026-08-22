/**
 * utils.js
 * Funciones puras compartidas por el resto de módulos.
 * Sin dependencias externas.
 */

/** Suaviza un valor escalar u objeto {x,y,z} mediante EMA (exponential moving average). */
export class ExponentialSmoother {
  /**
   * @param {number} alpha - factor de suavizado (0-1). Más alto = responde más
   *                          rápido pero más "nervioso". Más bajo = más estable
   *                          pero con más latencia.
   */
  constructor(alpha = 0.35) {
    this.alpha = alpha;
    this._value = null;
  }

  next(sample) {
    if (this._value === null) {
      this._value = { ...sample };
      return this._value;
    }
    const a = this.alpha;
    for (const key of Object.keys(sample)) {
      this._value[key] = a * sample[key] + (1 - a) * this._value[key];
    }
    return this._value;
  }

  reset() {
    this._value = null;
  }
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function angleBetween(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * Calcula la transformación afín 2D (escala x/y independiente + rotación +
 * traslación) que lleva tres puntos de origen (src) a tres puntos destino (dst).
 * Se resuelve el sistema lineal 2x3 exacto (3 puntos -> solución única, sin
 * necesidad de mínimos cuadrados).
 * Devuelve una matriz en formato usable directamente por
 * CanvasRenderingContext2D.setTransform(a, b, c, d, e, f).
 */
export function computeAffineFromTriangles(src, dst) {
  // src/dst: arrays de 3 puntos {x,y}
  const [s0, s1, s2] = src;
  const [d0, d1, d2] = dst;

  const A = [
    [s0.x, s0.y, 1, 0, 0, 0],
    [0, 0, 0, s0.x, s0.y, 1],
    [s1.x, s1.y, 1, 0, 0, 0],
    [0, 0, 0, s1.x, s1.y, 1],
    [s2.x, s2.y, 1, 0, 0, 0],
    [0, 0, 0, s2.x, s2.y, 1],
  ];
  const B = [d0.x, d0.y, d1.x, d1.y, d2.x, d2.y];

  const sol = solveLinearSystem(A, B);
  if (!sol) return null;

  const [a, c, e, b, d, f] = sol; // reordenado a convención canvas: a,b,c,d,e,f
  return { a, b, c, d, e, f };
}

/** Eliminación gaussiana simple para sistemas pequeños (6x6 en nuestro caso). */
function solveLinearSystem(A, B) {
  const n = A.length;
  const M = A.map((row, i) => [...row, B[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-9) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const pivotVal = M[col][col];
    for (let k = col; k <= n; k++) M[col][k] /= pivotVal;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let k = col; k <= n; k++) M[r][k] -= factor * M[col][k];
    }
  }
  return M.map((row) => row[n]);
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/** Simple event bus para desacoplar módulos (camera/pose/ui/etc). */
export class EventBus {
  constructor() {
    this._listeners = new Map();
  }
  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
    return () => this._listeners.get(event).delete(cb);
  }
  emit(event, payload) {
    (this._listeners.get(event) || []).forEach((cb) => cb(payload));
  }
}
