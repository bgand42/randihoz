// === RandiHoz App ===
(function () {
  'use strict';

  // --- State ---
  const state = {
    activeMeal: 'brunch',
    maxDistance: 30,
    sortBy: 'distance',
    activeView: 'cards',
    origin: { ...DEFAULT_ORIGIN },
    visited: {},
    drivingTimes: {},
    map: null,
    markers: [],
    originMarker: null
  };

  // --- Init ---
  function init() {
    loadVisited();
    calculateDrivingTimes();
    render();
    bindEvents();
    document.getElementById('lastUpdated').textContent = DATA_LAST_UPDATED;
    document.getElementById('footerLastUpdated').textContent = DATA_LAST_UPDATED;
    document.getElementById('footerLastSearch').textContent = LAST_WEB_SEARCH;
  }

  // --- Haversine distance (km) ---
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // --- Estimate driving time from distance ---
  function estimateDrivingMinutes(km) {
    // Rough estimate: city driving avg ~30-40 km/h + overhead
    if (km < 3) return Math.round(km * 2 + 2);
    if (km < 10) return Math.round(km * 2);
    if (km < 25) return Math.round(km * 1.5 + 5);
    return Math.round(km * 1.3 + 8);
  }

  // --- Calculate driving times for all restaurants ---
  function calculateDrivingTimes() {
    RESTAURANTS.forEach(r => {
      const km = haversine(state.origin.lat, state.origin.lng, r.lat, r.lng);
      state.drivingTimes[r.id] = estimateDrivingMinutes(km);
    });
  }

  // --- Try OSRM for real driving times (non-blocking) ---
  function fetchRealDrivingTimes() {
    const coords = RESTAURANTS.map(r => `${r.lng},${r.lat}`).join(';');
    const url = `https://router.project-osrm.org/table/v1/driving/${state.origin.lng},${state.origin.lat};${coords}?sources=0&annotations=duration`;

    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.code === 'Ok' && data.durations && data.durations[0]) {
          const durations = data.durations[0];
          RESTAURANTS.forEach((r, i) => {
            const seconds = durations[i + 1];
            if (seconds != null) {
              state.drivingTimes[r.id] = Math.round(seconds / 60);
            }
          });
          render();
        }
      })
      .catch(() => {
        // Silently fall back to estimates
      });
  }

  // --- Filter restaurants ---
  function getFilteredRestaurants() {
    let results = RESTAURANTS.filter(r => {
      // Meal type filter
      if (!r.mealTypes.includes(state.activeMeal)) return false;
      // Distance filter
      const time = state.drivingTimes[r.id] || 999;
      if (time > state.maxDistance) return false;
      return true;
    });

    // Sort
    switch (state.sortBy) {
      case 'distance':
        results.sort((a, b) => (state.drivingTimes[a.id] || 0) - (state.drivingTimes[b.id] || 0));
        break;
      case 'rating':
        results.sort((a, b) => b.rating - a.rating);
        break;
      case 'newest':
        results.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
        break;
      case 'random':
        results.sort(() => Math.random() - 0.5);
        break;
    }

    return results;
  }

  // --- Render ---
  function render() {
    renderCards();
    if (state.map) renderMap();
    updateResultCount();
  }

  function updateResultCount() {
    const count = getFilteredRestaurants().length;
    document.getElementById('resultCount').textContent = `${count} hely`;
  }

  // --- Render Cards ---
  function renderCards() {
    const container = document.getElementById('cardContainer');
    const emptyState = document.getElementById('emptyState');
    const restaurants = getFilteredRestaurants();

    if (restaurants.length === 0) {
      container.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    container.innerHTML = restaurants.map(r => createCardHTML(r)).join('');

    // Bind card clicks
    container.querySelectorAll('.restaurant-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.id);
        openDetail(id);
      });
    });
  }

  function createCardHTML(r) {
    const time = state.drivingTimes[r.id] || '?';
    const isVisited = state.visited[r.id];
    const primaryMeal = r.mealTypes[0];

    return `
      <article class="restaurant-card" data-id="${r.id}">
        <div class="card-header">
          <div class="card-color-strip ${primaryMeal}"></div>
          <div class="card-info">
            <div class="card-name-row">
              <span class="card-name">${escapeHtml(r.name)}</span>
              ${r.isNew ? '<span class="badge badge-new">Új</span>' : ''}
              ${isVisited ? '<span class="badge badge-visited">Jártunk</span>' : ''}
            </div>
            <div class="card-cuisine">${escapeHtml(r.cuisine)}</div>
          </div>
          <div class="card-distance">${time} perc</div>
        </div>
        <div class="card-body">
          <p class="card-description">${escapeHtml(r.description)}</p>
        </div>
        ${r.seafoodWarning ? '<p class="seafood-warning">⚠️ Egyes fogások halat/tengeri herkentyűt tartalmazhatnak</p>' : ''}
        <div class="card-footer">
          ${r.mealTypes.map(m => `<span class="meal-tag ${m}">${mealLabel(m)}</span>`).join('')}
          <span class="card-rating">★ ${r.rating}</span>
          <span class="card-price">${escapeHtml(r.priceRange)}</span>
        </div>
      </article>
    `;
  }

  function mealLabel(type) {
    switch (type) {
      case 'brunch': return 'Brunch';
      case 'lunch': return 'Ebéd';
      case 'dinner': return 'Vacsora';
      default: return type;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Render Map ---
  function initMap() {
    if (state.map) return;

    state.map = L.map('map', {
      zoomControl: true,
      attributionControl: true
    }).setView([state.origin.lat, state.origin.lng], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 18
    }).addTo(state.map);

    // Origin marker
    const originIcon = L.divIcon({
      className: '',
      html: '<div class="origin-marker"><span>📍</span></div>',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    state.originMarker = L.marker([state.origin.lat, state.origin.lng], { icon: originIcon })
      .addTo(state.map)
      .bindPopup(`<div class="map-popup"><div class="map-popup-name">${escapeHtml(state.origin.name)}</div><div class="map-popup-cuisine">Kiindulópont</div></div>`);

    renderMap();
  }

  function renderMap() {
    if (!state.map) return;

    // Remove old markers
    state.markers.forEach(m => state.map.removeLayer(m));
    state.markers = [];

    const restaurants = getFilteredRestaurants();

    restaurants.forEach(r => {
      const time = state.drivingTimes[r.id] || '?';
      const primaryMeal = r.mealTypes.length > 1 ? 'multi' : r.mealTypes[0];
      const emoji = r.mealTypes.length > 1 ? '🍴' : (r.mealTypes[0] === 'brunch' ? '☀️' : r.mealTypes[0] === 'lunch' ? '🍽️' : '🌙');

      const icon = L.divIcon({
        className: '',
        html: `<div class="custom-marker ${primaryMeal}"><span>${emoji}</span></div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
      });

      const marker = L.marker([r.lat, r.lng], { icon })
        .addTo(state.map)
        .bindPopup(`
          <div class="map-popup">
            <div class="map-popup-name">${escapeHtml(r.name)}</div>
            <div class="map-popup-cuisine">${escapeHtml(r.cuisine)}</div>
            <div class="map-popup-distance">${time} perc autóval</div>
            <button class="map-popup-btn" onclick="window.__openDetail(${r.id})">Részletek</button>
          </div>
        `);

      state.markers.push(marker);
    });

    // Fit bounds if there are markers
    if (state.markers.length > 0) {
      const group = L.featureGroup([state.originMarker, ...state.markers]);
      state.map.fitBounds(group.getBounds().pad(0.1));
    }
  }

  // Expose for map popup buttons
  window.__openDetail = function (id) {
    openDetail(id);
  };

  // --- Detail Modal ---
  function openDetail(id) {
    const r = RESTAURANTS.find(x => x.id === id);
    if (!r) return;

    const time = state.drivingTimes[r.id] || '?';
    const isVisited = state.visited[r.id];

    const modal = document.getElementById('detailModal');
    const body = document.getElementById('modalBody');

    body.innerHTML = `
      <h2 class="modal-restaurant-name">${escapeHtml(r.name)}</h2>
      <p class="modal-cuisine">${escapeHtml(r.cuisine)}</p>

      <div class="modal-badges">
        ${r.mealTypes.map(m => `<span class="meal-tag ${m}">${mealLabel(m)}</span>`).join('')}
        ${r.isNew ? '<span class="badge badge-new">Új</span>' : ''}
        ${isVisited ? '<span class="badge badge-visited">Már jártunk itt</span>' : ''}
      </div>

      <div class="modal-info-grid">
        <div class="modal-info-item">
          <div class="modal-info-label">Távolság</div>
          <div class="modal-info-value">${time} perc</div>
        </div>
        <div class="modal-info-item">
          <div class="modal-info-label">Értékelés</div>
          <div class="modal-info-value">★ ${r.rating}</div>
        </div>
        <div class="modal-info-item">
          <div class="modal-info-label">Árkategória</div>
          <div class="modal-info-value">${escapeHtml(r.priceRange)}</div>
        </div>
        <div class="modal-info-item">
          <div class="modal-info-label">Infó</div>
          <div class="modal-info-value">${escapeHtml(r.yearInfo)}</div>
        </div>
      </div>

      <p class="modal-description">${escapeHtml(r.description)}</p>

      ${r.seafoodWarning ? '<p class="seafood-warning" style="margin-bottom:12px">⚠️ Egyes fogások halat/tengeri herkentyűt tartalmazhatnak – kérj hal nélküli ajánlatot!</p>' : ''}

      <div class="modal-address">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
        <span>${escapeHtml(r.address)}</span>
      </div>

      <div class="modal-actions">
        <button class="btn-primary ${isVisited ? 'btn-visited' : ''}" id="toggleVisitedBtn" data-id="${r.id}">
          ${isVisited ? '✓ Jártunk itt' : 'Megjelölés: jártunk'}
        </button>
        <a class="btn-outline" href="https://www.google.com/maps/dir/?api=1&origin=${state.origin.lat},${state.origin.lng}&destination=${r.lat},${r.lng}&travelmode=driving" target="_blank" rel="noopener">
          Útvonal
        </a>
      </div>
    `;

    modal.classList.remove('hidden');

    // Bind visited toggle
    document.getElementById('toggleVisitedBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleVisited(r.id);
      openDetail(r.id); // Re-render modal
      renderCards(); // Update cards too
    });
  }

  function closeDetail() {
    document.getElementById('detailModal').classList.add('hidden');
  }

  // --- Visited ---
  function loadVisited() {
    try {
      const stored = localStorage.getItem('randihoz_visited');
      if (stored) state.visited = JSON.parse(stored);
    } catch (e) {
      state.visited = {};
    }
  }

  function saveVisited() {
    localStorage.setItem('randihoz_visited', JSON.stringify(state.visited));
  }

  function toggleVisited(id) {
    if (state.visited[id]) {
      delete state.visited[id];
    } else {
      state.visited[id] = new Date().toISOString();
    }
    saveVisited();
  }

  // --- Geocoding (Nominatim) ---
  function geocodeOrigin(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=hu`;

    document.getElementById('originStatus').textContent = 'Keresés...';

    fetch(url, {
      headers: { 'Accept-Language': 'hu' }
    })
      .then(res => res.json())
      .then(data => {
        if (data.length > 0) {
          state.origin = {
            name: data[0].display_name.split(',').slice(0, 2).join(','),
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon)
          };
          document.getElementById('originStatus').textContent = `Jelenlegi: ${state.origin.name}`;

          // Recalculate
          calculateDrivingTimes();
          fetchRealDrivingTimes();

          // Update map origin
          if (state.map && state.originMarker) {
            state.originMarker.setLatLng([state.origin.lat, state.origin.lng]);
          }

          render();
        } else {
          document.getElementById('originStatus').textContent = 'Nem található. Próbáld újra!';
        }
      })
      .catch(() => {
        document.getElementById('originStatus').textContent = 'Hiba történt a keresésnél.';
      });
  }

  // --- Event Bindings ---
  function bindEvents() {
    // Meal type buttons
    document.querySelectorAll('.meal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.meal-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeMeal = btn.dataset.meal;
        render();
      });
    });

    // Distance slider
    const slider = document.getElementById('distanceSlider');
    slider.addEventListener('input', () => {
      state.maxDistance = parseInt(slider.value);
      document.getElementById('distanceValue').textContent = `${state.maxDistance} perc`;
      render();
    });

    // Sort select
    document.getElementById('sortSelect').addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      render();
    });

    // View toggle
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeView = btn.dataset.view;

        document.getElementById('cardView').classList.toggle('active', state.activeView === 'cards');
        document.getElementById('mapView').classList.toggle('active', state.activeView === 'map');

        if (state.activeView === 'map') {
          initMap();
          setTimeout(() => state.map.invalidateSize(), 100);
        }
      });
    });

    // Modal close
    document.querySelector('#detailModal .modal-close').addEventListener('click', closeDetail);
    document.querySelector('#detailModal .modal-overlay').addEventListener('click', closeDetail);

    // Settings
    document.getElementById('settingsBtn').addEventListener('click', () => {
      document.getElementById('settingsPanel').classList.remove('hidden');
    });

    document.getElementById('closeSettingsBtn').addEventListener('click', () => {
      document.getElementById('settingsPanel').classList.add('hidden');
    });

    document.querySelector('#settingsPanel .modal-overlay').addEventListener('click', () => {
      document.getElementById('settingsPanel').classList.add('hidden');
    });

    // Update origin
    document.getElementById('updateOriginBtn').addEventListener('click', () => {
      const query = document.getElementById('startingPointInput').value.trim();
      if (query) geocodeOrigin(query);
    });

    document.getElementById('startingPointInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = e.target.value.trim();
        if (query) geocodeOrigin(query);
      }
    });

    // Keyboard: Escape closes modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDetail();
        document.getElementById('settingsPanel').classList.add('hidden');
      }
    });
  }

  // --- Start ---
  document.addEventListener('DOMContentLoaded', () => {
    init();
    // Try to get real driving times from OSRM
    fetchRealDrivingTimes();
  });
})();
