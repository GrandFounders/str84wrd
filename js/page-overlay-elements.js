/**
 * Page overlay elements: draggable, resizable, selectable shapes, text, stamps.
 * Injected into iframe when pageOverlays container is created.
 * Exposes: makePageOverlayInteractable, makePageOverlayDraggable, makeDrawWrapperDraggable, makePageOverlayDrawable
 */
(function() {
  'use strict';

  (function injectStyles() {
    if (document.getElementById('page-overlay-elements-styles')) return;
    var style = document.createElement('style');
    style.id = 'page-overlay-elements-styles';
    style.textContent = '.page-overlay-wrapper .page-overlay-handle{opacity:0;pointer-events:none;transition:opacity 0.15s}.page-overlay-wrapper.selected .page-overlay-handle{opacity:1;pointer-events:auto}.page-overlay-wrapper.selected{outline:1px dashed #926E4C;outline-offset:2px}.page-overlay-wrapper{touch-action:none}.page-overlay-wrapper .page-overlay-handle{touch-action:none}.page-overlay-toolbar{position:absolute;top:-36px;left:0;right:0;display:flex;gap:4px;justify-content:center;flex-wrap:wrap;opacity:0;pointer-events:none;z-index:11;transition:opacity 0.15s}.page-overlay-wrapper.selected .page-overlay-toolbar{opacity:1;pointer-events:auto}.page-overlay-toolbar-btn{width:24px;height:24px;background:#926E4C;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;touch-action:manipulation;flex-shrink:0}.page-overlay-toolbar-btn:hover{background:#7a5a3d}.page-overlay-toolbar-btn.delete{background:#c45c1a}.page-overlay-toolbar-btn.delete:hover{background:#a34a15}.page-overlay-rotate-handle{position:absolute;top:-56px;left:50%;margin-left:-10px;width:20px;height:20px;border-radius:50%;background:#926E4C;border:1px solid #fff;cursor:grab;z-index:12;opacity:0;pointer-events:none;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff}.page-overlay-wrapper.selected .page-overlay-rotate-handle{opacity:1;pointer-events:auto}.page-overlay-wrapper.locked .page-overlay-handle,.page-overlay-wrapper.locked .page-overlay-toolbar,.page-overlay-wrapper.locked .page-overlay-rotate-handle{opacity:0!important;pointer-events:none!important}.page-overlay-wrapper.locked .page-overlay-lock-badge{opacity:1!important;pointer-events:auto!important}.page-overlay-lock-badge{position:absolute;bottom:2px;right:2px;width:20px;height:20px;background:#926E4C;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;z-index:20;transition:opacity 0.15s}body.capture-exporting .page-overlay-handle,body.capture-exporting .page-overlay-toolbar,body.capture-exporting .page-overlay-rotate-handle,body.capture-exporting .page-overlay-lock-badge{display:none!important}body.capture-exporting .page-overlay-wrapper.selected{outline:none!important}@media (pointer:coarse){.page-overlay-handle{min-width:20px;min-height:20px;flex-shrink:0}.page-overlay-toolbar{top:-44px}.page-overlay-toolbar-btn{width:28px;height:28px;font-size:14px;min-width:28px;min-height:28px}.page-overlay-rotate-handle{top:-60px;width:20px;height:20px;margin-left:-10px;min-width:20px;min-height:20px}.page-overlay-lock-badge{width:22px;height:22px;min-width:22px;min-height:22px;font-size:11px}}';
    (document.head || document.documentElement).appendChild(style);
  })();

  function getClientXY(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length > 0) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  var MIN_SIZE = 20;
  var HANDLE_SIZE = 8;
  var HANDLE_OFFSET = -HANDLE_SIZE / 2;
  var BORDER_COLOR = '#926E4C';

  function addResizeHandles(wrapper, innerEl, type) {
    var handles = [];
    var positions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    var lineOnly = type === 'line';
    if (lineOnly) positions = ['e', 'w'];

    positions.forEach(function(pos) {
      var h = document.createElement('div');
      h.className = 'page-overlay-handle page-overlay-handle-' + pos;
      h.setAttribute('data-handle', pos);
      h.style.cssText = 'position:absolute;width:' + HANDLE_SIZE + 'px;height:' + HANDLE_SIZE + 'px;background:' + BORDER_COLOR + ';border:1px solid #fff;border-radius:2px;cursor:' + getHandleCursor(pos) + ';z-index:10;';
      var style = getHandlePosition(pos);
      for (var k in style) h.style[k] = style[k];
      wrapper.appendChild(h);
      handles.push({ el: h, pos: pos });
    });
    return handles;
  }

  function getHandleCursor(pos) {
    var c = { nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize' };
    return c[pos] || 'move';
  }

  function getHandlePosition(pos) {
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
  }

  function getRect(el) {
    var s = el.style;
    return {
      left: parseFloat(s.left) || 0,
      top: parseFloat(s.top) || 0,
      width: parseFloat(s.width) || el.offsetWidth || 80,
      height: parseFloat(s.height) || el.offsetHeight || 50
    };
  }

  function setRect(el, r) {
    el.style.left = r.left + 'px';
    el.style.top = r.top + 'px';
    if (r.width != null) el.style.width = Math.max(MIN_SIZE, r.width) + 'px';
    if (r.height != null) el.style.height = Math.max(MIN_SIZE, r.height) + 'px';
  }

  function selectWrapper(w) {
    var prev = document.querySelector('.page-overlay-wrapper.selected');
    if (prev && prev !== w) prev.classList.remove('selected');
    w.classList.add('selected');
  }

  function deselectAll() {
    document.querySelectorAll('.page-overlay-wrapper.selected').forEach(function(el) { el.classList.remove('selected'); });
  }

  window.makePageOverlayInteractable = function(wrapper, innerEl, type) {
    wrapper.style.pointerEvents = 'auto';
    wrapper.style.cursor = 'move';
    wrapper.style.touchAction = type === 'text' ? 'manipulation' : 'none';
    innerEl.style.pointerEvents = type === 'text' ? 'auto' : 'none';
    if (type === 'text') {
      innerEl.style.cursor = 'text';
      innerEl.style.touchAction = 'auto';
    }

    var isLine = type === 'line';
    var isTriangle = type === 'triangle';

    var handles = addResizeHandles(wrapper, innerEl, type);
    if (type === 'stamp' && innerEl.tagName === 'IMG') {
      function setAspect() {
        var nw = innerEl.naturalWidth, nh = innerEl.naturalHeight;
        if (nw && nh) {
          wrapper.dataset.aspectRatio = String(nw / nh);
          var r = getRect(wrapper);
          var scale = Math.min(r.width / nw, r.height / nh);
          var fitW = nw * scale, fitH = nh * scale;
          setRect(wrapper, { left: r.left, top: r.top, width: fitW, height: fitH });
        }
      }
      innerEl.onload = setAspect;
      if (innerEl.complete && innerEl.naturalWidth && innerEl.naturalHeight) setAspect();
    }
    wrapper.classList.add('page-overlay-wrapper');
    wrapper.setAttribute('data-type', type);
    wrapper.style.transformOrigin = 'center center';

    var toolbar = document.createElement('div');
    toolbar.className = 'page-overlay-toolbar';

    function addToolbarBtn(icon, title, className, onClick) {
      var btn = document.createElement('button');
      btn.className = 'page-overlay-toolbar-btn' + (className ? ' ' + className : '');
      btn.type = 'button';
      btn.innerHTML = icon;
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); onClick(); });
      btn.addEventListener('touchend', function(e) {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }, { passive: false });
      toolbar.appendChild(btn);
    }

    addToolbarBtn('&times;', 'Delete', 'delete', function() { wrapper.remove(); });
    addToolbarBtn('&#128274;', 'Lock', 'lock', function() {
      wrapper.classList.add('locked');
      wrapper.classList.remove('selected');
    });
    addToolbarBtn('&#8595;', 'Send to back', '', function() {
      var parent = wrapper.parentNode;
      if (parent && parent.firstChild !== wrapper) parent.insertBefore(wrapper, parent.firstChild);
    });
    addToolbarBtn('&#8593;', 'Bring to front', '', function() {
      var parent = wrapper.parentNode;
      if (parent && parent.lastChild !== wrapper) parent.appendChild(wrapper);
    });
    addToolbarBtn('&#10607;', 'Send backward', '', function() {
      var prev = wrapper.previousElementSibling;
      if (prev && wrapper.parentNode) wrapper.parentNode.insertBefore(wrapper, prev);
    });
    addToolbarBtn('&#10606;', 'Bring forward', '', function() {
      var next = wrapper.nextElementSibling;
      if (next && wrapper.parentNode) wrapper.parentNode.insertBefore(wrapper, next.nextElementSibling);
    });
    addToolbarBtn('&#128190;', 'Duplicate', '', function() {
      var clone = wrapper.cloneNode(true);
      clone.style.left = (parseFloat(wrapper.style.left) || 0) + 20 + 'px';
      clone.style.top = (parseFloat(wrapper.style.top) || 0) + 20 + 'px';
      clone.style.transform = wrapper.style.transform || '';
      clone.setAttribute('data-rotate', wrapper.getAttribute('data-rotate') || '0');
      clone.classList.remove('selected', 'locked');
      clone.style.pointerEvents = '';
      wrapper.parentNode.appendChild(clone);
      var inner = clone.querySelector('[contenteditable]') || clone.querySelector('img') || (clone.querySelector('.page-overlay-text-drag') ? clone.children[1] : clone.children[0]);
      if (inner && typeof makePageOverlayInteractable === 'function') makePageOverlayInteractable(clone, inner, type);
    });

    wrapper.appendChild(toolbar);

    var rotateHandle = document.createElement('div');
    rotateHandle.className = 'page-overlay-rotate-handle';
    rotateHandle.innerHTML = '&#8635;';
    rotateHandle.title = 'Rotate (drag)';
    rotateHandle.setAttribute('aria-label', 'Rotate');
    (function() {
      var startAngle, startDeg;
      function getCenter() {
        var r = wrapper.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      function getAngle(c, p) {
        return Math.atan2(p.y - c.y, p.x - c.x) * 180 / Math.PI;
      }
      function onDown(e) {
        e.preventDefault();
        e.stopPropagation();
        selectWrapper(wrapper);
        var p = getClientXY(e);
        var c = getCenter();
        startAngle = getAngle(c, p);
        startDeg = parseFloat(wrapper.getAttribute('data-rotate')) || 0;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
      }
      function onMove(e) {
        e.preventDefault();
        var p = getClientXY(e);
        var c = getCenter();
        var newAngle = getAngle(c, p);
        var deg = startDeg + (newAngle - startAngle);
        wrapper.setAttribute('data-rotate', deg);
        wrapper.style.transform = 'rotate(' + deg + 'deg)';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        document.removeEventListener('touchcancel', onUp);
      }
      rotateHandle.addEventListener('mousedown', onDown);
      rotateHandle.addEventListener('touchstart', onDown, { passive: false });
    })();
    wrapper.appendChild(rotateHandle);

    var lockBadge = document.createElement('button');
    lockBadge.className = 'page-overlay-lock-badge';
    lockBadge.type = 'button';
    lockBadge.innerHTML = '&#128274;';
    lockBadge.title = 'Locked - click to unlock';
    lockBadge.setAttribute('aria-label', 'Unlock');
    lockBadge.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      wrapper.classList.remove('locked');
    });
    lockBadge.addEventListener('touchend', function(e) {
      e.preventDefault();
      e.stopPropagation();
      wrapper.classList.remove('locked');
    }, { passive: false });
    wrapper.appendChild(lockBadge);

    function setupDrag() {
      var startX, startY, startLeft, startTop;
      function onDown(e) {
        if (e.target.closest && e.target.closest('.page-overlay-handle')) return;
        if (e.target.closest && e.target.closest('.page-overlay-rotate-handle')) return;
        if (type === 'text' && e.target === innerEl) return;
        if (wrapper.classList.contains('locked')) return;
        e.preventDefault();
        e.stopPropagation();
        selectWrapper(wrapper);
        var p = getClientXY(e);
        startX = p.x;
        startY = p.y;
        startLeft = parseFloat(wrapper.style.left) || 0;
        startTop = parseFloat(wrapper.style.top) || 0;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
      }
      function onMove(e) {
        e.preventDefault();
        var p = getClientXY(e);
        wrapper.style.left = (startLeft + (p.x - startX)) + 'px';
        wrapper.style.top = (startTop + (p.y - startY)) + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        document.removeEventListener('touchcancel', onUp);
      }
      wrapper.addEventListener('mousedown', onDown);
      wrapper.addEventListener('touchstart', onDown, { passive: false });
      if (type !== 'text') {
        innerEl.addEventListener('mousedown', onDown);
        innerEl.addEventListener('touchstart', onDown, { passive: false });
      }
    }

    function setupResize(handleEl, pos) {
      var startX, startY, startRect;
      function onDown(e) {
        e.preventDefault();
        e.stopPropagation();
        if (wrapper.classList.contains('locked')) return;
        selectWrapper(wrapper);
        var p = getClientXY(e);
        startX = p.x;
        startY = p.y;
        startRect = getRect(wrapper);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
      }
      function onMove(e) {
        e.preventDefault();
        var p = getClientXY(e);
        var dx = p.x - startX;
        var dy = p.y - startY;
        var r = { left: startRect.left, top: startRect.top, width: startRect.width, height: startRect.height };
        var aspect = type === 'stamp' ? parseFloat(wrapper.dataset.aspectRatio) : 0;
        if (aspect && aspect > 0) {
          var sw = startRect.width, sh = startRect.height;
          if (pos.indexOf('e') !== -1) { r.width = Math.max(MIN_SIZE, sw + dx); r.height = r.width / aspect; }
          else if (pos.indexOf('w') !== -1) { r.width = Math.max(MIN_SIZE, sw - dx); r.left = startRect.left + (sw - r.width); r.height = r.width / aspect; }
          else if (pos.indexOf('s') !== -1) { r.height = Math.max(MIN_SIZE, sh + dy); r.width = r.height * aspect; }
          else if (pos.indexOf('n') !== -1) { r.height = Math.max(MIN_SIZE, sh - dy); r.top = startRect.top + (sh - r.height); r.width = r.height * aspect; }
          else if (pos.length === 2) {
            var dw = (pos.indexOf('e') !== -1 ? dx : -dx);
            var dh = (pos.indexOf('s') !== -1 ? dy : -dy);
            if (Math.abs(dw / sw) >= Math.abs(dh / sh)) {
              r.width = Math.max(MIN_SIZE, sw + (pos.indexOf('e') !== -1 ? dx : -dx));
              r.left = pos.indexOf('w') !== -1 ? startRect.left + (sw - r.width) : startRect.left;
              r.height = r.width / aspect;
              r.top = pos.indexOf('n') !== -1 ? startRect.top + (sh - r.height) : startRect.top;
            } else {
              r.height = Math.max(MIN_SIZE, sh + (pos.indexOf('s') !== -1 ? dy : -dy));
              r.top = pos.indexOf('n') !== -1 ? startRect.top + (sh - r.height) : startRect.top;
              r.width = r.height * aspect;
              r.left = pos.indexOf('w') !== -1 ? startRect.left + (sw - r.width) : startRect.left;
            }
          }
        } else {
          if (pos.indexOf('e') !== -1) r.width = Math.max(MIN_SIZE, startRect.width + dx);
          if (pos.indexOf('w') !== -1) { r.left = startRect.left + dx; r.width = Math.max(MIN_SIZE, startRect.width - dx); }
          if (pos.indexOf('s') !== -1) r.height = Math.max(MIN_SIZE, startRect.height + dy);
          if (pos.indexOf('n') !== -1) { r.top = startRect.top + dy; r.height = Math.max(MIN_SIZE, startRect.height - dy); }
        }
        if (isLine) r.height = 4;
        setRect(wrapper, r);
        if (isTriangle) {
          var h = r.height;
          var w = r.width;
          innerEl.style.borderLeftWidth = (w / 2) + 'px';
          innerEl.style.borderRightWidth = (w / 2) + 'px';
          innerEl.style.borderBottomWidth = h + 'px';
        }
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

    handles.forEach(function(h) { setupResize(h.el, h.pos); });
    setupDrag();

    wrapper.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    wrapper.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true });
  };

  function shouldDeselect(e) {
    var target = e.target;
    if (e.changedTouches && e.changedTouches.length > 0) {
      var t = e.changedTouches[0];
      target = document.elementFromPoint(t.clientX, t.clientY) || target;
    }
    return !(target && target.closest && target.closest('.page-overlay-wrapper'));
  }
  document.addEventListener('click', function(e) {
    if (e.target.closest && e.target.closest('.page-overlay-wrapper')) return;
    deselectAll();
  });
  document.addEventListener('touchend', function(e) {
    if (shouldDeselect(e)) deselectAll();
  }, { passive: true });

  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    var sel = document.querySelector('.page-overlay-wrapper.selected');
    if (sel) {
      e.preventDefault();
      sel.remove();
    }
  });

  window.makePageOverlayDraggable = function(el) {
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'move';
    el.style.touchAction = 'none';
    var lastX = 0, lastY = 0, dragging = false;
    function onDown(e) {
      e.preventDefault();
      dragging = true;
      var p = getClientXY(e);
      lastX = p.x;
      lastY = p.y;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
      document.addEventListener('touchcancel', onUp);
    }
    function onMove(e) {
      if (!dragging) return;
      e.preventDefault();
      var p = getClientXY(e);
      el.style.left = ((parseFloat(el.style.left) || 0) + (p.x - lastX)) + 'px';
      el.style.top = ((parseFloat(el.style.top) || 0) + (p.y - lastY)) + 'px';
      lastX = p.x;
      lastY = p.y;
    }
    function onUp() {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('touchcancel', onUp);
    }
    el.addEventListener('mousedown', onDown);
    el.addEventListener('touchstart', onDown, { passive: false });
  };

  window.makeDrawWrapperDraggable = function(wrapper, handle) {
    handle.style.cursor = 'move';
    handle.style.pointerEvents = 'auto';
    var lastX, lastY, dragging = false;
    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      var left = (parseFloat(wrapper.style.left) || 0) + (e.clientX - lastX);
      var top = (parseFloat(wrapper.style.top) || 0) + (e.clientY - lastY);
      wrapper.style.left = left + 'px';
      wrapper.style.top = top + 'px';
      lastX = e.clientX;
      lastY = e.clientY;
    });
    document.addEventListener('mouseup', function() { dragging = false; });
  };

  window.makePageOverlayDrawable = function(canvas) {
    canvas.style.pointerEvents = 'auto';
    canvas.style.cursor = 'crosshair';
    var ctx = canvas.getContext('2d');
    var drawing = false, lastX, lastY;
    function getXY(e) {
      var r = canvas.getBoundingClientRect();
      var s = canvas.width / r.width;
      return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s };
    }
    canvas.addEventListener('mousedown', function(e) {
      drawing = true;
      var p = getXY(e);
      lastX = p.x;
      lastY = p.y;
    });
    canvas.addEventListener('mousemove', function(e) {
      if (!drawing) return;
      var p = getXY(e);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastX = p.x;
      lastY = p.y;
    });
    document.addEventListener('mouseup', function() { drawing = false; });
    ctx.strokeStyle = '#926E4C';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
  };
})();
