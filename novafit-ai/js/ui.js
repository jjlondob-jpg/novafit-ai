/**
 * ui.js
 * Todo lo que toca el DOM fuera del canvas de render: pantallas, badges de
 * estado, panel de prendas, controles y modal de foto.
 */
import { $, $all } from './utils.js';

export class UI {
  constructor(bus) {
    this.bus = bus;

    this.welcomeScreen = $('#welcome-screen');
    this.appScreen = $('#app-screen');
    this.startBtn = $('#start-btn');

    this.statusCameraBadge = $('#status-camera');
    this.statusAiBadge = $('#status-ai');
    this.statusBodyBadge = $('#status-body');
    this.guidanceText = $('#guidance-text');
    this.fpsCounter = $('#fps-counter');

    this.errorBanner = $('#error-banner');
    this.errorMessage = $('#error-message');
    this.errorClose = $('#error-close');

    this.garmentGrid = $('#garment-grid');
    this.categoryTabs = $('#category-tabs');
    this.removeGarmentBtn = $('#remove-garment-btn');

    this.btnStop = $('#btn-stop-camera');
    this.btnSwitch = $('#btn-switch-camera');
    this.btnMirror = $('#btn-mirror');
    this.btnFullscreen = $('#btn-fullscreen');
    this.btnPhoto = $('#btn-take-photo');
    this.btnSkeleton = $('#btn-skeleton');
    this.btnPhotoreal = $('#btn-photoreal');

    this.photoModal = $('#photo-modal');
    this.photoImg = $('#photo-result');
    this.photoLoading = $('#photo-loading');
    this.photoLoadingText = $('#photo-loading-text');
    this.btnRetake = $('#btn-retake');
    this.btnTryAnother = $('#btn-try-another');

    this._bindStaticEvents();
  }

  _bindStaticEvents() {
    this.startBtn.addEventListener('click', () => this.bus.emit('ui:start'));
    this.errorClose.addEventListener('click', () => this.hideError());
    this.btnStop.addEventListener('click', () => this.bus.emit('ui:stop'));
    this.btnSwitch.addEventListener('click', () => this.bus.emit('ui:switch-camera'));
    this.btnMirror.addEventListener('click', () => this.bus.emit('ui:toggle-mirror'));
    this.btnFullscreen.addEventListener('click', () => this.bus.emit('ui:fullscreen'));
    this.btnPhoto.addEventListener('click', () => this.bus.emit('ui:take-photo'));
    this.btnSkeleton.addEventListener('click', () => this.bus.emit('ui:toggle-skeleton'));
    this.btnPhotoreal.addEventListener('click', () => this.bus.emit('ui:generate-photoreal'));
    this.removeGarmentBtn.addEventListener('click', () => this.bus.emit('ui:remove-garment'));
    this.btnRetake.addEventListener('click', () => this.hidePhotoModal());
    this.btnTryAnother.addEventListener('click', () => {
      this.hidePhotoModal();
      this.bus.emit('ui:remove-garment');
    });
  }

  showApp() {
    this.welcomeScreen.classList.add('hidden');
    this.appScreen.classList.remove('hidden');
  }

  renderGarments(items, onSelect) {
    this.garmentGrid.innerHTML = '';
    if (items.length === 0) {
      this.garmentGrid.innerHTML = '<p class="empty-category">Todavía no hay prendas en esta categoría.</p>';
      return;
    }
    items.forEach((item) => {
      const card = document.createElement('button');
      card.className = 'garment-card';
      card.setAttribute('data-id', item.id);
      card.innerHTML = `
        <span class="garment-swatch" style="background:${item.colorHex}"></span>
        <img src="${item.image}" alt="${item.name}" loading="lazy" />
        <span class="garment-name">${item.name}</span>
        <span class="garment-try">PROBAR</span>
      `;
      card.addEventListener('click', () => onSelect(item));
      this.garmentGrid.appendChild(card);
    });
  }

  markGarmentActive(id) {
    $all('.garment-card', this.garmentGrid).forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-id') === id);
    });
    this.removeGarmentBtn.disabled = !id;
  }

  renderCategoryTabs(categories, onSelect) {
    this.categoryTabs.innerHTML = '';
    categories.forEach((cat) => {
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.type = 'button';
      btn.textContent = cat.label;
      btn.setAttribute('data-category', cat.id);
      btn.addEventListener('click', () => onSelect(cat.id));
      this.categoryTabs.appendChild(btn);
    });
  }

  setActiveTab(categoryId) {
    $all('.tab', this.categoryTabs).forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-category') === categoryId);
    });
  }

  setCameraStatus(ready) {
    this.statusCameraBadge.classList.toggle('badge-on', ready);
    this.statusCameraBadge.textContent = ready ? 'Camera Ready' : 'Camera Off';
  }

  setAiStatus(active) {
    this.statusAiBadge.classList.toggle('badge-on', active);
    this.statusAiBadge.textContent = active ? 'AI Active' : 'AI Idle';
  }

  setBodyStatus(status, message) {
    this.statusBodyBadge.classList.toggle('badge-on', status === 'GOOD');
    this.statusBodyBadge.textContent = status === 'GOOD' ? 'Body Detected' : 'Body Not Detected';
    this.guidanceText.textContent = message || '';
    this.guidanceText.classList.toggle('guidance-good', status === 'GOOD');
  }

  setFps(value) {
    this.fpsCounter.textContent = `${value} FPS`;
  }

  showError(message) {
    this.errorMessage.textContent = message;
    this.errorBanner.classList.remove('hidden');
  }

  hideError() {
    this.errorBanner.classList.add('hidden');
  }

  setMirrorButtonState(active) {
    this.btnMirror.classList.toggle('active', active);
  }

  setSkeletonButtonState(active) {
    this.btnSkeleton.classList.toggle('active', active);
  }

  showPhotoModal(dataUrl) {
    this.photoLoading.classList.add('hidden');
    this.photoImg.classList.remove('hidden');
    this.photoImg.src = dataUrl;
    this.photoModal.classList.remove('hidden');
  }

  showPhotoLoading(message) {
    this.photoImg.classList.add('hidden');
    this.photoLoading.classList.remove('hidden');
    this.photoLoadingText.textContent = message;
    this.photoModal.classList.remove('hidden');
  }

  hidePhotoModal() {
    this.photoModal.classList.add('hidden');
  }
}
