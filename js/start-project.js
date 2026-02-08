(function () {
  'use strict';

  /* ── Data ── */
  const EVENT_TYPES = [
    { label: 'Wedding',       video: 'assets/events/wedding.mp4',       desc: 'Ceremonies & receptions' },
    { label: 'Funerals',      video: 'assets/events/funerals.mp4',      desc: 'Celebration of life' },
    { label: 'Corporate',     video: 'assets/events/corporate.mp4',     desc: 'Business & brand events' },
    { label: 'Private Party', video: 'assets/events/private-party.mp4', desc: 'Birthdays & gatherings' },
    { label: 'Christening',   video: 'assets/events/christening.mp4',   desc: 'Baptisms & naming days' },
    { label: 'Other',         video: 'assets/events/other.mp4',         desc: 'Something unique' }
  ];
  const SERVICE_ORDER = ['photo', 'video', 'dj', 'venue'];
  const SERVICE_LABELS = { photo: 'Photo', video: 'Video', dj: 'DJ', venue: 'Venue' };

  /* Photo/Video: Media Type + Cover Type. DJ: Set length + Add-ons. Venue: Space type + Package. */
  var ITEM_WIDTH = 100;
  var MEDIA_TYPES = [
    { id: 'usb', label: 'USB', image: 'https://picsum.photos/seed/media1/200/200' },
    { id: 'dvd', label: 'DVD', image: 'https://picsum.photos/seed/media2/200/200' },
    { id: 'digital', label: 'Digital', image: 'https://picsum.photos/seed/media3/200/200' },
    { id: 'cloud', label: 'Cloud', image: 'https://picsum.photos/seed/media4/200/200' },
    { id: 'sd', label: 'SD Card', image: 'https://picsum.photos/seed/media5/200/200' }
  ];
  var COVER_TYPES = [
    { id: 'standard', label: 'Standard', image: 'https://picsum.photos/seed/cover1/200/200' },
    { id: 'deluxe', label: 'Deluxe', image: 'https://picsum.photos/seed/cover2/200/200' },
    { id: 'premium', label: 'Premium', image: 'https://picsum.photos/seed/cover3/200/200' },
    { id: 'leather', label: 'Leather', image: 'https://picsum.photos/seed/cover4/200/200' },
    { id: 'box', label: 'Box Set', image: 'https://picsum.photos/seed/cover5/200/200' }
  ];
  var DJ_SET_TYPES = [
    { id: 'standard', label: 'Standard', image: 'https://picsum.photos/seed/djset1/200/200' },
    { id: 'extended', label: 'Extended', image: 'https://picsum.photos/seed/djset2/200/200' },
    { id: 'fullnight', label: 'Full Night', image: 'https://picsum.photos/seed/djset3/200/200' },
    { id: 'vip', label: 'VIP', image: 'https://picsum.photos/seed/djset4/200/200' },
    { id: 'custom', label: 'Custom', image: 'https://picsum.photos/seed/djset5/200/200' }
  ];
  var DJ_ADDONS = [
    { id: 'mc', label: 'MC', image: 'https://picsum.photos/seed/djadd1/200/200' },
    { id: 'lighting', label: 'Lighting', image: 'https://picsum.photos/seed/djadd2/200/200' },
    { id: 'karaoke', label: 'Karaoke', image: 'https://picsum.photos/seed/djadd3/200/200' },
    { id: 'requests', label: 'Requests', image: 'https://picsum.photos/seed/djadd4/200/200' },
    { id: 'smoke', label: 'Smoke', image: 'https://picsum.photos/seed/djadd5/200/200' }
  ];
  var VENUE_SPACE_TYPES = [
    { id: 'studio', label: 'Studio', image: 'https://picsum.photos/seed/venue1/200/200' },
    { id: 'hall', label: 'Hall', image: 'https://picsum.photos/seed/venue2/200/200' },
    { id: 'garden', label: 'Garden', image: 'https://picsum.photos/seed/venue3/200/200' },
    { id: 'ballroom', label: 'Ballroom', image: 'https://picsum.photos/seed/venue4/200/200' },
    { id: 'unique', label: 'Unique', image: 'https://picsum.photos/seed/venue5/200/200' }
  ];
  var VENUE_PACKAGES = [
    { id: 'intimate', label: 'Intimate', image: 'https://picsum.photos/seed/venpkg1/200/200' },
    { id: 'medium', label: 'Medium', image: 'https://picsum.photos/seed/venpkg2/200/200' },
    { id: 'large', label: 'Large', image: 'https://picsum.photos/seed/venpkg3/200/200' },
    { id: 'exclusive', label: 'Exclusive', image: 'https://picsum.photos/seed/venpkg4/200/200' },
    { id: 'fullhire', label: 'Full Hire', image: 'https://picsum.photos/seed/venpkg5/200/200' }
  ];
  var CAROUSEL_OPTIONS = {
    photo: { row1Label: 'Media Type', row2Label: 'Cover Type', row1: MEDIA_TYPES, row2: COVER_TYPES },
    video: { row1Label: 'Media Type', row2Label: 'Cover Type', row1: MEDIA_TYPES, row2: COVER_TYPES },
    dj: { row1Label: 'Set Length', row2Label: 'Add-ons', row1: DJ_SET_TYPES, row2: DJ_ADDONS },
    venue: { row1Label: 'Space Type', row2Label: 'Package', row1: VENUE_SPACE_TYPES, row2: VENUE_PACKAGES }
  };

  /* ── State ── */
  const state = {
    eventType: null,
    services: { photo: false, video: false, dj: false, venue: false },
    selections: { photo: null, video: null, dj: null, venue: null },
    phaseList: ['event', 'services'],
    currentPhaseIndex: 0
  };

  /* ── DOM refs ── */
  const dom = {};
  function cacheDom() {
    dom.progressText   = document.getElementById('progressText');
    dom.progressDots   = document.getElementById('progressDots');
    dom.eventStack     = document.getElementById('eventStack');
    dom.eventGrid      = document.getElementById('eventGrid');
    dom.btnSkip        = document.getElementById('btnSkip');
    dom.btnChoose      = document.getElementById('btnChoose');
    dom.btnSeeAll      = document.getElementById('btnSeeAll');
    dom.servicesEventName = document.getElementById('servicesEventName');
    dom.btnBackToEvent = document.getElementById('btnBackToEvent');
    dom.btnServicesNext = document.getElementById('btnServicesNext');
    dom.serviceDetailLabel = document.getElementById('serviceDetailLabel');
    dom.serviceDetailTitle = document.getElementById('serviceDetailTitle');
    dom.btnServiceDetailBack = document.getElementById('btnServiceDetailBack');
    dom.btnServiceDetailNext = document.getElementById('btnServiceDetailNext');
    dom.summaryContent = document.getElementById('summaryContent');
    dom.btnSummaryBack = document.getElementById('btnSummaryBack');
  }

  /* ── Phase list ── */
  function buildPhaseList() {
    const list = ['event', 'services'];
    SERVICE_ORDER.forEach(function (k) { if (state.services[k]) list.push(k); });
    list.push('summary');
    return list;
  }

  function getPanelId(phaseId) {
    return SERVICE_ORDER.indexOf(phaseId) >= 0 ? 'service-detail' : phaseId;
  }

  /* ── Progress dots ── */
  function renderDots() {
    var html = '';
    for (var i = 0; i < state.phaseList.length; i++) {
      var cls = 'progress-dot';
      if (i < state.currentPhaseIndex) cls += ' done';
      if (i === state.currentPhaseIndex) cls += ' active';
      html += '<span class="' + cls + '"></span>';
    }
    dom.progressDots.innerHTML = html;
    dom.progressText.textContent = 'Step ' + (state.currentPhaseIndex + 1) + ' of ' + state.phaseList.length;
  }

  /* ── Show phase with animation ── */
  function showPhase(phaseId) {
    // Hide all
    document.querySelectorAll('.phase-panel').forEach(function (el) {
      el.classList.remove('active', 'visible');
    });

    var panelId = getPanelId(phaseId);
    var panel = document.getElementById('phase-' + panelId);
    if (!panel) return;

    var idx = state.phaseList.indexOf(phaseId);
    state.currentPhaseIndex = idx >= 0 ? idx : 0;

    panel.classList.add('active');
    // Force reflow then animate in
    void panel.offsetHeight;
    requestAnimationFrame(function () {
      panel.classList.add('visible');
    });

    renderDots();

    if (phaseId === 'event') renderEventStack();
    if (phaseId === 'services') {
      if (dom.servicesEventName) dom.servicesEventName.textContent = state.eventType || '—';
      syncServicesUI();
    }
    if (phaseId === 'summary') renderSummary();
    if (SERVICE_ORDER.indexOf(phaseId) >= 0) {
      dom.serviceDetailLabel.textContent = SERVICE_LABELS[phaseId];
      dom.serviceDetailTitle.textContent = SERVICE_LABELS[phaseId] + ' options';
      if (!state.selections[phaseId]) state.selections[phaseId] = { row1: 0, row2: 0 };
      renderDialCarousels(phaseId);
    }
  }

  /* ── Dial carousel (macOS-style: center prominent, sides smaller + transparent) ── */
  function updateDialStyles(carouselEl) {
    var track = carouselEl.querySelector('.dial-track');
    if (!track || !track.children.length) return;
    var scrollLeft = carouselEl.scrollLeft;
    var viewWidth = carouselEl.clientWidth;
    var center = scrollLeft + viewWidth / 2;
    var gap = 8;
    for (var i = 0; i < track.children.length; i++) {
      var item = track.children[i];
      if (!item.classList.contains('dial-item')) continue;
      var itemLeft = item.offsetLeft;
      var itemWidth = item.offsetWidth;
      var itemCenter = itemLeft + itemWidth / 2;
      var dist = Math.abs(center - itemCenter);
      var maxDist = viewWidth / 2;
      var ratio = Math.min(1, dist / maxDist);
      var scale = 1 - ratio * 0.22;
      var opacity = 1 - ratio * 0.55;
      item.style.transform = 'scale(' + scale + ')';
      item.style.opacity = opacity;
    }
  }

  function scrollDialToIndex(carouselEl, index) {
    var track = carouselEl.querySelector('.dial-track');
    if (!track || !track.children[index]) return;
    var item = track.children[index];
    var targetScroll = item.offsetLeft - (carouselEl.clientWidth / 2) + (item.offsetWidth / 2);
    carouselEl.scrollLeft = Math.max(0, targetScroll);
    updateDialStyles(carouselEl);
  }

  function setDialSelection(carouselEl, rowNum, serviceKey, index) {
    var track = carouselEl.querySelector('.dial-track');
    if (!track) return;
    var key = rowNum === 1 ? 'row1' : 'row2';
    state.selections[serviceKey][key] = index;
    for (var i = 0; i < track.children.length; i++) {
      track.children[i].classList.toggle('selected', i === index);
    }
  }

  function renderDialCarousels(serviceKey) {
    var opts = CAROUSEL_OPTIONS[serviceKey];
    if (!opts) return;
    var sel = state.selections[serviceKey] || { row1: 0, row2: 0 };
    var carousel1 = document.getElementById('dialTrack1');
    var carousel2 = document.getElementById('dialTrack2');
    var inner1 = document.getElementById('dialTrack1Inner');
    var inner2 = document.getElementById('dialTrack2Inner');
    if (!carousel1 || !carousel2 || !inner1 || !inner2) return;

    var row1LabelEl = document.getElementById('dialRow1Label');
    var row2LabelEl = document.getElementById('dialRow2Label');
    if (row1LabelEl) row1LabelEl.textContent = opts.row1Label || 'Line 1';
    if (row2LabelEl) row2LabelEl.textContent = opts.row2Label || 'Line 2';

    function setTrackPadding() {
      var w = carousel1.clientWidth || 320;
      var pad = Math.max(0, (w / 2) - (ITEM_WIDTH / 2));
      inner1.style.paddingLeft = pad + 'px';
      inner1.style.paddingRight = pad + 'px';
      inner2.style.paddingLeft = pad + 'px';
      inner2.style.paddingRight = pad + 'px';
    }

    inner1.innerHTML = '';
    opts.row1.forEach(function (o, i) {
      var div = document.createElement('div');
      div.className = 'dial-item' + (i === sel.row1 ? ' selected' : '');
      div.dataset.index = String(i);
      div.setAttribute('role', 'button');
      div.setAttribute('tabindex', '0');
      div.innerHTML = '<div class="dial-item-img-wrap"><img src="' + esc(o.image) + '" alt="" loading="lazy"></div><div class="dial-item-label">' + esc(o.label) + '</div>';
      (function (idx) {
        div.addEventListener('click', function () {
          scrollDialToIndex(carousel1, idx);
          setDialSelection(carousel1, 1, serviceKey, idx);
        });
      })(i);
      inner1.appendChild(div);
    });

    inner2.innerHTML = '';
    opts.row2.forEach(function (o, i) {
      var div = document.createElement('div');
      div.className = 'dial-item' + (i === sel.row2 ? ' selected' : '');
      div.dataset.index = String(i);
      div.setAttribute('role', 'button');
      div.setAttribute('tabindex', '0');
      div.innerHTML = '<div class="dial-item-img-wrap"><img src="' + esc(o.image) + '" alt="" loading="lazy"></div><div class="dial-item-label">' + esc(o.label) + '</div>';
      (function (idx) {
        div.addEventListener('click', function () {
          scrollDialToIndex(carousel2, idx);
          setDialSelection(carousel2, 2, serviceKey, idx);
        });
      })(i);
      inner2.appendChild(div);
    });

    carousel1.removeEventListener('scroll', carousel1._dialScroll);
    carousel1._dialScroll = function () { updateDialStyles(carousel1); };
    carousel1.addEventListener('scroll', carousel1._dialScroll);
    carousel2.removeEventListener('scroll', carousel2._dialScroll);
    carousel2._dialScroll = function () { updateDialStyles(carousel2); };
    carousel2.addEventListener('scroll', carousel2._dialScroll);

    requestAnimationFrame(function () {
      setTrackPadding();
      scrollDialToIndex(carousel1, sel.row1);
      scrollDialToIndex(carousel2, sel.row2);
      updateDialStyles(carousel1);
      updateDialStyles(carousel2);
    });
    setTimeout(function () {
      setTrackPadding();
      scrollDialToIndex(carousel1, sel.row1);
      scrollDialToIndex(carousel2, sel.row2);
      updateDialStyles(carousel1);
      updateDialStyles(carousel2);
    }, 100);
  }

  /* ── Helpers ── */
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /* ── Event type stack ── */
  function renderEventStack() {
    dom.eventStack.innerHTML = '';
    EVENT_TYPES.forEach(function (item, i) {
      var card = document.createElement('div');
      card.className = 'stack-card';
      card.dataset.eventType = item.label;

      // Depth classes: top, behind-1, behind-2, hidden
      if (i === 0) card.classList.add('stack-top');
      else if (i === 1) card.classList.add('stack-behind-1');
      else if (i === 2) card.classList.add('stack-behind-2');
      else card.classList.add('stack-behind-hidden');

      // Video (MP4, autoplay muted loop)
      if (item.video) {
        var video = document.createElement('video');
        video.className = 'stack-card-img';
        video.setAttribute('playsinline', '');
        video.muted = true;
        video.loop = true;
        video.autoplay = true;
        var src = document.createElement('source');
        src.src = item.video;
        src.type = 'video/mp4';
        video.appendChild(src);
        video.onerror = function () {
          video.style.display = 'none';
          card.classList.add('no-image');
        };
        card.appendChild(video);
      } else {
        card.classList.add('no-image');
      }

      // Fallback text (shown when no-image)
      var fb = document.createElement('div');
      fb.className = 'stack-card-fallback';
      fb.textContent = item.label;
      card.appendChild(fb);

      // Swipe direction hints
      card.insertAdjacentHTML('beforeend',
        '<span class="swipe-hint swipe-hint-skip">SKIP</span>' +
        '<span class="swipe-hint swipe-hint-choose">CHOOSE</span>'
      );

      // Label overlay
      var label = document.createElement('div');
      label.className = 'stack-card-label';
      label.innerHTML = '<h3>' + esc(item.label) + '</h3><p>' + esc(item.desc) + '</p>';
      card.appendChild(label);

      dom.eventStack.appendChild(card);
    });
    attachSwipe();
  }

  function getTopCard() {
    return dom.eventStack.querySelector('.stack-card.stack-top');
  }

  function promoteStack() {
    var cards = dom.eventStack.querySelectorAll('.stack-card');
    var remaining = [];
    cards.forEach(function (c) {
      if (!c.classList.contains('swiping-left') && !c.classList.contains('swiping-right')) {
        remaining.push(c);
      }
    });
    remaining.forEach(function (c, i) {
      c.classList.remove('stack-top', 'stack-behind-1', 'stack-behind-2', 'stack-behind-hidden');
      if (i === 0) c.classList.add('stack-top');
      else if (i === 1) c.classList.add('stack-behind-1');
      else if (i === 2) c.classList.add('stack-behind-2');
      else c.classList.add('stack-behind-hidden');
    });
    return remaining;
  }

  function passCard() {
    var top = getTopCard();
    if (!top) return;
    top.classList.add('swiping-left');
    setTimeout(function () {
      // Reset the card's inline styles and classes
      top.style.transition = 'none';
      top.style.transform = '';
      top.classList.remove('swiping-left', 'stack-top', 'hint-left', 'hint-right');
      top.classList.add('stack-behind-hidden');

      // Move it to the bottom of the stack DOM
      dom.eventStack.appendChild(top);

      // Force reflow so the reset takes effect before re-enabling transitions
      void top.offsetHeight;
      top.style.transition = '';

      // Re-assign depth classes to all cards
      promoteStack();
    }, 400);
  }

  function chooseCard() {
    var top = getTopCard();
    if (!top) return;
    state.eventType = top.dataset.eventType;
    top.classList.add('swiping-right');
    setTimeout(function () {
      state.phaseList = buildPhaseList();
      showPhase('services');
    }, 400);
  }

  /* ── Swipe gestures ── */
  function attachSwipe() {
    var startX = 0, currentX = 0, dragging = false;
    var THRESHOLD = 70;

    function onStart(x) {
      if (!getTopCard()) return;
      startX = x;
      currentX = x;
      dragging = true;
    }
    function onMove(x) {
      if (!dragging) return;
      currentX = x;
      var top = getTopCard();
      if (!top) return;
      var dx = x - startX;
      if (Math.abs(dx) < 6) return;
      top.style.transition = 'none';
      top.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx * 0.04) + 'deg)';
      top.classList.remove('hint-left', 'hint-right');
      if (dx < -THRESHOLD) top.classList.add('hint-left');
      else if (dx > THRESHOLD) top.classList.add('hint-right');
    }
    function onEnd() {
      if (!dragging) return;
      dragging = false;
      var top = getTopCard();
      if (!top) return;
      var dx = currentX - startX;
      top.style.transition = '';
      top.style.transform = '';
      top.classList.remove('hint-left', 'hint-right');
      if (dx < -THRESHOLD) passCard();
      else if (dx > THRESHOLD) chooseCard();
    }

    dom.eventStack.addEventListener('mousedown', function (e) {
      if (!e.target.closest('.stack-card.stack-top')) return;
      onStart(e.clientX);
      var move = function (e2) { onMove(e2.clientX); };
      var up = function () { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); onEnd(); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    dom.eventStack.addEventListener('touchstart', function (e) {
      if (!e.target.closest('.stack-card.stack-top')) return;
      onStart(e.touches[0].clientX);
    }, { passive: true });
    dom.eventStack.addEventListener('touchmove', function (e) {
      if (e.touches.length) onMove(e.touches[0].clientX);
    }, { passive: true });
    dom.eventStack.addEventListener('touchend', function () { onEnd(); });
  }

  /* ── Services UI ── */
  function syncServicesUI() {
    document.querySelectorAll('.service-card').forEach(function (card) {
      var cb = card.querySelector('input[type="checkbox"]');
      if (cb) card.classList.toggle('checked', cb.checked);
    });
    syncServicesState();
  }

  function syncServicesState() {
    document.querySelectorAll('input[name="service"]').forEach(function (cb) {
      state.services[cb.value] = cb.checked;
    });
    state.phaseList = buildPhaseList();
    var any = SERVICE_ORDER.some(function (k) { return state.services[k]; });
    dom.btnServicesNext.disabled = !any;
  }

  /* ── Summary ── */
  function renderSummary() {
    var services = SERVICE_ORDER.filter(function (k) { return state.services[k]; }).map(function (k) { return SERVICE_LABELS[k]; }).join(', ') || '—';
    dom.summaryContent.innerHTML =
      '<div class="summary-row"><span class="summary-key">Event</span><span class="summary-value">' + esc(state.eventType || '—') + '</span></div>' +
      '<div class="summary-row"><span class="summary-key">Services</span><span class="summary-value">' + esc(services) + '</span></div>';
  }

  /* ── Navigation ── */
  function goNext() {
    var next = state.phaseList[state.currentPhaseIndex + 1];
    if (next) showPhase(next);
  }
  function goBack() {
    var prev = state.phaseList[state.currentPhaseIndex - 1];
    if (prev) showPhase(prev);
  }

  /* ── Init ── */
  function init() {
    cacheDom();
    state.phaseList = buildPhaseList();
    renderDots();
    renderEventStack();

    dom.btnSkip.addEventListener('click', passCard);
    dom.btnChoose.addEventListener('click', chooseCard);

    // See-all grid
    dom.btnSeeAll.addEventListener('click', function () {
      if (dom.eventGrid.classList.contains('hidden')) {
        dom.eventGrid.classList.remove('hidden');
        if (!dom.eventGrid.children.length) {
          EVENT_TYPES.forEach(function (item) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'event-grid-btn';
            if (item.video) {
              var vid = document.createElement('video');
              vid.src = item.video;
              vid.muted = true;
              vid.loop = true;
              vid.autoplay = true;
              vid.setAttribute('playsinline', '');
              vid.onerror = function () { vid.style.display = 'none'; };
              btn.appendChild(vid);
            }
            var span = document.createElement('span');
            span.style.cssText = 'padding:0.75rem 1rem;font-size:0.875rem;font-weight:600;color:#fff;';
            span.textContent = item.label;
            btn.appendChild(span);
            btn.addEventListener('click', function () {
              state.eventType = item.label;
              state.phaseList = buildPhaseList();
              showPhase('services');
            });
            dom.eventGrid.appendChild(btn);
          });
        }
      } else {
        dom.eventGrid.classList.add('hidden');
      }
    });

    // Service checkboxes
    document.querySelectorAll('.service-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var cb = card.querySelector('input[type="checkbox"]');
        // The label click already toggles the checkbox; just update UI
        requestAnimationFrame(function () {
          card.classList.toggle('checked', cb.checked);
          syncServicesState();
        });
      });
    });

    // Nav buttons
    dom.btnBackToEvent.addEventListener('click', function () {
      state.eventType = null;
      state.phaseList = buildPhaseList();
      showPhase('event');
    });
    dom.btnServicesNext.addEventListener('click', function () {
      syncServicesState();
      goNext();
    });
    dom.btnServiceDetailBack.addEventListener('click', goBack);
    dom.btnServiceDetailNext.addEventListener('click', goNext);
    dom.btnSummaryBack.addEventListener('click', goBack);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
