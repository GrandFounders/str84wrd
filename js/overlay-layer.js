/**
 * Overlay layer: free-form drawing + image overlays on iframe document.
 * Injected by parent (index.html) into invoice/receipt/statement iframes.
 * Exposes API: enableDrawMode, disableDrawMode, getStrokes, setStrokes,
 * addOverlayImage, getOverlayImages, setOverlayImages, resizeDrawLayer.
 */
(function() {
  'use strict';

  const STROKE_STYLE = '#ff880f';
  const LINE_WIDTH = 6;
  const MIN_IMAGE_SIZE = 20;
  const SAMPLE_STEP = 0.5;
  const ERASER_RADIUS = 20;

  let strokes = [];
  let currentStroke = [];
  let overlayImages = [];
  let drawModeEnabled = false;
  let drawing = false;
  let currentTool = 'draw';

  function getDocSize() {
    const page = document.getElementById('invoice') || document.getElementById('receipt');
    if (page) {
      return {
        width: Math.max(Math.max(page.scrollWidth, page.offsetWidth), 800),
        height: Math.max(Math.max(page.scrollHeight, page.offsetHeight), 1000)
      };
    }
    const body = document.body;
    const html = document.documentElement;
    const w = Math.max(body.scrollWidth, body.offsetWidth, html.scrollWidth, html.offsetWidth);
    const h = Math.max(body.scrollHeight, body.offsetHeight, html.scrollHeight, html.offsetHeight);
    return { width: Math.max(w, 800), height: Math.max(h, 1000) };
  }

  function getOverlayParent() {
    const a4 = document.querySelector('.a4');
    return a4 || document.body;
  }

  function ensureOverlayContainer() {
    let container = document.getElementById('overlay-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'overlay-container';
      container.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;contain:layout;';
      const parent = getOverlayParent();
      if (parent.style.position !== 'relative' && parent.style.position !== 'absolute') {
        parent.style.position = 'relative';
      }
      parent.appendChild(container);
    }
    return container;
  }

  function ensureOverlayImagesContainer() {
    let container = document.getElementById('overlay-images-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'overlay-images-container';
      container.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2147483647;contain:layout;';
      const parent = getOverlayParent();
      if (parent.style.position !== 'relative' && parent.style.position !== 'absolute') {
        parent.style.position = 'relative';
      }
      parent.appendChild(container);
    }
    return container;
  }

  function ensureDrawLayer() {
    const container = ensureOverlayContainer();
    if (!document.getElementById('overlay-layer-styles')) {
      const style = document.createElement('style');
      style.id = 'overlay-layer-styles';
      style.textContent = '#draw-layer{position:absolute;left:0;top:0;z-index:2147483647;pointer-events:none;touch-action:none}#draw-layer.draw-mode{pointer-events:auto;cursor:crosshair}#draw-layer.draw-mode.draw-pinch-pause{pointer-events:none!important}.overlay-image{position:absolute;pointer-events:auto;cursor:move;z-index:1;display:flex;align-items:center;justify-content:center;overflow:visible;transform-origin:center center;touch-action:none}.overlay-image .overlay-image-handle{touch-action:none}.overlay-image img{width:auto;height:auto;max-width:100%;max-height:100%;pointer-events:none}.overlay-image .overlay-image-handle{opacity:0;pointer-events:none;transition:opacity 0.15s}.overlay-image.selected .overlay-image-handle{opacity:1;pointer-events:auto}.overlay-image.selected{outline:1px dashed #926E4C;outline-offset:2px}.overlay-image-handle{position:absolute;width:8px;height:8px;background:#926E4C;border:1px solid #fff;border-radius:2px;z-index:10;touch-action:none}.overlay-image-toolbar{position:absolute;top:-36px;left:0;right:0;display:flex;gap:4px;justify-content:center;flex-wrap:wrap;opacity:0;pointer-events:none;z-index:11;transition:opacity 0.15s}.overlay-image.selected .overlay-image-toolbar{opacity:1;pointer-events:auto}.overlay-image-toolbar-btn{width:24px;height:24px;background:#926E4C;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;touch-action:manipulation;flex-shrink:0}.overlay-image-toolbar-btn:hover{background:#7a5a3d}.overlay-image-toolbar-btn.delete{background:#c45c1a}.overlay-image-toolbar-btn.delete:hover{background:#a34a15}.overlay-image-rotate-handle{position:absolute;top:-56px;left:50%;margin-left:-10px;width:20px;height:20px;border-radius:50%;background:#926E4C;border:1px solid #fff;cursor:grab;z-index:12;opacity:0;pointer-events:none;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff}.overlay-image.selected .overlay-image-rotate-handle{opacity:1;pointer-events:auto}.overlay-image.locked .overlay-image-handle,.overlay-image.locked .overlay-image-toolbar,.overlay-image.locked .overlay-image-rotate-handle{opacity:0!important;pointer-events:none!important}.overlay-image.locked .overlay-image-lock-badge{opacity:1!important;pointer-events:auto!important}.overlay-image-lock-badge{position:absolute;bottom:2px;right:2px;width:20px;height:20px;background:#926E4C;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;z-index:20;transition:opacity 0.15s}body.capture-exporting .overlay-image-handle,body.capture-exporting .overlay-image-toolbar,body.capture-exporting .overlay-image-rotate-handle,body.capture-exporting .overlay-image-lock-badge{display:none!important}body.capture-exporting .overlay-image.selected{outline:none!important}@media (pointer:coarse){.overlay-image-handle{min-width:20px;min-height:20px;flex-shrink:0}.overlay-image-toolbar{top:-44px}.overlay-image-toolbar-btn{width:28px;height:28px;font-size:14px;min-width:28px;min-height:28px}.overlay-image-rotate-handle{top:-60px;width:20px;height:20px;margin-left:-10px;min-width:20px;min-height:20px}.overlay-image-lock-badge{width:22px;height:22px;min-width:22px;min-height:22px;font-size:11px}}';
      (document.head || document.documentElement).appendChild(style);
    }
    let canvas = document.getElementById('draw-layer');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'draw-layer';
      canvas.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483647;pointer-events:none;touch-action:none;';
      container.insertBefore(canvas, container.firstChild);
    }
    return canvas;
  }

  function resizeDrawLayer() {
    const canvas = ensureDrawLayer();
    const size = getDocSize();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    canvas.style.width = size.width + 'px';
    canvas.style.height = size.height + 'px';
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      redrawStrokes(ctx, size.width, size.height);
    }
  }

  function redrawStrokes(ctx, w, h) {
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = STROKE_STYLE;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    strokes.forEach(function(stroke) {
      if (stroke.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      if (stroke.length === 2) {
        ctx.lineTo(stroke[1].x, stroke[1].y);
      } else {
        for (let i = 1; i < stroke.length - 1; i++) {
          const midX = (stroke[i].x + stroke[i + 1].x) / 2;
          const midY = (stroke[i].y + stroke[i + 1].y) / 2;
          ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, midX, midY);
        }
        ctx.lineTo(stroke[stroke.length - 1].x, stroke[stroke.length - 1].y);
      }
      ctx.stroke();
    });
  }

  function getCanvasCoords(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const scaleX = (canvas.width / dpr) / rect.width;
    const scaleY = (canvas.height / dpr) / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  function pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = x1 + t * dx;
    const qy = y1 + t * dy;
    return Math.hypot(px - qx, py - qy);
  }

  function strokeHitByPoint(stroke, px, py, radius) {
    if (!stroke || stroke.length === 0) return false;
    if (stroke.length === 1) {
      return Math.hypot(stroke[0].x - px, stroke[0].y - py) <= radius;
    }
    for (let i = 0; i < stroke.length - 1; i++) {
      const d = pointToSegmentDist(px, py, stroke[i].x, stroke[i].y, stroke[i + 1].x, stroke[i + 1].y);
      if (d <= radius) return true;
    }
    return false;
  }

  function eraseAt(canvas, px, py) {
    const hit = strokes.filter(function(s) { return strokeHitByPoint(s, px, py, ERASER_RADIUS); });
    if (hit.length === 0) return;
    strokes = strokes.filter(function(s) { return !strokeHitByPoint(s, px, py, ERASER_RADIUS); });
    const size = getDocSize();
    const ctx = canvas.getContext('2d');
    if (ctx) redrawStrokes(ctx, size.width, size.height);
    try {
      window.parent.postMessage({ type: 'draw-strokes-changed', strokes: strokes }, '*');
    } catch (err) {}
  }

  function removeOverlayImageByElement(wrap) {
    const id = wrap.getAttribute('data-id');
    if (!id) return;
    wrap.remove();
    overlayImages = overlayImages.filter(function(d) { return d.id !== id; });
    try {
      window.parent.postMessage({ type: 'overlay-images-changed', images: overlayImages }, '*');
    } catch (e) {}
  }

  function tryRemovePageOverlayAt(clientX, clientY) {
    if (typeof document.elementsFromPoint !== 'function') return false;
    const elements = document.elementsFromPoint(clientX, clientY);
    const pageOverlay = elements.find(function(el) {
      return el.closest && el.closest('.page-overlay-wrapper');
    });
    var wrapper = pageOverlay && pageOverlay.closest('.page-overlay-wrapper');
    if (wrapper) {
      wrapper.remove();
      return true;
    }
    return false;
  }

  function setupDrawing() {
    const canvas = ensureDrawLayer();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function startStroke(e) {
      e.preventDefault();
      const p = getCanvasCoords(canvas, e);
      if (currentTool === 'eraser') {
        drawing = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        if (tryRemovePageOverlayAt(clientX, clientY)) return;
        eraseAt(canvas, p.x, p.y);
        return;
      }
      drawing = true;
      currentStroke = [{ x: p.x, y: p.y }];
    }

    function moveStroke(e) {
      if (!drawing) return;
      e.preventDefault();
      const p = getCanvasCoords(canvas, e);
      if (currentTool === 'eraser') {
        eraseAt(canvas, p.x, p.y);
        return;
      }
      const last = currentStroke[currentStroke.length - 1];
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > SAMPLE_STEP) {
        const steps = Math.ceil(dist / SAMPLE_STEP);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          currentStroke.push({
            x: last.x + dx * t,
            y: last.y + dy * t
          });
        }
      } else {
        currentStroke.push({ x: p.x, y: p.y });
      }
      ctx.strokeStyle = STROKE_STYLE;
      ctx.lineWidth = LINE_WIDTH;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    function endStroke(e) {
      if (!drawing) return;
      e.preventDefault();
      drawing = false;
      if (currentTool === 'eraser') return;
      if (currentStroke.length > 0) {
        strokes.push(currentStroke);
        currentStroke = [];
        try {
          window.parent.postMessage({ type: 'draw-strokes-changed', strokes: strokes }, '*');
        } catch (err) {}
      }
    }

    canvas.addEventListener('mousedown', startStroke);
    canvas.addEventListener('mousemove', moveStroke);
    canvas.addEventListener('mouseup', endStroke);
    canvas.addEventListener('mouseleave', endStroke);
    canvas.addEventListener('touchstart', startStroke, { passive: false });
    canvas.addEventListener('touchmove', moveStroke, { passive: false });
    canvas.addEventListener('touchend', endStroke, { passive: false });
  }

  function abortStrokeInProgress() {
    if (!drawing) return;
    drawing = false;
    currentStroke = [];
    const canvas = document.getElementById('draw-layer');
    if (!canvas || !canvas.getContext) return;
    const size = getDocSize();
    redrawStrokes(canvas.getContext('2d'), size.width, size.height);
  }

  function setDrawPausedForIframePinch(paused) {
    if (!drawModeEnabled) return;
    const canvas = document.getElementById('draw-layer');
    if (!canvas) return;
    if (paused) {
      canvas.classList.add('draw-pinch-pause');
    } else {
      canvas.classList.remove('draw-pinch-pause');
    }
  }

  function onDocumentTouchPinchMaybePauseDraw(e) {
    if (!drawModeEnabled || !e.touches || e.touches.length < 2) return;
    abortStrokeInProgress();
    setDrawPausedForIframePinch(true);
  }

  function onDocumentTouchPinchMaybeResumeDraw(e) {
    if (!drawModeEnabled) return;
    if (!e.touches || e.touches.length < 2) {
      setDrawPausedForIframePinch(false);
    }
  }

  function setDrawTool(tool) {
    currentTool = (tool === 'eraser') ? 'eraser' : 'draw';
    const canvas = document.getElementById('draw-layer');
    if (canvas && drawModeEnabled) {
      canvas.style.cursor = currentTool === 'eraser' ? 'cell' : 'crosshair';
    }
  }

  function enableDrawMode() {
    drawModeEnabled = true;
    const canvas = ensureDrawLayer();
    canvas.classList.add('draw-mode');
    canvas.classList.remove('draw-pinch-pause');
    canvas.style.pointerEvents = 'auto';
    canvas.style.cursor = currentTool === 'eraser' ? 'cell' : 'crosshair';
  }

  function disableDrawMode() {
    drawModeEnabled = false;
    drawing = false;
    currentStroke = [];
    const canvas = document.getElementById('draw-layer');
    if (canvas) {
      canvas.classList.remove('draw-mode', 'draw-pinch-pause');
      canvas.style.pointerEvents = 'none';
      canvas.style.cursor = '';
    }
  }

  function addOverlayImage(src, options) {
    options = options || {};
    const id = options.id || 'overlay-img-' + Date.now();
    const size = getDocSize();
    const defaultW = 200;
    const defaultH = 120;
    const left = options.left != null ? options.left : (size.width - defaultW) / 2;
    const top = options.top != null ? options.top : (size.height - defaultH) / 2;
    const width = options.width || defaultW;
    const height = options.height || defaultH;

    const container = ensureOverlayImagesContainer();
    const wrap = document.createElement('div');
    wrap.className = 'overlay-image';
    wrap.setAttribute('data-id', id);
    wrap.style.cssText = 'position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + width + 'px;height:' + height + 'px;pointer-events:auto;cursor:move;z-index:1;display:flex;align-items:center;justify-content:center;overflow:visible;';
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.draggable = false;
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none;display:block;';
    wrap.appendChild(img);
    img.onload = function() {
      var nw = img.naturalWidth, nh = img.naturalHeight;
      if (nw && nh) {
        wrap.dataset.aspectRatio = String(nw / nh);
        var cw = parseFloat(wrap.style.width) || width, ch = parseFloat(wrap.style.height) || height;
        var scale = Math.min(cw / nw, ch / nh);
        var fitW = nw * scale, fitH = nh * scale;
        wrap.style.width = fitW + 'px';
        wrap.style.height = fitH + 'px';
        data.width = fitW;
        data.height = fitH;
      }
    };
    if (img.complete && img.naturalWidth && img.naturalHeight) {
      wrap.dataset.aspectRatio = String(img.naturalWidth / img.naturalHeight);
      var nw = img.naturalWidth, nh = img.naturalHeight;
      var cw = parseFloat(wrap.style.width) || width, ch = parseFloat(wrap.style.height) || height;
      var scale = Math.min(cw / nw, ch / nh);
      var fitW = nw * scale, fitH = nh * scale;
      wrap.style.width = fitW + 'px';
      wrap.style.height = fitH + 'px';
      data.width = fitW;
      data.height = fitH;
    }

    var HANDLE_SIZE = 8;
    var HANDLE_OFFSET = -HANDLE_SIZE / 2;
    var positions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    var getHandleCursor = function(pos) {
      var c = { nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize' };
      return c[pos] || 'move';
    };
    var getHandlePosition = function(pos) {
      var m = HANDLE_OFFSET;
      var s = HANDLE_SIZE;
      var o = {};
      if (pos.indexOf('n') !== -1) o.top = m + 'px';
      if (pos.indexOf('s') !== -1) o.bottom = m + 'px';
      if (pos.indexOf('e') !== -1) o.right = m + 'px';
      if (pos.indexOf('w') !== -1) o.left = m + 'px';
      if (pos === 'n' || pos === 's') o.left = '50%', o.marginLeft = m + 'px';
      if (pos === 'e' || pos === 'w') o.top = '50%', o.marginTop = m + 'px';
      return o;
    };
    positions.forEach(function(pos) {
      var h = document.createElement('div');
      h.className = 'overlay-image-handle overlay-image-handle-' + pos;
      h.setAttribute('data-handle', pos);
      h.style.cssText = 'position:absolute;width:' + HANDLE_SIZE + 'px;height:' + HANDLE_SIZE + 'px;background:#926E4C;border:1px solid #fff;border-radius:2px;cursor:' + getHandleCursor(pos) + ';z-index:10;touch-action:none;';
      var style = getHandlePosition(pos);
      for (var k in style) h.style[k] = style[k];
      wrap.appendChild(h);
    });

    var toolbar = document.createElement('div');
    toolbar.className = 'overlay-image-toolbar';
    function addToolbarBtn(icon, title, className, onClick) {
      var btn = document.createElement('button');
      btn.className = 'overlay-image-toolbar-btn' + (className ? ' ' + className : '');
      btn.type = 'button';
      btn.innerHTML = icon;
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      toolbar.appendChild(btn);
    }
    addToolbarBtn('&times;', 'Delete', 'delete', function() { removeOverlayImageByElement(wrap); try { window.parent.postMessage({ type: 'overlay-images-changed', images: overlayImages }, '*'); } catch (err) {} });
    addToolbarBtn('&#128274;', 'Lock', '', function() {
      wrap.classList.add('locked');
      wrap.classList.remove('selected');
    });
    addToolbarBtn('&#8595;', 'Send to back', '', function() {
      var parent = wrap.parentNode;
      if (parent && parent.firstChild !== wrap) parent.insertBefore(wrap, parent.firstChild);
    });
    addToolbarBtn('&#8593;', 'Bring to front', '', function() {
      var parent = wrap.parentNode;
      if (parent && parent.lastChild !== wrap) parent.appendChild(wrap);
    });
    addToolbarBtn('&#10607;', 'Send backward', '', function() {
      var prev = wrap.previousElementSibling;
      if (prev && wrap.parentNode) wrap.parentNode.insertBefore(wrap, prev);
    });
    addToolbarBtn('&#10606;', 'Bring forward', '', function() {
      var next = wrap.nextElementSibling;
      if (next && wrap.parentNode) wrap.parentNode.insertBefore(wrap, next.nextElementSibling);
    });
    addToolbarBtn('&#128190;', 'Duplicate', '', function() {
      var rot = parseFloat(wrap.getAttribute('data-rotate')) || 0;
      addOverlayImage(src, { left: (parseFloat(wrap.style.left) || 0) + 20, top: (parseFloat(wrap.style.top) || 0) + 20, width: parseFloat(wrap.style.width) || 200, height: parseFloat(wrap.style.height) || 120 });
      var all = container.querySelectorAll('.overlay-image');
      var dupEl = all[all.length - 1];
      if (dupEl && rot) { dupEl.setAttribute('data-rotate', rot); dupEl.style.transform = 'rotate(' + rot + 'deg)'; }
      try { window.parent.postMessage({ type: 'overlay-images-changed', images: overlayImages }, '*'); } catch (err) {}
    });
    toolbar.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    toolbar.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true });
    wrap.appendChild(toolbar);

    var rotateHandle = document.createElement('span');
    rotateHandle.className = 'overlay-image-rotate-handle';
    rotateHandle.innerHTML = '&#8635;';
    rotateHandle.title = 'Rotate';
    wrap.appendChild(rotateHandle);

    var lockBadge = document.createElement('button');
    lockBadge.className = 'overlay-image-lock-badge';
    lockBadge.type = 'button';
    lockBadge.innerHTML = '&#128274;';
    lockBadge.title = 'Unlock';
    lockBadge.setAttribute('aria-label', 'Unlock');
    lockBadge.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.remove('locked');
    });
    wrap.appendChild(lockBadge);

    container.appendChild(wrap);

    const data = { id, src, left, top, width, height };
    overlayImages.push(data);

    function setupRotation(handleEl) {
      let startAngle, startRot;
      function onDown(e) {
        e.preventDefault();
        e.stopPropagation();
        if (wrap.classList.contains('locked')) return;
        selectOverlayImage(wrap);
        var rect = wrap.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var mx = e.touches ? e.touches[0].clientX : e.clientX;
        var my = e.touches ? e.touches[0].clientY : e.clientY;
        startAngle = Math.atan2(my - cy, mx - cx) * 180 / Math.PI;
        startRot = parseFloat(wrap.getAttribute('data-rotate')) || 0;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
      }
      function onMove(e) {
        var rect = wrap.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var mx = e.touches ? e.touches[0].clientX : e.clientX;
        var my = e.touches ? e.touches[0].clientY : e.clientY;
        var curAngle = Math.atan2(my - cy, mx - cx) * 180 / Math.PI;
        var deg = startRot + (curAngle - startAngle);
        wrap.setAttribute('data-rotate', deg);
        wrap.style.transform = 'rotate(' + deg + 'deg)';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        document.removeEventListener('touchcancel', onUp);
      }
      handleEl.addEventListener('mousedown', onDown);
      handleEl.addEventListener('touchstart', onDown, { passive: false });
    }

    function setupDrag(el) {
      let startX, startY, startLeft, startTop;
      function onDown(e) {
        if (el.classList.contains('locked')) return;
        if (e.target.closest('.overlay-image-toolbar')) return;
        if (e.target.closest('.overlay-image-handle')) return;
        if (e.target.closest('.overlay-image-rotate-handle')) return;
        if (e.target.closest('.overlay-image-lock-badge')) return;
        e.preventDefault();
        if (currentTool === 'eraser') {
          removeOverlayImageByElement(el);
          e.stopPropagation();
          return;
        }
        selectOverlayImage(el);
        startX = e.touches ? e.touches[0].clientX : e.clientX;
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        startLeft = parseFloat(el.style.left) || 0;
        startTop = parseFloat(el.style.top) || 0;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
      }
      function onMove(e) {
        const x = e.touches ? e.touches[0].clientX : e.clientX;
        const y = e.touches ? e.touches[0].clientY : e.clientY;
        const newLeft = startLeft + (x - startX);
        const newTop = startTop + (y - startY);
        el.style.left = newLeft + 'px';
        el.style.top = newTop + 'px';
        data.left = newLeft;
        data.top = newTop;
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        document.removeEventListener('touchcancel', onUp);
        try { window.parent.postMessage({ type: 'overlay-images-changed', images: overlayImages }, '*'); } catch (e) {}
      }
      el.addEventListener('mousedown', onDown);
      el.addEventListener('touchstart', onDown, { passive: false });
    }

    function setupResize(handleEl, pos) {
      let startX, startY, startLeft, startTop, startW, startH;
      function onDown(e) {
        e.preventDefault();
        e.stopPropagation();
        if (wrap.classList.contains('locked')) return;
        if (currentTool === 'eraser') {
          removeOverlayImageByElement(wrap);
          return;
        }
        selectOverlayImage(wrap);
        startX = e.touches ? e.touches[0].clientX : e.clientX;
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        startLeft = parseFloat(wrap.style.left) || 0;
        startTop = parseFloat(wrap.style.top) || 0;
        startW = parseFloat(wrap.style.width) || width;
        startH = parseFloat(wrap.style.height) || height;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
      }
      function onMove(e) {
        const x = e.touches ? e.touches[0].clientX : e.clientX;
        const y = e.touches ? e.touches[0].clientY : e.clientY;
        const dx = x - startX;
        const dy = y - startY;
        const aspect = parseFloat(wrap.dataset.aspectRatio) || startW / startH;
        let newLeft = startLeft, newTop = startTop, newW = startW, newH = startH;
        if (pos.length === 2) {
          var sw = startW, sh = startH;
          if (Math.abs(dx / sw) >= Math.abs(dy / sh)) {
            newW = Math.max(MIN_IMAGE_SIZE, sw + (pos.indexOf('e') !== -1 ? dx : -dx));
            newLeft = pos.indexOf('w') !== -1 ? startLeft + (sw - newW) : startLeft;
            newH = newW / aspect;
            newTop = pos.indexOf('n') !== -1 ? startTop + (startH - newH) : startTop;
          } else {
            newH = Math.max(MIN_IMAGE_SIZE, sh + (pos.indexOf('s') !== -1 ? dy : -dy));
            newTop = pos.indexOf('n') !== -1 ? startTop + (startH - newH) : startTop;
            newW = newH * aspect;
            newLeft = pos.indexOf('w') !== -1 ? startLeft + (startW - newW) : startLeft;
          }
        } else if (pos.indexOf('e') !== -1) {
          newW = Math.max(MIN_IMAGE_SIZE, startW + dx);
          newH = newW / aspect;
        } else if (pos.indexOf('w') !== -1) {
          newW = Math.max(MIN_IMAGE_SIZE, startW - dx);
          newLeft = startLeft + (startW - newW);
          newH = newW / aspect;
        } else if (pos.indexOf('s') !== -1) {
          newH = Math.max(MIN_IMAGE_SIZE, startH + dy);
          newW = newH * aspect;
        } else if (pos.indexOf('n') !== -1) {
          newH = Math.max(MIN_IMAGE_SIZE, startH - dy);
          newTop = startTop + (startH - newH);
          newW = newH * aspect;
        }
        wrap.style.left = newLeft + 'px';
        wrap.style.top = newTop + 'px';
        wrap.style.width = newW + 'px';
        wrap.style.height = newH + 'px';
        data.left = newLeft;
        data.top = newTop;
        data.width = newW;
        data.height = newH;
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        document.removeEventListener('touchcancel', onUp);
        try { window.parent.postMessage({ type: 'overlay-images-changed', images: overlayImages }, '*'); } catch (e) {}
      }
      handleEl.addEventListener('mousedown', onDown);
      handleEl.addEventListener('touchstart', onDown, { passive: false });
    }

    function selectOverlayImage(el) {
      container.querySelectorAll('.overlay-image.selected').forEach(function(e) { e.classList.remove('selected'); });
      el.classList.add('selected');
    }
    wrap.addEventListener('mousedown', function(e) {
      if (e.target.closest('.overlay-image-handle')) return;
      if (e.target.closest('.overlay-image-rotate-handle')) return;
      if (e.target.closest('.overlay-image-toolbar')) return;
      if (e.target.closest('.overlay-image-lock-badge')) return;
      if (wrap.classList.contains('locked')) return;
      selectOverlayImage(wrap);
    });
    wrap.addEventListener('touchstart', function(e) {
      if (e.target.closest('.overlay-image-handle')) return;
      if (e.target.closest('.overlay-image-rotate-handle')) return;
      if (e.target.closest('.overlay-image-toolbar')) return;
      if (e.target.closest('.overlay-image-lock-badge')) return;
      if (wrap.classList.contains('locked')) return;
      selectOverlayImage(wrap);
    }, { passive: true });

    setupDrag(wrap);
    setupRotation(rotateHandle);
    wrap.querySelectorAll('.overlay-image-handle').forEach(function(h) {
      setupResize(h, h.getAttribute('data-handle'));
    });
  }

  function setOverlayImages(images) {
    const container = document.getElementById('overlay-images-container');
    if (!container) return;
    overlayImages = [];
    container.querySelectorAll('.overlay-image').forEach(function(el) { el.remove(); });
    (Array.isArray(images) ? images : []).forEach(function(data) {
      addOverlayImage(data.src, { id: data.id, left: data.left, top: data.top, width: data.width, height: data.height });
    });
  }

  function getOverlayImages() {
    return overlayImages.slice();
  }

  function setStrokes(newStrokes) {
    strokes = Array.isArray(newStrokes) ? newStrokes : [];
    const size = getDocSize();
    const canvas = document.getElementById('draw-layer');
    if (canvas && canvas.getContext) {
      redrawStrokes(canvas.getContext('2d'), size.width, size.height);
    }
  }

  function getStrokes() {
    return strokes.map(function(s) { return s.slice(); });
  }

  window.enableDrawMode = enableDrawMode;
  window.disableDrawMode = disableDrawMode;
  /** Called by parent shell iframe pan: cancel in-progress stroke before pan takes over. */
  window.abortStrokeInProgress = abortStrokeInProgress;
  /** Pause/resume draw-layer hit-testing (same as two-finger pinch pause). */
  window.setDrawPausedForShellPan = setDrawPausedForIframePinch;
  window.setDrawTool = setDrawTool;
  window.getStrokes = getStrokes;
  window.setStrokes = setStrokes;
  window.addOverlayImage = addOverlayImage;
  window.getOverlayImages = getOverlayImages;
  window.setOverlayImages = setOverlayImages;
  window.resizeDrawLayer = resizeDrawLayer;

  ensureOverlayContainer();
  ensureOverlayImagesContainer();
  ensureDrawLayer();
  resizeDrawLayer();
  setupDrawing();

  /** While two fingers are on the iframe, pause draw-layer hit-testing so shell / graphic pinch wins; abort any in-progress stroke. */
  const pinchPauseCap = { capture: true, passive: true };
  document.addEventListener('touchstart', onDocumentTouchPinchMaybePauseDraw, pinchPauseCap);
  document.addEventListener('touchmove', onDocumentTouchPinchMaybePauseDraw, pinchPauseCap);
  document.addEventListener('touchend', onDocumentTouchPinchMaybeResumeDraw, pinchPauseCap);
  document.addEventListener('touchcancel', onDocumentTouchPinchMaybeResumeDraw, pinchPauseCap);

  /** Two-finger pinch on a selected (unlocked) overlay image or page-overlay scales the graphic instead of the shell camera. */
  let selectedGraphicPinch = null;

  function getUnlockedSelectedGraphicRoot() {
    const img = document.querySelector('.overlay-image.selected:not(.locked)');
    const page = document.querySelector('.page-overlay-wrapper.selected:not(.locked)');
    return img || page || null;
  }

  /** Use client coordinates so pinch still hits the graphic when event targets are wrong; pad for toolbar/handles. */
  function bothTouchesInside(el, e) {
    if (!el || !e.touches || e.touches.length < 2) return false;
    const br = el.getBoundingClientRect();
    const pad = 56;
    const left = br.left - pad;
    const right = br.right + pad;
    const top = br.top - pad;
    const bottom = br.bottom + pad;
    const inside = function(t) {
      var x = t.clientX;
      var y = t.clientY;
      return x >= left && x <= right && y >= top && y <= bottom;
    };
    return inside(e.touches[0]) && inside(e.touches[1]);
  }

  function onSelectedGraphicPinchStart(e) {
    if (e.touches.length !== 2) return;
    const el = getUnlockedSelectedGraphicRoot();
    if (!el || !bothTouchesInside(el, e)) return;
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const initialSpan = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    if (initialSpan < 1) return;
    e.preventDefault();
    e.stopPropagation();
    const baseW = parseFloat(el.style.width) || el.offsetWidth || MIN_IMAGE_SIZE;
    const baseH = parseFloat(el.style.height) || el.offsetHeight || MIN_IMAGE_SIZE;
    const baseLeft = parseFloat(el.style.left) || 0;
    const baseTop = parseFloat(el.style.top) || 0;
    let aspect = baseW / Math.max(baseH, 1);
    if (el.dataset && el.dataset.aspectRatio) {
      const ar = parseFloat(el.dataset.aspectRatio);
      if (ar > 0 && Number.isFinite(ar)) aspect = ar;
    }
    selectedGraphicPinch = {
      el: el,
      initialSpan: initialSpan,
      baseW: baseW,
      baseH: baseH,
      baseLeft: baseLeft,
      baseTop: baseTop,
      aspect: aspect
    };
  }

  function applySelectedGraphicPinchSize(el, newW, newH, newLeft, newTop) {
    el.style.left = newLeft + 'px';
    el.style.top = newTop + 'px';
    el.style.width = newW + 'px';
    el.style.height = newH + 'px';
    if (el.classList.contains('overlay-image')) {
      const id = el.getAttribute('data-id');
      if (id) {
        const row = overlayImages.find(function(d) { return d.id === id; });
        if (row) {
          row.left = newLeft;
          row.top = newTop;
          row.width = newW;
          row.height = newH;
        }
      }
    }
  }

  function onSelectedGraphicPinchMove(e) {
    if (!selectedGraphicPinch || e.touches.length !== 2) return;
    e.preventDefault();
    e.stopPropagation();
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const span = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const g = selectedGraphicPinch;
    if (g.initialSpan < 1) return;
    const scale = span / g.initialSpan;
    const newW = Math.max(MIN_IMAGE_SIZE, g.baseW * scale);
    const newH = Math.max(MIN_IMAGE_SIZE, newW / g.aspect);
    const cx = g.baseLeft + g.baseW / 2;
    const cy = g.baseTop + g.baseH / 2;
    applySelectedGraphicPinchSize(g.el, newW, newH, cx - newW / 2, cy - newH / 2);
  }

  function endSelectedGraphicPinch() {
    if (!selectedGraphicPinch) return;
    selectedGraphicPinch = null;
    try {
      if (document.querySelector('.overlay-image.selected')) {
        window.parent.postMessage({ type: 'overlay-images-changed', images: overlayImages }, '*');
      }
    } catch (err) {}
  }

  document.addEventListener('touchstart', onSelectedGraphicPinchStart, { capture: true, passive: false });
  document.addEventListener('touchmove', onSelectedGraphicPinchMove, { capture: true, passive: false });
  document.addEventListener('touchend', function(e) {
    if (selectedGraphicPinch && (!e.touches || e.touches.length < 2)) endSelectedGraphicPinch();
  }, { capture: true });
  document.addEventListener('touchcancel', function() {
    endSelectedGraphicPinch();
  }, { capture: true });

  function deselectOverlayImages() {
    document.querySelectorAll('.overlay-image.selected').forEach(function(el) { el.classList.remove('selected'); });
  }
  document.addEventListener('click', function(e) {
    if (!e.target.closest || !e.target.closest('.overlay-image')) deselectOverlayImages();
  });
  document.addEventListener('touchend', function(e) {
    if (e.changedTouches && e.changedTouches[0]) {
      var t = document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      if (!t || !t.closest || !t.closest('.overlay-image')) deselectOverlayImages();
    }
  }, { passive: true });
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    var sel = document.querySelector('.overlay-image.selected');
    if (sel) {
      e.preventDefault();
      removeOverlayImageByElement(sel);
      try { window.parent.postMessage({ type: 'overlay-images-changed', images: overlayImages }, '*'); } catch (err) {}
    }
  });

  window.addEventListener('message', function(e) {
    const d = e.data;
    if (!d || d.source === 'sidebar-invoice') return;
    if (d.type === 'draw-mode') {
      if (d.enabled) enableDrawMode(); else disableDrawMode();
    } else if (d.type === 'draw-set-tool') {
      setDrawTool(d.tool);
    } else if (d.type === 'draw-set-strokes') {
      setStrokes(d.strokes);
    } else if (d.type === 'draw-resize') {
      resizeDrawLayer();
    } else if (d.type === 'overlay-add-image') {
      addOverlayImage(d.src, d.options);
    } else if (d.type === 'overlay-set-images') {
      setOverlayImages(d.images);
    }
  });

  const resizeObs = new ResizeObserver(function() {
    resizeDrawLayer();
  });
  resizeObs.observe(document.body);
})();
