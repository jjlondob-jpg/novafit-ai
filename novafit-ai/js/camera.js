/**
 * camera.js
 * Encapsula todo el acceso a getUserMedia: permisos, listado/cambio de
 * dispositivos y errores. No sabe nada de pose ni de renderizado.
 */
export class CameraManager {
  /**
   * @param {HTMLVideoElement} videoEl
   * @param {import('./utils.js').EventBus} bus
   */
  constructor(videoEl, bus) {
    this.video = videoEl;
    this.bus = bus;
    this.stream = null;
    this.devices = [];
    this.currentDeviceId = null;
  }

  /** true si el navegador puede exponer cámara en este contexto. */
  static isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /** true si estamos en un contexto seguro (localhost o https). Sin esto, getUserMedia falla siempre. */
  static isSecureContext() {
    return window.isSecureContext === true;
  }

  async listDevices() {
    // enumerateDevices solo da labels después de tener permiso concedido al
    // menos una vez; por eso se vuelve a llamar tras start().
    const all = await navigator.mediaDevices.enumerateDevices();
    this.devices = all.filter((d) => d.kind === 'videoinput');
    return this.devices;
  }

  async start(preferFacingMode = 'user', deviceId = null) {
    if (!CameraManager.isSupported()) {
      const err = new Error('UNSUPPORTED_BROWSER');
      this.bus.emit('camera:error', err);
      throw err;
    }
    if (!CameraManager.isSecureContext()) {
      const err = new Error('INSECURE_CONTEXT');
      this.bus.emit('camera:error', err);
      throw err;
    }

    this.stop();

    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 960 } }
        : { facingMode: preferFacingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // Normaliza el catálogo de errores del navegador a algo que la UI
      // pueda mapear a un mensaje amigable.
      const code = this._mapGetUserMediaError(err);
      const wrapped = new Error(code);
      wrapped.original = err;
      this.bus.emit('camera:error', wrapped);
      throw wrapped;
    }

    this.video.srcObject = this.stream;
    await this.video.play();

    const track = this.stream.getVideoTracks()[0];
    this.currentDeviceId = track?.getSettings?.().deviceId || deviceId;

    await this.listDevices();
    this.bus.emit('camera:ready', {
      deviceId: this.currentDeviceId,
      devices: this.devices,
      width: this.video.videoWidth,
      height: this.video.videoHeight,
    });
  }

  async switchCamera() {
    if (this.devices.length < 2) return;
    const idx = this.devices.findIndex((d) => d.deviceId === this.currentDeviceId);
    const next = this.devices[(idx + 1) % this.devices.length];
    await this.start('user', next.deviceId);
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.bus.emit('camera:stopped');
  }

  _mapGetUserMediaError(err) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'PERMISSION_DENIED';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'NO_CAMERA_FOUND';
      case 'NotReadableError':
        return 'CAMERA_IN_USE';
      default:
        return 'UNKNOWN_CAMERA_ERROR';
    }
  }
}

export const CAMERA_ERROR_MESSAGES = {
  UNSUPPORTED_BROWSER: 'Este navegador no soporta acceso a cámara (getUserMedia). Usa Chrome, Edge o Firefox actualizados.',
  INSECURE_CONTEXT: 'La cámara requiere HTTPS o localhost. Abrir el archivo directamente (file://) no funciona.',
  PERMISSION_DENIED: 'Permiso de cámara denegado. Habilítalo en la configuración del navegador para este sitio.',
  NO_CAMERA_FOUND: 'No se encontró ninguna cámara conectada.',
  CAMERA_IN_USE: 'La cámara está siendo usada por otra aplicación.',
  UNKNOWN_CAMERA_ERROR: 'No se pudo acceder a la cámara por un error desconocido.',
};
