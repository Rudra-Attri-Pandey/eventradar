document.addEventListener('DOMContentLoaded', () => {
  // XSS guard: escape user-supplied / AI-generated strings before innerHTML
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Only allow safe card artwork: http(s)/data:image URLs or plain linear-gradients.
  // Anything else falls back to a default gradient (never injected raw into style).
  function safeArtwork(imageUrl) {
    const s = String(imageUrl || '').trim();
    if (/^linear-gradient\([\w\s.,%#()/-]+\)$/i.test(s) && s.length <= 300) return s;
    if (/^(https:\/\/|http:\/\/|data:image\/)/i.test(s) && s.length <= 2000 && !/["'<>`]/.test(s)) {
      return `url("${s}") center/cover no-repeat, linear-gradient(135deg, #1e1b4b, #311042)`;
    }
    return 'linear-gradient(135deg, #1e1b4b, #311042)';
  }

  // Tab Controls
  const tabSwipe = document.getElementById('tab-swipe');
  const tabScan = document.getElementById('tab-scan');
  const tabSubmit = document.getElementById('tab-submit');
  const panelSwipe = document.getElementById('panel-swipe');
  const panelScan = document.getElementById('panel-scan');
  const panelSubmit = document.getElementById('panel-submit');

  // Deck Elements
  const swipeDeck = document.getElementById('swipe-deck');
  const emptyDeck = document.getElementById('empty-deck');
  const btnPass = document.getElementById('btn-pass');
  const btnLike = document.getElementById('btn-like');
  const deckStatus = document.getElementById('deck-status');
  const filterArea = document.getElementById('filter-area');
  const filterCategory = document.getElementById('filter-category');
  const btnFilter = document.getElementById('btn-filter');

  // Scanner Elements
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const btnSampleScan = document.getElementById('btn-sample-scan');
  const flyerPreview = document.getElementById('flyer-preview');
  const parsedResults = document.getElementById('parsed-results');
  const scanStatus = document.getElementById('scan-status');

  // Parsed Properties elements
  const resTitle = document.getElementById('res-title');
  const resDate = document.getElementById('res-date');
  const resTime = document.getElementById('res-time');
  const resVenue = document.getElementById('res-venue');
  const resCategory = document.getElementById('res-category');
  const btnUseDetails = document.getElementById('btn-use-details');

  // Submit form elements
  const submitForm = document.getElementById('submit-form');
  const submitStatus = document.getElementById('submit-status');
  const F = (id) => document.getElementById(id);

  // Real events from the community board API
  let events = [];
  let activeIndex = 0;
  let scannedEvent = null;

  const showTab = (which) => {
    const map = {
      swipe: [tabSwipe, panelSwipe],
      scan: [tabScan, panelScan],
      submit: [tabSubmit, panelSubmit],
    };
    for (const [key, [tab, panel]] of Object.entries(map)) {
      const on = key === which;
      if (tab) tab.classList.toggle('active', on);
      if (panel) panel.classList.toggle('active', on);
    }
  };
  tabSwipe.addEventListener('click', () => showTab('swipe'));
  tabScan.addEventListener('click', () => showTab('scan'));
  if (tabSubmit) tabSubmit.addEventListener('click', () => showTab('submit'));

  async function loadDeck() {
    deckStatus.textContent = 'Loading events…';
    const params = new URLSearchParams();
    if (filterArea && filterArea.value.trim()) params.set('area', filterArea.value.trim());
    if (filterCategory && filterCategory.value) params.set('category', filterCategory.value);
    try {
      const r = await fetch('/api/events' + (params.toString() ? '?' + params.toString() : ''));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      events = Array.isArray(j.events) ? j.events : [];
      activeIndex = 0;
      deckStatus.textContent = events.length
        ? `${events.length} event${events.length === 1 ? '' : 's'} on the board`
        : 'No events yet — submit the first one!';
    } catch (e) {
      deckStatus.textContent = 'Could not reach the API. Is the server running (npm start)?';
      events = [];
      activeIndex = 0;
    }
    renderCard();
  }

  const renderCard = () => {
    // Clear old card
    const existingCard = swipeDeck.querySelector('.event-card');
    if (existingCard) existingCard.remove();

    if (activeIndex >= events.length) {
      emptyDeck.classList.remove('hidden');
      btnPass.disabled = true;
      btnLike.disabled = true;
      return;
    }

    emptyDeck.classList.add('hidden');
    btnPass.disabled = false;
    btnLike.disabled = false;

    const event = events[activeIndex];
    const card = document.createElement('div');
    card.className = 'event-card';
    const seedTag = event.seed ? '<span class="seed-badge">sample</span>' : '';
    const likes = Number(event.likes) || 0;
    card.innerHTML = `
      <div class="event-image" style="background: ${escapeHtml(safeArtwork(event.imageUrl))}">
        <div class="event-meta">
          <span class="dist-badge">📍 ${escapeHtml(event.area || 'local')}</span>
          ${seedTag}
        </div>
      </div>
      <div class="event-info">
        <h3>${escapeHtml(event.title)}</h3>
        <div class="event-details-row">
          <span>📅 ${escapeHtml(event.date)}</span>
          <span>🕒 ${escapeHtml(event.time)}</span>
          <span>🏢 ${escapeHtml(event.venue)}</span>
          <span>🏷️ ${escapeHtml(event.category || 'other')}</span>
          <span>⭐ ${likes} interested</span>
        </div>
      </div>
    `;
    swipeDeck.insertBefore(card, emptyDeck);
  };

  async function vote(id, kind) {
    try {
      await fetch(`/api/events/${encodeURIComponent(id)}/${kind}`, { method: 'POST' });
    } catch { /* deck still advances; count syncs on reload */ }
  }

  const handleSwipe = (direction) => {
    const card = swipeDeck.querySelector('.event-card');
    if (!card) return;
    const ev = events[activeIndex];

    if (direction === 'left') {
      card.classList.add('swipe-left');
      if (ev && ev.id) void vote(ev.id, 'pass');
    } else {
      card.classList.add('swipe-right');
      if (ev && ev.id) {
        void vote(ev.id, 'like');
        ev.likes = (Number(ev.likes) || 0) + 1;
      }
    }

    setTimeout(() => {
      activeIndex++;
      renderCard();
    }, 300);
  };

  btnPass.addEventListener('click', () => handleSwipe('left'));
  btnLike.addEventListener('click', () => handleSwipe('right'));
  if (btnFilter) btnFilter.addEventListener('click', loadDeck);

  // Scan visualizer: laser sweep + labeled bounding boxes (demo chrome around
  // either a real AI extraction or, when the backend has no key, a labeled demo).
  const playScanVisualizer = (done) => {
    flyerPreview.innerHTML = '<div class="laser-line"></div>';
    parsedResults.classList.add('hidden');
    setTimeout(() => {
      const laser = flyerPreview.querySelector('.laser-line');
      if (laser) laser.remove();
      flyerPreview.innerHTML += `
        <div class="bounding-box" style="top: 15%; left: 10%; width: 80%; height: 25px;">TITLE: CONFIRMED</div>
        <div class="bounding-box" style="top: 45%; left: 15%; width: 45%; height: 18px;">DATE: OK</div>
        <div class="bounding-box" style="top: 65%; left: 15%; width: 60%; height: 18px;">VENUE: EXTRACTED</div>
      `;
      done();
    }, 2000);
  };

  const showExtracted = (info, label) => {
    resTitle.textContent = info.title || '-';
    resDate.textContent = info.date || '-';
    resTime.textContent = info.time || '-';
    resVenue.textContent = info.venue || '-';
    if (resCategory) resCategory.textContent = info.category || '-';
    scanStatus.textContent = label;
    scannedEvent = info;
    parsedResults.classList.remove('hidden');
  };

  const uploadFlyer = async (file) => {
    flyerPreview.style.backgroundImage = 'none';
    scanStatus.textContent = '';
    const localPreview = URL.createObjectURL(file);
    flyerPreview.style.backgroundImage = `url("${localPreview}")`;
    flyerPreview.style.backgroundSize = 'contain';
    flyerPreview.style.backgroundRepeat = 'no-repeat';
    flyerPreview.style.backgroundPosition = 'center';

    playScanVisualizer(async () => {
      const fd = new FormData();
      fd.append('image', file);
      try {
        const r = await fetch('/api/flyer', { method: 'POST', body: fd });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.extracted) {
          showExtracted(j.extracted, `AI vision (${j.model || 'gemini'}, confidence ${j.extracted.confidence || '—'}) — confirm below before it goes live.`);
          return;
        }
        if (r.status === 503) {
          // Honest keyless path: labeled demo, nothing AI about it.
          showExtracted(
            { title: 'Synthesizer Rave Party', date: '', time: '10:00 PM - 4:00 AM', venue: 'Cyberpunk Garage Club', category: 'music' },
            'Demo preview — flyer vision is off (no API key on server). Fill the date and confirm to post.'
          );
          return;
        }
        scanStatus.textContent = 'Scan failed: ' + (j.error || 'HTTP ' + r.status);
        parsedResults.classList.remove('hidden');
      } catch {
        scanStatus.textContent = 'Scan failed: could not reach the API.';
        parsedResults.classList.remove('hidden');
      }
    });
  };

  // Click zone triggers file upload
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) void uploadFlyer(fileInput.files[0]);
    fileInput.value = '';
  });

  btnSampleScan.addEventListener('click', () => {
    // Labeled demo — never presented as AI output.
    flyerPreview.style.backgroundImage = 'linear-gradient(135deg, #030712, #8b5cf6)';
    playScanVisualizer(() => {
      showExtracted(
        { title: 'Summer Indie Music Fest', date: '', time: '1:00 PM - 11:00 PM', venue: 'Riverside Outdoor Park', category: 'music' },
        'Demo preview — sample flyer, not an AI scan. Fill the date and confirm to post.'
      );
    });
  });

  // Scanned/AI details -> pre-fill the submit form (user confirms -> POST /api/events)
  if (btnUseDetails) {
    btnUseDetails.addEventListener('click', () => {
      if (!scannedEvent) return;
      F('f-title').value = scannedEvent.title || '';
      F('f-date').value = /^\d{4}-\d{2}-\d{2}$/.test(scannedEvent.date || '') ? scannedEvent.date : '';
      F('f-time').value = scannedEvent.time || '';
      F('f-venue').value = scannedEvent.venue || '';
      if (scannedEvent.category) F('f-category').value = String(scannedEvent.category).toLowerCase();
      scannedEvent = null;
      flyerPreview.innerHTML = '<div class="placeholder-preview">Flyer preview with bounding boxes appears here</div>';
      flyerPreview.style.backgroundImage = 'none';
      parsedResults.classList.add('hidden');
      showTab('submit');
      submitStatus.textContent = 'Pre-filled from scan — review and hit "Post Event to Board".';
    });
  }

  // Community submit -> POST /api/events -> deck reloads
  if (submitForm) {
    submitForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      submitStatus.textContent = 'Posting…';
      const payload = {
        title: F('f-title').value.trim(),
        date: F('f-date').value.trim(),
        time: F('f-time').value.trim(),
        venue: F('f-venue').value.trim(),
        area: F('f-area').value.trim(),
        category: F('f-category').value.trim(),
        description: F('f-desc').value.trim(),
        imageUrl: F('f-image').value.trim(),
      };
      try {
        const r = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          submitStatus.textContent = 'Rejected: ' + (j.error || 'HTTP ' + r.status);
          return;
        }
        submitStatus.textContent = 'Posted! It is now on the shared board.';
        submitForm.reset();
        showTab('swipe');
        await loadDeck();
      } catch {
        submitStatus.textContent = 'Could not reach the API. Is the server running?';
      }
    });
  }

  loadDeck();
});
