/**
 * CanvasShellControls: infinite canvas / iframe chrome, drawers, Settings, postMessage to templates.
 * @file canvas-shell-ctrls.js
 */
    // ========================================
    // ARCHITECTURE (separation of concerns)
    // ========================================
    // - index.html + invoice-shell-bootstrap.js + canvas-shell-ctrls.js: CanvasShellControls — canvas, drawers, Settings,
    //   localStorage for products/clients/company/settings, and postMessage to #invoiceFrame.
    // - templates/invoice.html: StaticInvoiceApp = full invoice document (table, totals, draft,
    //   list UI). Reload shared data via syncSharedDataFromStorage when the shell saves settings.
    //
    // ========================================
    // CANVAS SHELL CONTROLS (parent page)
    // ========================================

    /** Avoid Chrome "Ignored attempt to cancel…" when the browser owns scrolling (non-cancelable touch). */
    function shellPreventDefaultIfCancelable(ev) {
      if (ev && ev.cancelable) ev.preventDefault();
    }

    /**
     * Infinite canvas, mobile/chrome UI, Settings modal, postMessage to invoice iframe.
     * Invoice markup, line items, and totals live in templates/invoice.html only.
     */
    class CanvasShellControls {
      constructor() {
        this.currentMode = 'edit';
        this.data = {
          products: [],
          clients: [],
          company: {},
          settings: { currentMode: 'edit', autoSave: true, defaultCurrency: '£' }
        };
        
        this.init();
      }
      
      init() {
        console.log('🚀 Initializing canvas shell controls (parent window)...');
        
        this.loadData();
        
        this.initModeToggle();
        this.initSideMenu();
        this.initZoomMenu();
        if (typeof initCategoryShortcutDrawer === 'function') initCategoryShortcutDrawer();
        this.initDataManagement();
        this.initSaveFunctionality();
        
        this.initInfiniteCanvas();
        this.initShellZoomPrevention();
        
        console.log('✅ Canvas shell ready — invoice UI loads inside #invoiceFrame');
      }
      
      // ========================================
      // INFINITE CANVAS FUNCTIONALITY
      // ========================================
      
      initInfiniteCanvas() {
        // Camera system properties
        this.camera = {
          x: 0,           // Camera position in world coordinates
          y: 0,           // Camera position in world coordinates
          zoom: 1,        // Camera zoom level
          width: 0,       // Viewport width
          height: 0       // Viewport height
        };
        this._workspaceGestureActive = false;
        this._shellPinchActive = false;
        this._shellPinchLoggedThisGesture = false;
        /** Smoothed pinch centroid (parent client px) — cuts pan explosions when fingers drift while pinching. */
        this._pinchFocalSmooth = null;
        /** EMA of raw span/lastSpan — touch/trackpad reports swing 0.9↔1.1 each frame without this. */
        this._pinchScaleEma = null;
        this._shellDebugThrottles = Object.create(null);
        /** Inertial pan (trackpad coast + touch flick), camera px per ~60fps frame. */
        this._shellPanMomentumVel = { vx: 0, vy: 0 };
        this._shellPanMomentumRaf = null;
        this._shellPanMomFrameTs = null;
        /** Last touch sample for flick velocity (client px + time). */
        this._touchPanInertPrev = null;
        this._touchPanInertEma = { vx: 0, vy: 0 };

        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;

        const canvas = document.getElementById('infiniteCanvas');
        const overlay = document.getElementById('canvasOverlay');
        
        if (canvas && overlay) {
          // Set canvas size to match viewport
          this.resizeCanvas();
          
          // Initialize 2D context
          this.ctx = canvas.getContext('2d');
          
          this.addCanvasNavigation(canvas);
          this.updateCanvasTransform();
          if (this.isShellCameraDebug()) {
            console.log(
              '%c[shell-camera] debug ON',
              'color:#0ae;font-weight:bold',
              '— pinch (100ms throttle), pan (200ms), clamp (immediate). Off: canvasShell.setShellCameraDebug(false)'
            );
            this.logShellDebugSnapshot('init');
          }
          this.initIframeResizing();
          this.initSidebarFrameZoomBridge();
          
          // Center iframe after initialization
          // On mobile, wait a bit longer for iframe to load and size properly
          const initDelay = this.isMobileDevice() ? 800 : 200;
          setTimeout(() => {
            this.centerIframeInViewport();
          }, initDelay);
          
          // Handle window resize
          window.addEventListener('resize', () => {
            this.resizeCanvas();
            // On mobile, recalculate zoom if needed but do NOT re-center (avoids snapping on every resize/action)
            if (this.isMobileDevice()) {
              setTimeout(() => {
                const mobileZoom = this.calculateInitialMobileZoom();
                if (mobileZoom && mobileZoom < this.camera.zoom) {
                  this.camera.zoom = mobileZoom;
                }
                this.updateCanvasTransform();
              }, 100);
            }
            this.updateCanvasTransform();
          });
          
          console.log('🎨 2D Camera system initialized');
        }
      }

      resizeCanvas() {
        const canvas = document.getElementById('infiniteCanvas');
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          canvas.width = rect.width;
          canvas.height = rect.height;
          
          // Update camera viewport dimensions
          this.camera.width = rect.width;
          this.camera.height = rect.height;
        }
      }

      initZoomMenu() {
        const drawer = document.getElementById('zoomDrawer');
        const handleTop = document.getElementById('zoomDrawerHandleTop');
        const handleBottom = document.getElementById('zoomDrawerHandleBottom');
        
        // Ensure drawer starts open so zoom bar is always visible
        if (drawer && !drawer.classList.contains('open')) {
          drawer.classList.add('open');
        }

        // Load saved drawer position
        this.loadDrawerPosition();

        // Initialize dragging for both handles
        if (drawer) {
          if (handleTop) {
            this.initDrawerDragging(drawer, handleTop);
          }
          if (handleBottom) {
            this.initDrawerDragging(drawer, handleBottom);
          }
        }

        // Initialize auto-fade (still uses zoomToggle for idle behaviour)
        this.initAutoFade();
      }
      
      initSideMenu() {
        const toggle = document.getElementById('zoomToggle');
        const drawer = document.getElementById('mobileDrawer');
        const overlay = document.getElementById('mobileOverlay');
        const openMenu = () => {
          if (toggle) toggle.classList.add('open');
          if (drawer) drawer.classList.add('open');
          if (overlay) overlay.classList.add('open');
          document.body.style.overflow = 'hidden';
        };
        const closeMenu = () => {
          if (toggle) toggle.classList.remove('open');
          if (drawer) drawer.classList.remove('open');
          if (overlay) overlay.classList.remove('open');
          document.body.style.overflow = '';
        };

        // Long-press on hamburger opens floating shortcut menu; short click toggles side menu
        const LONG_PRESS_MS = 450;
        let longPressTimer = null;
        let longPressHandled = false;
        const startLongPress = () => {
          longPressHandled = false;
          longPressTimer = setTimeout(() => {
            longPressTimer = null;
            longPressHandled = true;
            if (typeof openCategoryShortcutDrawer === 'function') {
              openCategoryShortcutDrawer('New');
            }
          }, LONG_PRESS_MS);
        };
        const cancelLongPress = () => {
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        };
        if (toggle) {
          toggle.addEventListener('mousedown', startLongPress);
          toggle.addEventListener('mouseup', cancelLongPress);
          toggle.addEventListener('mouseleave', cancelLongPress);
          toggle.addEventListener('touchstart', startLongPress, { passive: true });
          toggle.addEventListener('touchend', cancelLongPress, { passive: true });
          toggle.addEventListener('touchcancel', cancelLongPress, { passive: true });
          toggle.addEventListener('click', (e) => {
            if (longPressHandled) {
              longPressHandled = false;
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            drawer && drawer.classList.contains('open') ? closeMenu() : openMenu();
          });
        }
        if (overlay) overlay.addEventListener('click', closeMenu);
        if (drawer) drawer.querySelectorAll('.menu-item, .mode-btn').forEach(el => {
          el.addEventListener('click', closeMenu);
        });
      }

      // ========================================
      // IFRAME ACTION BRIDGE (Settings > Export/Import)
      // ========================================
      getInvoiceFrame() {
        return document.getElementById('invoiceFrame');
      }

      invoiceAction(action, payload) {
        const iframe = this.getInvoiceFrame();
        if (!iframe || !iframe.contentWindow) {
          console.warn('⚠️ invoiceFrame not ready for action:', action);
          return;
        }
        iframe.contentWindow.postMessage({ type: 'invoice-action', action, payload }, '*');
      }

      invoiceImportFile(file) {
        if (!file) return;
        this.invoiceAction('importFromFile', { file });
      }

      /** Parent wrote shared catalog/company to localStorage — refresh the iframe document. */
      syncInvoiceFrameFromStorage() {
        this.invoiceAction('syncSharedDataFromStorage');
      }

      initAutoFade() {
        const toggle = document.getElementById('zoomToggle');
        const drawer = document.getElementById('zoomDrawer');
        if (!toggle || !drawer) return;

        let idleTimer = null;
        const IDLE_DELAY = 3000; // 3 seconds of inactivity

        const resetIdleTimer = () => {
          // Clear existing timer
          if (idleTimer) {
            clearTimeout(idleTimer);
          }
          
          // Remove idle state
          toggle.classList.remove('idle');
          if (drawer.classList.contains('open')) {
            drawer.classList.remove('idle');
          }

          // Set new timer
          idleTimer = setTimeout(() => {
            // Only fade if drawer is open
            if (drawer.classList.contains('open')) {
              drawer.classList.add('idle');
            }
            toggle.classList.add('idle');
          }, IDLE_DELAY);
        };

        // Store reset function for external use
        this._resetIdleTimer = resetIdleTimer;

        // Reset timer on any interaction
        const events = ['mousemove', 'touchstart', 'touchmove', 'click', 'wheel'];
        events.forEach(event => {
          document.addEventListener(event, resetIdleTimer, { passive: true });
        });

        // Special handling for drawer and toggle hover/touch
        if (drawer) {
          drawer.addEventListener('mouseenter', () => {
            drawer.classList.remove('idle');
            toggle.classList.remove('idle');
            if (idleTimer) clearTimeout(idleTimer);
          });
          drawer.addEventListener('mouseleave', resetIdleTimer);
          drawer.addEventListener('touchstart', () => {
            drawer.classList.remove('idle');
            toggle.classList.remove('idle');
            if (idleTimer) clearTimeout(idleTimer);
          });
        }

        if (toggle) {
          toggle.addEventListener('mouseenter', () => {
            toggle.classList.remove('idle');
            if (drawer.classList.contains('open')) {
              drawer.classList.remove('idle');
            }
            if (idleTimer) clearTimeout(idleTimer);
          });
          toggle.addEventListener('mouseleave', resetIdleTimer);
        }

        // Start timer initially
        resetIdleTimer();
      }

      loadDrawerPosition() {
        const drawer = document.getElementById('zoomDrawer');
        if (!drawer) return;
        const saved = localStorage.getItem('zoomDrawerPosition');
        if (saved) {
          try {
            const pos = JSON.parse(saved);
            drawer.style.bottom = pos.bottom || '16px';
            drawer.style.right = pos.right || '64px';
            drawer.style.top = pos.top || 'auto';
            drawer.style.left = pos.left || 'auto';
          } catch (e) {
            console.warn('Failed to load drawer position:', e);
          }
        }
      }

      saveDrawerPosition() {
        const drawer = document.getElementById('zoomDrawer');
        if (!drawer) return;
        const rect = drawer.getBoundingClientRect();
          const pos = {
            bottom: drawer.style.bottom || '16px',
            right: drawer.style.right || '64px',
            top: drawer.style.top || 'auto',
            left: drawer.style.left || 'auto'
          };
        localStorage.setItem('zoomDrawerPosition', JSON.stringify(pos));
      }

      initDrawerDragging(drawer, handle) {
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let startBottom = 0;
        let startRight = 0;
        let startTop = 0;
        let startLeft = 0;

        const getComputedPosition = (el) => {
          const style = window.getComputedStyle(el);
          return {
            bottom: style.bottom === 'auto' ? null : parseFloat(style.bottom),
            right: style.right === 'auto' ? null : parseFloat(style.right),
            top: style.top === 'auto' ? null : parseFloat(style.top),
            left: style.left === 'auto' ? null : parseFloat(style.left)
          };
        };

        const getPointerXY = (e) => {
          if (e.clientX != null && e.clientY != null) return { x: e.clientX, y: e.clientY };
          const t = (e.touches && e.touches.length > 0) ? e.touches[0] : (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0] : null;
          return t ? { x: t.clientX, y: t.clientY } : null;
        };
        const startDrag = (e) => {
          const xy = getPointerXY(e);
          if (!xy) return;
          isDragging = true;
          drawer.classList.add('dragging');
          handle.classList.add('dragging');
          const pos = getComputedPosition(drawer);
          startX = xy.x;
          startY = xy.y;
          startBottom = pos.bottom;
          startRight = pos.right;
          startTop = pos.top;
          startLeft = pos.left;
          shellPreventDefaultIfCancelable(e);
        };

        const drag = (e) => {
          if (!isDragging) return;
          const xy = getPointerXY(e);
          if (!xy) return;
          const currentX = xy.x;
          const currentY = xy.y;
          const deltaX = currentX - startX;
          const deltaY = currentY - startY;

          const rect = drawer.getBoundingClientRect();
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;

          // Get handle elements to calculate their heights
          const handleTop = document.getElementById('zoomDrawerHandleTop');
          const handleBottom = document.getElementById('zoomDrawerHandleBottom');
          const handleTopHeight = handleTop ? handleTop.offsetHeight : 20;
          const handleBottomHeight = handleBottom ? handleBottom.offsetHeight : 20;
          const drawerContentHeight = rect.height - handleTopHeight - handleBottomHeight;

          // Determine anchor point based on current position
          const isRightAnchored = startRight !== null;
          const isBottomAnchored = startBottom !== null;
          const isTopHandle = handle === handleTop;

          if (isRightAnchored && isBottomAnchored) {
            // Bottom-right anchored - allow dragging until top handle touches top edge
            const newBottom = startBottom - deltaY;
            const newRight = startRight - deltaX;
            
            // Vertical: allow dragging until top handle touches top (bottom can go negative)
            const minBottom = -(rect.height - handleTopHeight); // Top handle at top edge
            const maxBottom = viewportHeight - handleBottomHeight; // Bottom handle at bottom edge
            
            // Horizontal: constrained - can't go past screen edges
            const minRight = 0; // Right edge at right side of screen (can't go past left edge)
            const maxRight = viewportWidth - rect.width; // Right edge at left side of screen (can't go past right edge)
            
            drawer.style.bottom = `${Math.max(minBottom, Math.min(maxBottom, newBottom))}px`;
            drawer.style.right = `${Math.max(minRight, Math.min(maxRight, newRight))}px`;
            drawer.style.top = 'auto';
            drawer.style.left = 'auto';
          } else if (startTop !== null && startLeft !== null) {
            // Top-left anchored - allow dragging until bottom handle touches bottom edge
            const newTop = startTop + deltaY;
            const newLeft = startLeft + deltaX;
            
            // Vertical: allow dragging until bottom handle touches bottom (top can go negative)
            const minTop = -(rect.height - handleBottomHeight); // Bottom handle at bottom edge
            const maxTop = viewportHeight - handleTopHeight; // Top handle at top edge
            
            // Horizontal: constrained - can't go past screen edges
            const minLeft = 0; // Left edge at left side of screen (can't go past left edge)
            const maxLeft = viewportWidth - rect.width; // Left edge at right side of screen (can't go past right edge)
            
            drawer.style.top = `${Math.max(minTop, Math.min(maxTop, newTop))}px`;
            drawer.style.left = `${Math.max(minLeft, Math.min(maxLeft, newLeft))}px`;
            drawer.style.bottom = 'auto';
            drawer.style.right = 'auto';
          }
          shellPreventDefaultIfCancelable(e);
        };

        const endDrag = () => {
          if (isDragging) {
            isDragging = false;
            drawer.classList.remove('dragging');
            handle.classList.remove('dragging');
            this.saveDrawerPosition();
          }
        };

        const passiveFalse = { passive: false };
        handle.addEventListener('mousedown', startDrag);
        handle.addEventListener('touchstart', startDrag, passiveFalse);
        document.addEventListener('mousemove', drag);
        document.addEventListener('touchmove', drag, passiveFalse);
        document.addEventListener('mouseup', endDrag);
        document.addEventListener('touchend', endDrag, passiveFalse);
      }

      initCategoryShortcutDragging(drawer, handleLeft, handleRight) {
        if (!drawer || !handleLeft || !handleRight) return;
        const DRAG_THRESHOLD = 5;
        const DOUBLE_CLICK_MS = 400;
        const LONG_PRESS_MS = 450;
        let isDragging = false;
        let hasMoved = false;
        let receivedPointerMove = false;
        let pointerHandle = null;
        let startX = 0, startY = 0, startLeft = 0, startTop = 0;
        let lastClickTime = 0;
        let lastClickHandle = null;
        let ignoreNextMouseSequence = false;
        let longPressTimer = null;
        let longPressFired = false;

        const getPointerXY = (e) => {
          if (e.clientX != null && e.clientY != null) return { x: e.clientX, y: e.clientY };
          const t = (e.touches && e.touches.length > 0) ? e.touches[0] : (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0] : null;
          return t ? { x: t.clientX, y: t.clientY } : null;
        };

        const startDrag = (e) => {
          if (e.type === 'mousedown' && ignoreNextMouseSequence) return;
          const xy = getPointerXY(e);
          if (!xy) return;
          longPressFired = false;
          receivedPointerMove = false;
          if (longPressTimer) clearTimeout(longPressTimer);
          longPressTimer = setTimeout(() => {
            longPressTimer = null;
            if (hasMoved || receivedPointerMove) return;
            longPressFired = true;
            if (typeof window.closeCategoryShortcutDrawer === 'function') window.closeCategoryShortcutDrawer();
          }, LONG_PRESS_MS);
          isDragging = true;
          hasMoved = false;
          pointerHandle = e.currentTarget;
          drawer.classList.add('dragging');
          if (pointerHandle) pointerHandle.classList.add('dragging');
          const rect = drawer.getBoundingClientRect();
          startLeft = rect.left;
          startTop = rect.top;
          startX = xy.x;
          startY = xy.y;
          shellPreventDefaultIfCancelable(e);
        };
        const drag = (e) => {
          if (!isDragging) return;
          receivedPointerMove = true;
          if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
          const xy = getPointerXY(e);
          if (!xy) return;
          const currentX = xy.x;
          const currentY = xy.y;
          const deltaX = currentX - startX;
          const deltaY = currentY - startY;
          if (!hasMoved && (Math.abs(deltaX) > DRAG_THRESHOLD || Math.abs(deltaY) > DRAG_THRESHOLD)) {
            hasMoved = true;
          }
          const rect = drawer.getBoundingClientRect();
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const handleW = 20;
          let newLeft = startLeft + deltaX;
          let newTop = startTop + deltaY;
          newLeft = Math.max(-(rect.width - handleW), Math.min(vw - handleW, newLeft));
          newTop = Math.max(-(rect.height - handleW), Math.min(vh - handleW, newTop));
          drawer.classList.add('dragged');
          drawer.style.transform = 'none';
          drawer.style.left = newLeft + 'px';
          drawer.style.top = newTop + 'px';
          drawer.style.right = 'auto';
          drawer.style.bottom = 'auto';
          startLeft = newLeft;
          startTop = newTop;
          startX = currentX;
          startY = currentY;
          shellPreventDefaultIfCancelable(e);
        };
        const endDrag = (e) => {
          if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
          if (e.type === 'touchcancel') {
            if (pointerHandle) {
              handleLeft.classList.remove('dragging');
              handleRight.classList.remove('dragging');
            }
            if (isDragging) {
              isDragging = false;
              pointerHandle = null;
              drawer.classList.remove('dragging');
            }
            return;
          }
          if (longPressFired) {
            longPressFired = false;
            if (pointerHandle) {
              handleLeft.classList.remove('dragging');
              handleRight.classList.remove('dragging');
            }
            if (isDragging) {
              isDragging = false;
              pointerHandle = null;
              drawer.classList.remove('dragging');
            }
            return;
          }
          if (e.type === 'touchend') ignoreNextMouseSequence = true;
          if (e.type === 'mouseup' && ignoreNextMouseSequence) {
            ignoreNextMouseSequence = false;
            if (pointerHandle) {
              handleLeft.classList.remove('dragging');
              handleRight.classList.remove('dragging');
            }
            if (isDragging) {
              isDragging = false;
              pointerHandle = null;
              drawer.classList.remove('dragging');
            }
            return;
          }
          if (pointerHandle) {
            handleLeft.classList.remove('dragging');
            handleRight.classList.remove('dragging');
          }
          if (isDragging) {
            const handleForClick = pointerHandle;
            isDragging = false;
            pointerHandle = null;
            drawer.classList.remove('dragging');
            if (!hasMoved && !receivedPointerMove && handleForClick && typeof window.CATEGORY_ORDER !== 'undefined') {
              const now = Date.now();
              if (now - lastClickTime < DOUBLE_CLICK_MS && lastClickHandle === handleForClick) {
                lastClickTime = 0;
                lastClickHandle = null;
                if (typeof window.closeCategoryShortcutDrawer === 'function') window.closeCategoryShortcutDrawer();
                return;
              }
              lastClickTime = now;
              lastClickHandle = handleForClick;
              const order = window.CATEGORY_ORDER;
              const n = order.length;
              const current = drawer.getAttribute('data-current-category') || order[0];
              let idx = order.indexOf(current);
              if (idx === -1) idx = 0;
              if (handleForClick === handleRight) {
                idx = (idx + 1) % n;
              } else if (handleForClick === handleLeft) {
                idx = (idx - 1 + n) % n;
              }
              if (typeof window.openCategoryShortcutDrawer === 'function') window.openCategoryShortcutDrawer(order[idx]);
            }
          }
        };
        const passiveFalse = { passive: false };
        [handleLeft, handleRight].forEach((handle) => {
          handle.addEventListener('mousedown', startDrag);
          handle.addEventListener('touchstart', startDrag, passiveFalse);
        });
        document.addEventListener('mousemove', drag);
        document.addEventListener('touchmove', drag, passiveFalse);
        document.addEventListener('mouseup', endDrag);
        document.addEventListener('touchend', endDrag, passiveFalse);
        document.addEventListener('touchcancel', endDrag, passiveFalse);

        this.initCategoryShortcutAutoFade();
      }

      initCategoryShortcutAutoFade() {
        const drawer = document.getElementById('categoryShortcutDrawer');
        if (!drawer) return;
        let idleTimer = null;
        const IDLE_DELAY = 3000;

        const resetIdleTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          drawer.classList.remove('idle');
          idleTimer = setTimeout(() => {
            if (drawer.classList.contains('open')) drawer.classList.add('idle');
          }, IDLE_DELAY);
        };

        const events = ['mousemove', 'touchstart', 'touchmove', 'click', 'wheel'];
        events.forEach(event => {
          document.addEventListener(event, resetIdleTimer, { passive: true });
        });
        drawer.addEventListener('mouseenter', () => {
          drawer.classList.remove('idle');
          if (idleTimer) clearTimeout(idleTimer);
        });
        drawer.addEventListener('mouseleave', resetIdleTimer);
        drawer.addEventListener('touchstart', () => {
          drawer.classList.remove('idle');
          if (idleTimer) clearTimeout(idleTimer);
        });
      }

      /** Invoice + menu iframes: Ctrl/Meta wheel & pinch live in the child document — forward to shell camera only, never browser-zoom those surfaces. */
      initSidebarFrameZoomBridge() {
        const sidebar = document.getElementById('sidebarIframe');
        if (!sidebar) return;
        const hook = () => this.attachSubdocumentZoomToShellCamera(sidebar);
        sidebar.addEventListener('load', hook);
        try {
          if (sidebar.contentDocument && sidebar.contentDocument.readyState === 'complete') {
            hook();
          }
        } catch (_) {}
      }

      initIframeResizing() {
        const iframe = document.getElementById('invoiceFrame');
        if (iframe) {
          // Listen for messages from the iframe
          window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'iframe-resize') {
              this.resizeIframeFromMessage(event.data);
            } else if (event.data && event.data.type === 'invoice-saved') {
              this.showSaveSuccessFeedback(event.data.documentType || 'invoice');
            } else if (event.data && event.data.type === 'render-start') {
              this.showRenderProgress(event.data.total, 'Rendering invoices', 'render');
            } else if (event.data && event.data.type === 'render-progress') {
              if (event.data.done) {
                this.hideRenderProgress();
              } else {
                this.updateRenderProgress(event.data.current, event.data.total);
              }
            } else if (event.data && event.data.type === 'print-start') {
              this.showRenderProgress(event.data.total, 'Printing invoices', 'print');
            } else if (event.data && event.data.type === 'print-progress') {
              if (event.data.done) {
                this.hideRenderProgress();
              } else {
                this.updateRenderProgress(event.data.current, event.data.total);
              }
            } else if (event.data && event.data.type === 'parent-capture-export') {
              this.handleParentCaptureExport(event);
            }
          });
          
          const onInvoiceFrameLoad = () => {
            this._iframeSizeReceived = false;
            try {
              iframe.contentWindow.postMessage({ type: 'switch-mode', mode: this.currentMode || 'edit' }, '*');
            } catch (_) {}
            this.requestIframeSize();
            this.attachSubdocumentZoomToShellCamera(iframe);
            this.injectOverlayLayer();
            setTimeout(() => {
              if (!this._iframeSizeReceived) {
                this.resizeIframeToContent();
              }
              this.injectOverlayLayer();
            }, 500);
          };

          iframe.addEventListener('load', onInvoiceFrameLoad);
          try {
            if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
              onInvoiceFrameLoad();
            }
          } catch (_) {}
          
          // Also resize on window resize
          window.addEventListener('resize', () => {
            this.requestIframeSize();
          });
        }
      }

      requestIframeSize() {
        const iframe = document.getElementById('invoiceFrame');
        if (iframe && iframe.contentWindow) {
          try {
            // Request size information from iframe
            iframe.contentWindow.postMessage({ type: 'request-size' }, '*');
          } catch (error) {
            console.log('⚠️ Could not request iframe size');
            this.resizeIframeToContent();
          }
        }
      }

      showRenderProgress(total, title = 'Rendering invoices', operation = 'render') {
        const overlay = document.getElementById('renderProgressOverlay');
        const bar = document.getElementById('renderProgressBar');
        const text = document.getElementById('renderProgressText');
        const titleEl = overlay?.querySelector('h3');
        const cancelBtn = document.getElementById('renderProgressCancelBtn');
        this._progressOperation = operation;
        if (overlay && bar && text) {
          if (titleEl) titleEl.textContent = title;
          bar.style.width = '0%';
          text.textContent = `0 / ${total}`;
          overlay.classList.add('visible');
        }
        if (cancelBtn) {
          cancelBtn.onclick = () => this.cancelProgress();
        }
      }

      updateRenderProgress(current, total) {
        const bar = document.getElementById('renderProgressBar');
        const text = document.getElementById('renderProgressText');
        if (bar && text && total > 0) {
          const pct = Math.round((current / total) * 100);
          bar.style.width = pct + '%';
          text.textContent = `${current} / ${total}`;
        }
      }

      hideRenderProgress() {
        const overlay = document.getElementById('renderProgressOverlay');
        if (overlay) overlay.classList.remove('visible');
        this._progressOperation = null;
      }

      cancelProgress() {
        const iframe = document.getElementById('invoiceFrame');
        if (iframe && iframe.contentWindow && this._progressOperation) {
          const type = this._progressOperation === 'print' ? 'cancel-print' : 'cancel-render';
          iframe.contentWindow.postMessage({ type }, '*');
        }
        this.hideRenderProgress();
      }

      handleParentCaptureExport(event) {
        const iframe = document.getElementById('invoiceFrame');
        const { requestId, a4Width, exportHeight } = event.data || {};
        const target = event.source;
        if (!iframe || !iframe.contentDocument || target !== iframe.contentWindow || !requestId) return;
        const sendResult = (data) => { try { target.postMessage(data, '*'); } catch (e) { console.warn('parent-capture postMessage failed', e); } };
        if (typeof html2canvas === 'undefined') {
          sendResult({ type: 'parent-capture-result', requestId, error: 'Export library not loaded' });
          return;
        }
        const doc = iframe.contentDocument;
        const el = doc.getElementById('invoice') || doc.getElementById('receipt');
        if (!el) {
          sendResult({ type: 'parent-capture-result', requestId, error: 'No invoice/receipt element found' });
          return;
        }
        const invoiceNoEl = doc.getElementById('invoiceNo') || doc.getElementById('receiptNo') || doc.getElementById('statementNo');
        const prefix = doc.getElementById('receipt') ? 'receipt' : doc.getElementById('statementNo') ? 'statement' : (doc.getElementById('docContent') ? 'document' : 'invoice');
        const filename = (invoiceNoEl && invoiceNoEl.textContent) ? `${prefix}-${invoiceNoEl.textContent}.png` : `${prefix}.png`;
        const w = Number(a4Width) || 794;
        const h = Number(exportHeight) || 1123;
        doc.body.classList.add('capture-exporting');
        html2canvas(el, {
          scale: 1.5,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          width: w,
          height: h,
          scrollX: 0,
          scrollY: 0,
          windowWidth: w,
          windowHeight: h,
          logging: false,
          foreignObjectRendering: false,
          imageTimeout: 0
        }).then(canvas => {
          doc.body.classList.remove('capture-exporting');
          sendResult({ type: 'parent-capture-result', requestId, dataUrl: canvas.toDataURL('image/png'), filename });
        }).catch(err => {
          doc.body.classList.remove('capture-exporting');
          sendResult({ type: 'parent-capture-result', requestId, error: (err && err.message) || String(err) });
        });
      }

      /**
       * Resolve a site-root-relative path (e.g. js/foo.js) against the shell URL.
       * Iframe-relative paths like ../js/ break when the child document is still about:blank.
       */
      shellAssetUrl(pathFromWebRoot) {
        try {
          return new URL(String(pathFromWebRoot || '').replace(/^\//, ''), window.location.href).href;
        } catch (_) {
          return pathFromWebRoot;
        }
      }

      injectOverlayLayer() {
        const iframe = document.getElementById('invoiceFrame');
        if (!iframe || !iframe.contentDocument) return;
        try {
          const doc = iframe.contentDocument;
          let href = '';
          try {
            href = doc.URL || '';
          } catch (_) {
            return;
          }
          if (!href || href === 'about:blank' || href.startsWith('about:')) return;
          if (!doc.body) return;

          if (doc.getElementById('overlay-container')) {
            return;
          }
          const script = doc.createElement('script');
          script.src = this.shellAssetUrl('js/overlay-layer.js');
          script.onload = function () {
            if (window._drawModeActive) {
              iframe.contentWindow.postMessage({ type: 'draw-mode', enabled: true }, '*');
            }
          };
          doc.body.appendChild(script);
          const pageOverlayScript = doc.createElement('script');
          pageOverlayScript.src = this.shellAssetUrl('js/page-overlay-elements.js');
          doc.body.appendChild(pageOverlayScript);
        } catch (e) {
          console.warn('Overlay layer injection failed:', e);
        }
      }

      resizeIframeFromMessage(data) {
        const iframe = document.getElementById('invoiceFrame');
        if (iframe && data.width != null && data.height != null) {
          this._iframeSizeReceived = true;
          const w = Math.min(Math.max(Number(data.width), 400), 1200);
          const h = Math.min(Math.max(Number(data.height), 500), 5000);
          const curW = parseInt(iframe.style.width, 10) || 0;
          const curH = parseInt(iframe.style.height, 10) || 0;
          if (curW === w && curH === h) return;
          iframe.style.width = w + 'px';
          iframe.style.height = h + 'px';
          
          console.log(`📏 Iframe resized from message to: ${iframe.style.width} x ${iframe.style.height}`);
          
          // On mobile, only adjust zoom if needed; skip while user is panning/pinching (avoids jump + flicker)
          if (this.isMobileDevice() && !this._workspaceGestureActive) {
            setTimeout(() => {
              if (this._workspaceGestureActive) return;
              const mobileZoom = this.calculateInitialMobileZoom();
              if (mobileZoom && mobileZoom < 1) {
                this.camera.zoom = mobileZoom;
              }
              this.updateCanvasTransform();
            }, 100);
          }
        }
      }

      resizeIframeToContent() {
        const iframe = document.getElementById('invoiceFrame');
        if (iframe && iframe.contentDocument) {
          try {
            const iframeDoc = iframe.contentDocument;
            const iframeBody = iframeDoc.body;
            
            if (iframeBody) {
              // Use page element (#invoice or #receipt) for exact fit; fallback to body/documentElement
              const page = iframeDoc.getElementById('invoice') || iframeDoc.getElementById('receipt');
              let contentWidth, contentHeight;
              if (page) {
                contentWidth = Math.max(page.scrollWidth, page.offsetWidth);
                contentHeight = Math.max(page.scrollHeight, page.offsetHeight);
              } else {
                contentWidth = Math.max(
                  iframeBody.scrollWidth,
                  iframeBody.offsetWidth,
                  iframeDoc.documentElement.scrollWidth,
                  iframeDoc.documentElement.offsetWidth
                );
                contentHeight = Math.max(
                  iframeBody.scrollHeight,
                  iframeBody.offsetHeight,
                  iframeDoc.documentElement.scrollHeight,
                  iframeDoc.documentElement.offsetHeight
                );
              }
              
              const w = Math.max(contentWidth, 800);
              const h = Math.max(contentHeight, 1000);
              iframe.style.width = w + 'px';
              iframe.style.height = h + 'px';
              
              console.log(`📏 Iframe resized to: ${iframe.style.width} x ${iframe.style.height}`);
              
              // On mobile, only adjust zoom if needed; skip during active touch gestures
              if (this.isMobileDevice() && !this._workspaceGestureActive) {
                setTimeout(() => {
                  if (this._workspaceGestureActive) return;
                  const mobileZoom = this.calculateInitialMobileZoom();
                  if (mobileZoom && mobileZoom < 1) {
                    this.camera.zoom = mobileZoom;
                  }
                  this.updateCanvasTransform();
                }, 100);
              }
            }
          } catch (error) {
            console.log('⚠️ Could not resize iframe (cross-origin restriction)');
            // Fallback to default size
            iframe.style.width = '800px';
            iframe.style.height = '1000px';
            
            // Don't auto-center during resize - let user control positioning
          }
        } else {
          // If contentDocument is not available, use fallback size
          iframe.style.width = '800px';
          iframe.style.height = '1000px';
          
          // Don't auto-center during resize - let user control positioning
        }
      }

      isMobileDevice() {
        return window.innerWidth <= 768;
      }

      calculateInitialMobileZoom() {
        const iframe = document.getElementById('invoiceFrame');
        if (!iframe || !this.isMobileDevice()) {
          return null;
        }

        // Get viewport dimensions
        const viewportWidth = this.camera.width || window.innerWidth;
        const viewportHeight = this.camera.height || window.innerHeight;
        
        // Get iframe dimensions
        const iframeWidth = iframe.offsetWidth || 600;
        const iframeHeight = iframe.offsetHeight || 750;
        
        // Calculate zoom needed to fit iframe in viewport with some margin (10px padding)
        const margin = 20;
        const zoomX = (viewportWidth - margin) / iframeWidth;
        const zoomY = (viewportHeight - margin) / iframeHeight;
        
        // Use the smaller zoom to ensure both width and height fit
        const initialZoom = Math.min(zoomX, zoomY, 1); // Don't zoom in beyond 1x
        
        return Math.max(0.3, initialZoom); // Minimum zoom of 0.3x
      }

      centerIframeInViewport() {
        this.stopShellPanMomentum();
        const canvas = document.getElementById('infiniteCanvas');
        const iframe = document.getElementById('invoiceFrame');
        
        if (canvas && iframe) {
          // On mobile, calculate and apply initial zoom if needed
          if (this.isMobileDevice() && this.camera.zoom === 1) {
            const mobileZoom = this.calculateInitialMobileZoom();
            if (mobileZoom && mobileZoom < 1) {
              this.camera.zoom = mobileZoom;
              console.log(`📱 Mobile initial zoom set to: ${mobileZoom.toFixed(2)}x`);
            }
          }

          // Get iframe dimensions
          const iframeWidth = iframe.offsetWidth;
          const iframeHeight = iframe.offsetHeight;
          
          // Calculate world position to center iframe in viewport
          // Account for zoom when centering
          const scaledWidth = iframeWidth * this.camera.zoom;
          const scaledHeight = iframeHeight * this.camera.zoom;
          const centerX = (this.camera.width - scaledWidth) / 2;
          const centerY = (this.camera.height - scaledHeight) / 2;
          
          // Set camera position to center the iframe
          this.camera.x = centerX;
          this.camera.y = centerY;
          
          // Apply the transform
          this.updateCanvasTransform();
          
          console.log(`🎯 Camera centered on iframe: ${centerX}, ${centerY} (zoom: ${this.camera.zoom.toFixed(2)}x)`);
        }
      }

      /**
       * Canvas pan: primary or middle button drag on the dotted workspace (events may move over the iframe,
       * so pan uses window-level move/up). Trackpad-style wheel gestures and pinch zoom match Peruse.
       * @see Electron/peruse_Class.js InputManager, Electron/PeruseControl.html zoom prevention
       */
      addCanvasNavigation(canvas) {
        const passiveFalse = { passive: false };
        let isPanning = false;
        let startX = 0;
        let startY = 0;
        let startCameraX = 0;
        let startCameraY = 0;

        const touchState = {
          active: false,
          touches: new Map(),
          lastPinchDistance: 0,
          startCameraX: 0,
          startCameraY: 0,
          oneFingerStart: { x: 0, y: 0 }
        };

        const endMousePan = () => {
          if (!isPanning) return;
          isPanning = false;
          window.removeEventListener('mousemove', onWindowMouseMove);
          window.removeEventListener('mouseup', onWindowMouseUp);
          canvas.style.cursor = 'grab';
          this.drawCanvas();
        };

        const onWindowMouseMove = (e) => {
          if (!isPanning) return;
          e.preventDefault();
          const deltaX = e.clientX - startX;
          const deltaY = e.clientY - startY;
          this.camera.x = startCameraX + deltaX;
          this.camera.y = startCameraY + deltaY;
          this.updateCanvasTransform();
        };

        const onWindowMouseUp = () => {
          endMousePan();
        };

        canvas.addEventListener('mousedown', (e) => {
          if (e.button !== 0 && e.button !== 1) return;
          e.preventDefault();
          this.stopShellPanMomentum();
          isPanning = true;
          startX = e.clientX;
          startY = e.clientY;
          startCameraX = this.camera.x;
          startCameraY = this.camera.y;
          canvas.style.cursor = 'grabbing';
          window.addEventListener('mousemove', onWindowMouseMove, passiveFalse);
          window.addEventListener('mouseup', onWindowMouseUp);
        });

        canvas.addEventListener('mouseleave', () => {
          if (!isPanning) canvas.style.cursor = 'grab';
        });

        canvas.addEventListener('auxclick', (e) => {
          if (e.button === 1) e.preventDefault();
        });

        canvas.addEventListener('touchstart', (e) => {
          shellPreventDefaultIfCancelable(e);
          this.setWorkspaceGestureActive(true);
          touchState.active = true;
          if (e.touches.length === 2) {
            this.stopShellPanMomentum();
            this._touchPanInertPrev = null;
          }
          for (const touch of e.changedTouches) {
            touchState.touches.set(touch.identifier, {
              x: touch.clientX,
              y: touch.clientY,
              startX: touch.clientX,
              startY: touch.clientY
            });
          }
          if (e.touches.length === 1) {
            if (!window._drawModeActive) {
              const t = e.touches[0];
              touchState.startCameraX = this.camera.x;
              touchState.startCameraY = this.camera.y;
              touchState.oneFingerStart = { x: t.clientX, y: t.clientY };
              canvas.classList.add('panning');
              this.resetTouchPanInertiaTracking(t.clientX, t.clientY);
            }
          } else if (e.touches.length === 2) {
            this.setWorkspacePinchActive(true);
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            touchState.lastPinchDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          }
        }, passiveFalse);

        canvas.addEventListener('touchmove', (e) => {
          shellPreventDefaultIfCancelable(e);
          if (!touchState.active) return;

          for (const touch of e.changedTouches) {
            const d = touchState.touches.get(touch.identifier);
            if (d) {
              d.x = touch.clientX;
              d.y = touch.clientY;
            }
          }

          if (e.touches.length === 1) {
            if (!window._drawModeActive) {
              const t = e.touches[0];
              const d = touchState.touches.get(t.identifier);
              if (d) {
                const deltaX = t.clientX - touchState.oneFingerStart.x;
                const deltaY = t.clientY - touchState.oneFingerStart.y;
                // Match iframe path: scale pan by zoom on all touch devices (touchscreen laptops are not "mobile").
                const div = this.mobilePanPixelDivisor();
                this.camera.x = touchState.startCameraX + deltaX / div;
                this.camera.y = touchState.startCameraY + deltaY / div;
                this.touchPanInertiaSampleFromMove(t.clientX, t.clientY, div);
                this.updateCanvasTransform();
                if (this.isShellCameraDebug()) {
                  this.logShellCameraThrottled('pan-canvas', 200, '1-finger pan (canvas)', {
                    div,
                    delta: { x: deltaX, y: deltaY },
                    camera: { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom },
                    workspaceGesture: this._workspaceGestureActive,
                    shellPinch: this._shellPinchActive
                  });
                }
              }
            }
          } else if (e.touches.length === 2) {
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            if (touchState.lastPinchDistance > 0) {
              const scale = distance / touchState.lastPinchDistance;
              const centerX = (t1.clientX + t2.clientX) / 2;
              const centerY = (t1.clientY + t2.clientY) / 2;
              this.applyPinchGestureStep(scale, centerX, centerY);
            }
            touchState.lastPinchDistance = distance;
          }
        }, passiveFalse);

        canvas.addEventListener('touchend', (e) => {
          shellPreventDefaultIfCancelable(e);
          const wasOneFingerPan = e.touches.length === 0 && canvas.classList.contains('panning');
          for (const touch of e.changedTouches) {
            touchState.touches.delete(touch.identifier);
          }
          if (e.touches.length === 0) {
            touchState.active = false;
            touchState.lastPinchDistance = 0;
            canvas.classList.remove('panning');
            this.setWorkspacePinchActive(false);
            this.setWorkspaceGestureActive(false);
            if (wasOneFingerPan) {
              this.kickTouchPanInertiaIfFastEnough();
            }
            this._touchPanInertPrev = null;
          }
          if (e.touches.length === 1) {
            const t = e.touches[0];
            touchState.startCameraX = this.camera.x;
            touchState.startCameraY = this.camera.y;
            touchState.oneFingerStart = { x: t.clientX, y: t.clientY };
            touchState.lastPinchDistance = 0;
            this.setWorkspacePinchActive(false);
            this.resetTouchPanInertiaTracking(t.clientX, t.clientY);
          }
        }, passiveFalse);

        canvas.addEventListener('touchcancel', (e) => {
          shellPreventDefaultIfCancelable(e);
          touchState.active = false;
          touchState.touches.clear();
          touchState.lastPinchDistance = 0;
          canvas.classList.remove('panning');
          this.setWorkspacePinchActive(false);
          this.setWorkspaceGestureActive(false);
          this.abortTouchPanInertiaSampling();
        }, passiveFalse);

        canvas.addEventListener('wheel', (e) => {
          if (e.ctrlKey || e.metaKey) {
            this.applyTrackpadCanvasGesture(e);
            return;
          }
          const isTrackpad =
            Math.abs(e.deltaY) < 200 &&
            Math.abs(e.deltaX) < 200 &&
            (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) > 0);
          if (isTrackpad) {
            this.applyTrackpadCanvasGesture(e);
          }
        });
      }

      applyTrackpadCanvasGesture(e) {
        const deltaX = e.deltaX;
        const deltaY = e.deltaY;
        if (e.type !== 'wheel') return;

        const hasCtrl = e.ctrlKey || e.metaKey;
        const hasAlt = e.altKey;
        const hasShift = e.shiftKey;

        if (hasCtrl) {
          e.preventDefault();
          this.stopShellPanMomentum();
          const zoomFactor = deltaY > 0 ? 0.9 : 1.1;
          this.camera.zoom = Math.max(0.1, Math.min(5, this.camera.zoom * zoomFactor));
          this.updateCanvasTransform();
          return;
        }
        if (hasAlt) {
          e.preventDefault();
          this.stopShellPanMomentum();
          this.camera.x += -deltaX * 0.1;
          this.camera.y += -deltaY * 0.1;
          this.updateCanvasTransform();
          return;
        }
        if (hasShift) {
          e.preventDefault();
          this.stopShellPanMomentum();
          this.camera.x += -deltaX * 0.05;
          this.camera.y += -deltaY * 0.05;
          this.updateCanvasTransform();
          return;
        }

        const deltaMagnitude = Math.hypot(deltaX, deltaY);
        const isDiagonalSwipe =
          deltaMagnitude > 2 &&
          Math.abs(deltaX) > 1 &&
          Math.abs(deltaY) > 1 &&
          Math.abs(Math.abs(deltaX) - Math.abs(deltaY)) < 30;
        const isCardinalSwipe =
          deltaMagnitude > 5 &&
          (Math.abs(deltaX) > Math.abs(deltaY) * 2 || Math.abs(deltaY) > Math.abs(deltaX) * 2);

        if (isDiagonalSwipe) {
          e.preventDefault();
          this.stopShellPanMomentum();
          const zoomFactor = deltaY > 0 ? 0.95 : 1.05;
          this.camera.zoom = Math.max(0.1, Math.min(5, this.camera.zoom * zoomFactor));
          this.updateCanvasTransform();
          return;
        }
        if (isCardinalSwipe) {
          e.preventDefault();
          const zoomFactor = this.camera.zoom || 1;
          const basePanAmount = 20;
          const step = basePanAmount / zoomFactor;
          let panX = 0;
          let panY = 0;
          if (Math.abs(deltaX) > Math.abs(deltaY)) {
            panX = deltaX > 0 ? -step : step;
          } else {
            panY = deltaY > 0 ? -step : step;
          }
          this.camera.x += panX;
          this.camera.y += panY;
          this.impulseShellPanMomentumTrackpad(panX, panY);
          this.updateCanvasTransform();
        }
      }

      /**
       * Shell UI and subframes (invoice, sidebar): one camera zoom. Block browser page zoom only for
       * Ctrl/Meta+wheel & pinch; plain wheel still scrolls menus. Keyboard shortcuts use the same paths.
       */
      applyShellKeyboardNavFromEvent(e, rootDoc) {
        const ae = rootDoc.activeElement;
        const inField =
          ae &&
          (ae.tagName === 'INPUT' ||
            ae.tagName === 'TEXTAREA' ||
            ae.tagName === 'SELECT' ||
            ae.isContentEditable);

        if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '0' || e.key === '=')) {
          if (!inField) e.preventDefault();
        }

        if (inField) return;

        if (e.ctrlKey || e.metaKey) {
          if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            this.zoomIn();
            return;
          }
          if (e.key === '-') {
            e.preventDefault();
            this.zoomOut();
            return;
          }
          if (e.key === '0') {
            e.preventDefault();
            this.resetZoom();
            this.centerIframeInViewport();
            return;
          }
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            this.nudgeCanvasWithArrowKey(e.key);
          }
        }

        if (e.key === 'Home') {
          e.preventDefault();
          this.centerIframeInViewport();
        }
      }

      /**
       * Same-origin iframe: wheel/keyboard to shell; two-finger pinch; one-finger drag on non-interactive
       * areas pans the shell camera (whitespace / margins — not table cells or inputs).
       */
      attachSubdocumentZoomToShellCamera(iframe) {
        if (!iframe || !iframe.contentWindow) return;
        try {
          const doc = iframe.contentWindow.document;
          if (!doc || !doc.documentElement) return;
          if (!this._subdocZoomHooked) this._subdocZoomHooked = new WeakSet();
          if (this._subdocZoomHooked.has(doc)) return;
          this._subdocZoomHooked.add(doc);

          const allowIframeShellPanTarget = (el) => {
            if (!el || typeof el.closest !== 'function') return false;
            if (el.closest('input, textarea, select, button, a[href], label')) return false;
            if (el.closest('[contenteditable]:not([contenteditable="false"])')) return false;
            if (el.closest('.items-table tbody')) return false;
            if (el.closest('.overlay-image, .page-overlay-wrapper')) return false;
            if (el.closest('#draw-layer')) {
              try {
                if (iframe.contentWindow.parent && iframe.contentWindow.parent._drawModeActive) {
                  return false;
                }
              } catch (_) {}
            }
            return true;
          };

          /** Padded: toolbar / rotate handles sit just outside the box. */
          const bothTouchPointsInElementBounds = (root, e, padPx) => {
            if (!root || !e.touches || e.touches.length !== 2) return false;
            const br = root.getBoundingClientRect();
            const p = padPx || 0;
            const left = br.left - p;
            const right = br.right + p;
            const top = br.top - p;
            const bottom = br.bottom + p;
            const inside = (t) => {
              const x = t.clientX;
              const y = t.clientY;
              return x >= left && x <= right && y >= top && y <= bottom;
            };
            return inside(e.touches[0]) && inside(e.touches[1]);
          };

          const shouldDeferPinchToSelectedGraphic = (e) => {
            if (!e.touches || e.touches.length !== 2) return false;
            const img = doc.querySelector('.overlay-image.selected:not(.locked)');
            const page = doc.querySelector('.page-overlay-wrapper.selected:not(.locked)');
            const root = img || page;
            if (!root) return false;
            return bothTouchPointsInElementBounds(root, e, 56);
          };

          const cap = { capture: true, passive: false };
          const isTrackpadLikeWheel = (e) =>
            Math.abs(e.deltaY) < 200 &&
            Math.abs(e.deltaX) < 200 &&
            (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) > 0);
          const onWheel = (e) => {
            const hasShellMod = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
            if (hasShellMod) {
              this.applyTrackpadCanvasGesture(e);
              return;
            }
            if (!isTrackpadLikeWheel(e)) return;
            if (!allowIframeShellPanTarget(e.target)) return;
            this.applyTrackpadCanvasGesture(e);
          };
          const pinch = { lastSpan: 0, deferredToGraphic: false };
          const pan = { active: false, startX: 0, startY: 0, camX: 0, camY: 0 };
          const parentShell = () =>
            iframe.contentWindow.parent &&
            (iframe.contentWindow.parent.canvasShell || iframe.contentWindow.parent.app);
          const clearPinch = (e) => {
            if (!e.touches || e.touches.length < 2) {
              pinch.lastSpan = 0;
              pinch.deferredToGraphic = false;
              const shell = parentShell();
              if (shell && typeof shell.setWorkspacePinchActive === 'function') {
                shell.setWorkspacePinchActive(false);
              }
            }
          };
          doc.addEventListener(
            'touchstart',
            (e) => {
              const shellGesture = parentShell();
              if (shellGesture && typeof shellGesture.setWorkspaceGestureActive === 'function') {
                shellGesture.setWorkspaceGestureActive(true);
              }
              if (e.touches.length === 2) {
                pan.active = false;
                const shell2 = parentShell();
                if (shell2 && typeof shell2.abortTouchPanInertiaSampling === 'function') {
                  shell2.abortTouchPanInertiaSampling();
                }
                if (shouldDeferPinchToSelectedGraphic(e)) {
                  pinch.deferredToGraphic = true;
                  pinch.lastSpan = 0;
                  return;
                }
                pinch.deferredToGraphic = false;
                shellPreventDefaultIfCancelable(e);
                const shell = parentShell();
                if (shell && typeof shell.setWorkspacePinchActive === 'function') {
                  shell.setWorkspacePinchActive(true);
                }
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                pinch.lastSpan = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
              } else if (e.touches.length === 1) {
                pinch.lastSpan = 0;
                const t = e.target;
                if (allowIframeShellPanTarget(t)) {
                  pan.active = true;
                  pan.startX = e.touches[0].clientX;
                  pan.startY = e.touches[0].clientY;
                  const shell = parentShell();
                  if (shell && shell.camera) {
                    pan.camX = shell.camera.x;
                    pan.camY = shell.camera.y;
                    if (typeof shell.resetTouchPanInertiaTracking === 'function') {
                      shell.resetTouchPanInertiaTracking(pan.startX, pan.startY);
                    }
                  } else {
                    pan.active = false;
                  }
                } else {
                  pan.active = false;
                }
              }
            },
            cap
          );
          doc.addEventListener(
            'touchmove',
            (e) => {
              if (e.touches.length === 2) {
                if (pinch.deferredToGraphic) return;
                shellPreventDefaultIfCancelable(e);
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                const span = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                const shell = parentShell();
                if (pinch.lastSpan > 0 && shell && typeof shell.applyPinchGestureStep === 'function') {
                  const scale = span / pinch.lastSpan;
                  const cx = (t1.clientX + t2.clientX) / 2;
                  const cy = (t1.clientY + t2.clientY) / 2;
                  const rect = iframe.getBoundingClientRect();
                  shell.applyPinchGestureStep(scale, rect.left + cx, rect.top + cy);
                }
                pinch.lastSpan = span;
                return;
              }
              if (e.touches.length === 1 && pan.active) {
                shellPreventDefaultIfCancelable(e);
                const shell = parentShell();
                const t = e.touches[0];
                if (shell && shell.camera) {
                  const panDiv =
                    typeof shell.mobilePanPixelDivisor === 'function'
                      ? shell.mobilePanPixelDivisor()
                      : Math.max(1, shell.camera.zoom || 1);
                  shell.camera.x = pan.camX + (t.clientX - pan.startX) / panDiv;
                  shell.camera.y = pan.camY + (t.clientY - pan.startY) / panDiv;
                  if (typeof shell.touchPanInertiaSampleFromMove === 'function') {
                    shell.touchPanInertiaSampleFromMove(t.clientX, t.clientY, panDiv);
                  }
                  shell.updateCanvasTransform();
                  if (shell.isShellCameraDebug && shell.isShellCameraDebug()) {
                    shell.logShellCameraThrottled('pan-iframe', 200, '1-finger pan (iframe)', {
                      panDiv,
                      delta: { x: t.clientX - pan.startX, y: t.clientY - pan.startY },
                      camera: {
                        x: shell.camera.x,
                        y: shell.camera.y,
                        zoom: shell.camera.zoom
                      }
                    });
                  }
                }
              }
            },
            cap
          );
          const onTouchEndOrCancel = (e) => {
            const hadShellPan = pan.active;
            clearPinch(e);
            if (!e.touches || e.touches.length === 0) {
              pan.active = false;
              const sh = parentShell();
              if (sh && typeof sh.setWorkspaceGestureActive === 'function') {
                sh.setWorkspaceGestureActive(false);
              }
              if (hadShellPan && sh && typeof sh.kickTouchPanInertiaIfFastEnough === 'function') {
                sh.kickTouchPanInertiaIfFastEnough();
              }
            }
          };
          doc.addEventListener('touchend', onTouchEndOrCancel, cap);
          doc.addEventListener('touchcancel', (e) => {
            clearPinch(e);
            pan.active = false;
            const sh = parentShell();
            if (sh && typeof sh.setWorkspaceGestureActive === 'function') {
              sh.setWorkspaceGestureActive(false);
            }
            if (sh && typeof sh.abortTouchPanInertiaSampling === 'function') {
              sh.abortTouchPanInertiaSampling();
            }
          }, cap);
          doc.addEventListener('wheel', onWheel, cap);
          doc.addEventListener('keydown', (e) => this.applyShellKeyboardNavFromEvent(e, doc), cap);
          ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
            doc.addEventListener(type, (e) => shellPreventDefaultIfCancelable(e), cap);
          });
        } catch (_) {
          /* cross-origin */
        }
      }

      initShellZoomPrevention() {
        const passiveFalse = { passive: false };

        /** Browser zoom only; same deltas as canvas — plain wheel still scrolls. */
        const onShellChromeWheel = (e) => {
          if (!(e.ctrlKey || e.metaKey)) return;
          e.preventDefault();
          e.stopPropagation();
          this.applyTrackpadCanvasGesture(e);
        };

        const shellSelectors = [
          '.zoom-drawer',
          '.zoom-hamburger',
          '.zoom-overlay',
          '.zoom-btn',
          '.mobile-overlay',
          '.mobile-drawer',
          '.category-shortcut-drawer',
          '.category-shortcut-handle',
          '.category-shortcut-btn',
          '.modal-overlay',
          '.menu-hamburger',
          '.render-progress-overlay'
        ];

        const bindShell = (root) => {
          shellSelectors.forEach((sel) => {
            root.querySelectorAll(sel).forEach((el) => {
              el.addEventListener('wheel', onShellChromeWheel, passiveFalse);
              el.addEventListener(
                'touchstart',
                (ev) => {
                  if (ev.touches.length > 1) shellPreventDefaultIfCancelable(ev);
                },
                passiveFalse
              );
              el.addEventListener(
                'touchmove',
                (ev) => {
                  if (ev.touches.length > 1) shellPreventDefaultIfCancelable(ev);
                },
                passiveFalse
              );
              ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
                el.addEventListener(type, (ev) => shellPreventDefaultIfCancelable(ev), passiveFalse);
              });
            });
          });
        };

        bindShell(document);

        document.addEventListener(
          'wheel',
          (e) => {
            if (e.ctrlKey || e.metaKey) e.preventDefault();
          },
          passiveFalse
        );

        /* Block OS/browser tab pinch-zoom (not on infinite canvas — canvas already preventDefault + touch-action: none; avoids double-suppression flicker). */
        const blockTabMultiTouchZoom = (e) => {
          if (!(e.touches && e.touches.length > 1)) return;
          const el = e.target;
          if (el && el.closest && el.closest('#infiniteCanvas')) return;
          shellPreventDefaultIfCancelable(e);
        };
        document.addEventListener('touchstart', blockTabMultiTouchZoom, { ...passiveFalse, capture: true });
        document.addEventListener('touchmove', blockTabMultiTouchZoom, { ...passiveFalse, capture: true });

        /* Safari: block page pinch-zoom; workspace zoom uses shell camera / canvas handlers only */
        ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
          document.addEventListener(type, (e) => shellPreventDefaultIfCancelable(e), passiveFalse);
        });

        document.addEventListener('keydown', (e) => {
          this.applyShellKeyboardNavFromEvent(e, document);
        });

        if (!document.getElementById('shell-zoom-prevention-style')) {
          const style = document.createElement('style');
          style.id = 'shell-zoom-prevention-style';
          style.textContent = `
            html {
              touch-action: pan-x pan-y;
            }
            body {
              touch-action: pan-x pan-y;
            }
            .zoom-drawer, .zoom-hamburger, .zoom-overlay, .zoom-btn,
            .mobile-overlay, .mobile-drawer, .category-shortcut-drawer, .category-shortcut-handle, .category-shortcut-btn,
            .modal-overlay, .menu-hamburger, .render-progress-overlay {
              touch-action: pan-x pan-y !important;
              -webkit-touch-callout: none !important;
              -webkit-user-select: none !important;
              user-select: none !important;
            }
          `;
          document.head.appendChild(style);
        }
      }

      nudgeCanvasWithArrowKey(key) {
        this.stopShellPanMomentum();
        const zoomFactor = this.camera.zoom || 1;
        const step = 50 / zoomFactor;
        switch (key) {
          case 'ArrowUp':
            this.camera.y += step;
            break;
          case 'ArrowDown':
            this.camera.y -= step;
            break;
          case 'ArrowLeft':
            this.camera.x += step;
            break;
          case 'ArrowRight':
            this.camera.x -= step;
            break;
          default:
            return;
        }
        this.updateCanvasTransform();
      }

      /**
       * During workspace pinch, strip transitions on the iframe — avoids template `transition: all` flashing under scale.
       */
      setWorkspacePinchActive(active) {
        const on = !!active;
        this._shellPinchActive = on;
        this._pinchFocalSmooth = null;
        this._pinchScaleEma = null;
        const overlay = document.getElementById('canvasOverlay');
        if (overlay) overlay.classList.toggle('shell-pinch-active', on);
        if (this.isShellCameraDebug()) {
          if (on && !this._shellPinchLoggedThisGesture) {
            this._shellPinchLoggedThisGesture = true;
            console.log(
              '[shell-camera] pinch started (two fingers) — expect pinch step lines below'
            );
          }
          if (!on) this._shellPinchLoggedThisGesture = false;
        }
      }

      setWorkspaceGestureActive(active) {
        this._workspaceGestureActive = !!active;
      }

      /** True if any shell-camera debug channel is on (see `readShellDebugFromEnv`). */
      readShellDebugFromEnv() {
        try {
          const q = new URLSearchParams(window.location.search || '');
          let v = (q.get('debugShell') || '').toLowerCase().trim();
          if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
          const rawHash = (window.location.hash || '').replace(/^#/, '').trim();
          if (rawHash) {
            const hashPair = rawHash.split(/[?&]/).find((p) => /^debugShell/i.test(p));
            if (hashPair) {
              const hv = hashPair.includes('=')
                ? (hashPair.split('=')[1] || '1').toLowerCase().trim()
                : '1';
              if (hv === '' || hv === '1' || hv === 'true' || hv === 'yes' || hv === 'on')
                return true;
            }
          }
          if (typeof localStorage !== 'undefined') {
            v = (localStorage.getItem('debugShell') || '').toLowerCase().trim();
            if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
          }
        } catch (_) {}
        return false;
      }

      /**
       * Opt-in debug for pinch/pan/clamp logs:
       * - URL `?debugShell=1` (or true/yes/on)
       * - Hash `#debugShell` or `#debugShell=1` (works when query strings are stripped)
       * - `localStorage.setItem('debugShell','1')` then reload
       * - `window.DEBUG_SHELL_CAMERA = true` (also accepts `'1'`, `'true'`, `1`)
       * - `canvasShell.setShellCameraDebug(true)`
       * Turn off: `canvasShell.setShellCameraDebug(false)` or `window.DEBUG_SHELL_CAMERA = false`
       */
      isShellCameraDebug() {
        if (window.DEBUG_SHELL_CAMERA === false) return false;
        const w = window.DEBUG_SHELL_CAMERA;
        if (w === true || w === 1) return true;
        if (typeof w === 'string') {
          const s = w.trim().toLowerCase();
          if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
        }
        if (this._shellDebugEnvResolved === undefined) {
          this._shellDebugEnvResolved = this.readShellDebugFromEnv();
        }
        return this._shellDebugEnvResolved;
      }

      setShellCameraDebug(on) {
        window.DEBUG_SHELL_CAMERA = !!on;
        try {
          if (on) localStorage.setItem('debugShell', '1');
          else localStorage.removeItem('debugShell');
        } catch (_) {}
        if (on) {
          console.log(
            '%c[shell-camera] debug ON',
            'color:#0ae;font-weight:bold',
            '— pinch logs go to this console (the TOP / index page). Not the invoice iframe DevTools window.'
          );
          console.log(
            '[shell-camera] Now pinch with two fingers on the canvas or invoice; you should see "pinch started" then "pinch step" for each move.'
          );
          this.logShellDebugSnapshot('after enable');
        } else {
          console.log('[shell-camera] debug OFF');
        }
      }

      /**
       * Pinch step logging. Meaningful zoom/pan steps log every frame; no-ops at min/max zoom
       * or identity steps are throttled so DevTools stays usable and we avoid extra work correlating to jank.
       */
      logShellCameraPinch(payload) {
        if (!this.isShellCameraDebug()) return;
        const noopPinch =
          payload.blockedAtZoomLimit ||
          (!payload.pinchPanApplied &&
            payload.zBefore === payload.zAfter &&
            Math.abs(payload.zoomFactor) <= 1e-6);
        if (noopPinch) {
          this.logShellCameraThrottled(
            'pinch-noop',
            500,
            'pinch step (no zoom change — likely at min/max)',
            payload
          );
          return;
        }
        console.log('[shell-camera] pinch step', payload);
      }

      logShellCameraThrottled(key, intervalMs, label, payload) {
        if (!this.isShellCameraDebug()) return;
        const t = performance.now();
        const last = this._shellDebugThrottles[key] || 0;
        if (t - last < intervalMs) return;
        this._shellDebugThrottles[key] = t;
        console.log(`[shell-camera] ${label}`, payload);
      }

      logShellDebugSnapshot(reason) {
        if (!this.isShellCameraDebug()) return;
        const iframe = document.getElementById('invoiceFrame');
        const vv = window.visualViewport;
        console.log(`[shell-camera] snapshot (${reason})`, {
          camera: { ...this.camera },
          visualViewport: vv
            ? {
                width: vv.width,
                height: vv.height,
                offsetLeft: vv.offsetLeft,
                offsetTop: vv.offsetTop,
                scale: vv.scale
              }
            : null,
          inner: { w: window.innerWidth, h: window.innerHeight },
          iframe: iframe
            ? { offsetW: iframe.offsetWidth, offsetH: iframe.offsetHeight }
            : null,
          flags: {
            workspaceGesture: this._workspaceGestureActive,
            shellPinch: this._shellPinchActive
          }
        });
      }

      /** Layout/CSS pixel center of the visible viewport (helps when URL bar changes innerHeight). */
      viewportCenter() {
        const vv = window.visualViewport;
        if (vv && vv.width > 0) {
          return {
            cx: vv.offsetLeft + vv.width / 2,
            cy: vv.offsetTop + vv.height / 2
          };
        }
        return { cx: window.innerWidth / 2, cy: window.innerHeight / 2 };
      }

      stopShellPanMomentum() {
        if (this._shellPanMomentumRaf != null) {
          cancelAnimationFrame(this._shellPanMomentumRaf);
          this._shellPanMomentumRaf = null;
        }
        this._shellPanMomFrameTs = null;
        if (!this._shellPanMomentumVel) this._shellPanMomentumVel = { vx: 0, vy: 0 };
        this._shellPanMomentumVel.vx = 0;
        this._shellPanMomentumVel.vy = 0;
      }

      /** Touch cancelled / interrupted — no flick, clear sampling. */
      abortTouchPanInertiaSampling() {
        this.stopShellPanMomentum();
        this._touchPanInertPrev = null;
        if (this._touchPanInertEma) {
          this._touchPanInertEma.vx = 0;
          this._touchPanInertEma.vy = 0;
        }
      }

      resetTouchPanInertiaTracking(clientX, clientY) {
        this.stopShellPanMomentum();
        const t = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        this._touchPanInertPrev = { x: clientX, y: clientY, t };
        if (!this._touchPanInertEma) this._touchPanInertEma = { vx: 0, vy: 0 };
        this._touchPanInertEma.vx = 0;
        this._touchPanInertEma.vy = 0;
      }

      touchPanInertiaSampleFromMove(clientX, clientY, panDiv) {
        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        const p = this._touchPanInertPrev;
        if (!p) {
          this._touchPanInertPrev = { x: clientX, y: clientY, t: now };
          return;
        }
        const dt = now - p.t;
        if (dt <= 0 || dt > 100) {
          this._touchPanInertPrev = { x: clientX, y: clientY, t: now };
          return;
        }
        const dcx = (clientX - p.x) / panDiv;
        const dcy = (clientY - p.y) / panDiv;
        /** ~60fps frame equivalents (px/frame) for momentum tick */
        const ivx = (dcx / dt) * 16.67;
        const ivy = (dcy / dt) * 16.67;
        if (!this._touchPanInertEma) this._touchPanInertEma = { vx: 0, vy: 0 };
        const ema = 0.68;
        this._touchPanInertEma.vx = this._touchPanInertEma.vx * ema + ivx * (1 - ema);
        this._touchPanInertEma.vy = this._touchPanInertEma.vy * ema + ivy * (1 - ema);
        this._touchPanInertPrev = { x: clientX, y: clientY, t: now };
      }

      kickTouchPanInertiaIfFastEnough() {
        if (!this._touchPanInertEma) return;
        const e = this._touchPanInertEma;
        const sp = Math.hypot(e.vx, e.vy);
        const minV = 0.52;
        if (sp < minV) return;
        if (!this._shellPanMomentumVel) this._shellPanMomentumVel = { vx: 0, vy: 0 };
        const boost = 1.06;
        this._shellPanMomentumVel.vx += e.vx * boost;
        this._shellPanMomentumVel.vy += e.vy * boost;
        this._touchPanInertEma.vx = 0;
        this._touchPanInertEma.vy = 0;
        this._touchPanInertPrev = null;
        this.ensureShellPanMomentumRaf();
      }

      /** Trackpad cardinal swipe: extra coast so rapid two-finger scrolls match OS-like inertia. */
      impulseShellPanMomentumTrackpad(panX, panY) {
        if (!this._shellPanMomentumVel) this._shellPanMomentumVel = { vx: 0, vy: 0 };
        const k = 0.017;
        const carry = 0.86;
        this._shellPanMomentumVel.vx = this._shellPanMomentumVel.vx * carry + panX * k;
        this._shellPanMomentumVel.vy = this._shellPanMomentumVel.vy * carry + panY * k;
        this.ensureShellPanMomentumRaf();
      }

      ensureShellPanMomentumRaf() {
        if (this._shellPanMomentumRaf != null) return;
        this._shellPanMomFrameTs = null;
        this._shellPanMomentumRaf = requestAnimationFrame((ts) => {
          this._shellPanMomentumRaf = null;
          this.shellPanMomentumTick(ts);
        });
      }

      shellPanMomentumTick(ts) {
        if (!this._shellPanMomentumVel) this._shellPanMomentumVel = { vx: 0, vy: 0 };
        if (this._shellPanMomFrameTs == null) this._shellPanMomFrameTs = ts;
        let dt = ts - this._shellPanMomFrameTs;
        this._shellPanMomFrameTs = ts;
        dt = Math.max(1, Math.min(dt, 32));
        let vx = this._shellPanMomentumVel.vx;
        let vy = this._shellPanMomentumVel.vy;
        const scale = dt / 16.67;
        this.camera.x += vx * scale;
        this.camera.y += vy * scale;
        const friction = Math.pow(0.912, scale);
        vx *= friction;
        vy *= friction;
        this._shellPanMomentumVel.vx = vx;
        this._shellPanMomentumVel.vy = vy;
        this.updateCanvasTransform();
        if (Math.hypot(vx, vy) < 0.075) {
          this.stopShellPanMomentum();
          return;
        }
        this._shellPanMomentumRaf = requestAnimationFrame((t) => this.shellPanMomentumTick(t));
      }

      /**
       * One-finger **touch** pan: divide finger delta by this (canvas + iframe, all touch devices).
       * Uses max(floor, z) so:
       * - Zoomed in (z>1): divisor grows with z → calmer pan (avoids “runaway” vs screen pixels).
       * - Zoomed out / near 1×: at least ~1.08 so pans are steadier than raw 1:1.
       * Critical: **no branch at z===1** — the old `z>1 ? z : max(1.08,z*1.08)` jumped ~8% in
       * sensitivity across 1× and felt erratic while pinching or working slightly zoomed.
       */
      mobilePanPixelDivisor() {
        const z = Math.max(0.1, Math.min(5, this.camera.zoom || 1));
        const touchPanFloor = 1.08;
        return Math.max(touchPanFloor, z);
      }

      /** Keep pan from drifting arbitrarily far on mobile (reduces “flies off screen”). */
      clampCameraBounds() {
        const z = Math.max(0.1, Math.min(5, this.camera.zoom || 1));
        const iframe = document.getElementById('invoiceFrame');
        let iw = 800;
        let ih = 1000;
        if (iframe) {
          iw = Math.max(iframe.offsetWidth || 400, 200);
          ih = Math.max(iframe.offsetHeight || 500, 200);
        }
        const vv = window.visualViewport;
        const vw =
          vv && vv.width > 0 ? vv.width : window.innerWidth || 320;
        const vh =
          vv && vv.height > 0 ? vv.height : window.innerHeight || 480;
        const scaledW = iw * z;
        const scaledH = ih * z;
        const slack = Math.min(vw, vh) * 0.5;
        const maxX = scaledW * 0.5 + vw * 0.5 + slack;
        const maxY = scaledH * 0.5 + vh * 0.5 + slack;
        const x0 = this.camera.x;
        const y0 = this.camera.y;
        if (Number.isFinite(this.camera.x)) {
          this.camera.x = Math.max(-maxX, Math.min(maxX, this.camera.x));
        }
        if (Number.isFinite(this.camera.y)) {
          this.camera.y = Math.max(-maxY, Math.min(maxY, this.camera.y));
        }
        if (this.isShellCameraDebug() && (this.camera.x !== x0 || this.camera.y !== y0)) {
          this.logShellCameraThrottled('clamp-bounds', 400, 'clamp applied', {
            before: { x: x0, y: y0 },
            after: { x: this.camera.x, y: this.camera.y },
            bounds: { maxX, maxY },
            z,
            iframeCss: { iw, ih },
            viewport: { vw, vh },
            slack
          });
        }
      }

      /**
       * Two-finger pinch step in **parent viewport** client pixels (centerClientX/Y).
       * Drives shell camera only — fixed menus/chrome are not scaled.
       */
      applyPinchGestureStep(relativeScale, centerClientX, centerClientY) {
        if (!(relativeScale > 0) || !Number.isFinite(relativeScale)) return;
        this.stopShellPanMomentum();
        // Raw ratio is extremely noisy; EMA + tight clamp stops alternating ±10% zoom (and pan) each frame.
        const raw = Math.max(0.72, Math.min(1.35, relativeScale));
        const beta = this.isMobileDevice() ? 0.48 : 0.4;
        if (this._pinchScaleEma == null || !Number.isFinite(this._pinchScaleEma)) {
          this._pinchScaleEma = raw;
        } else {
          this._pinchScaleEma += (raw - this._pinchScaleEma) * beta;
        }
        const lo = 0.92;
        const hi = 1.08;
        const safe = Math.max(lo, Math.min(hi, this._pinchScaleEma));
        const zBefore = Math.max(0.1, Math.min(5, this.camera.zoom || 1));
        const zAfter = Math.max(0.1, Math.min(5, zBefore * safe));
        this.camera.zoom = zAfter;
        // Pan only by the zoom that actually applied — at min/max zoom, extra pinch must not drift the camera.
        const zoomFactor = zAfter / zBefore - 1;
        if (Math.abs(zoomFactor) > 1e-6) {
          const { cx, cy } = this.viewportCenter();
          if (!this._pinchFocalSmooth) {
            this._pinchFocalSmooth = { x: centerClientX, y: centerClientY };
          } else {
            const alpha = this.isMobileDevice() ? 0.45 : 0.38;
            this._pinchFocalSmooth.x += (centerClientX - this._pinchFocalSmooth.x) * alpha;
            this._pinchFocalSmooth.y += (centerClientY - this._pinchFocalSmooth.y) * alpha;
          }
          const fx = this._pinchFocalSmooth.x;
          const fy = this._pinchFocalSmooth.y;
          let rawDx = (fx - cx) * zoomFactor;
          let rawDy = (fy - cy) * zoomFactor;
          // Already zoomed in: focal follow is more aggressive in screen space — ease it so pinch doesn’t “orbit” wildly.
          if (zBefore > 1.35) {
            const pinchPanEase = Math.min(1, Math.sqrt(1.35 / zBefore));
            rawDx *= pinchPanEase;
            rawDy *= pinchPanEase;
          }
          const vv = window.visualViewport;
          const vw = vv && vv.width > 0 ? vv.width : window.innerWidth || 320;
          const vh = vv && vv.height > 0 ? vv.height : window.innerHeight || 480;
          const panCap = Math.min(vw, vh) * (this.isMobileDevice() ? 0.34 : 0.22);
          const mag = Math.hypot(rawDx, rawDy);
          if (mag > panCap && mag > 0) {
            const s = panCap / mag;
            rawDx *= s;
            rawDy *= s;
          }
          this.camera.x -= rawDx;
          this.camera.y -= rawDy;
        }
        const preClamp = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };
        const pinchChangedCamera = Math.abs(zoomFactor) > 1e-6;
        if (pinchChangedCamera) {
          this.updateCanvasTransform();
        }
        this.logShellCameraPinch({
          relativeScale,
          scaleRawClamped: raw,
          scaleEma: this._pinchScaleEma,
          safe,
          zBefore,
          zAfter,
          zoomFactor,
          pinchPanApplied: pinchChangedCamera,
          blockedAtZoomLimit:
            Math.abs(zoomFactor) <= 1e-6 && Math.abs(safe - 1) > 0.001,
          scaleBandClamped:
            Math.abs(safe - this._pinchScaleEma) > 1e-6,
          center: { x: centerClientX, y: centerClientY },
          focalSmoothed: this._pinchFocalSmooth
            ? { ...this._pinchFocalSmooth }
            : null,
          viewportCenter: this.viewportCenter(),
          afterPinchBeforeClamp: preClamp,
          afterClamp: pinchChangedCamera
            ? {
                x: this.camera.x,
                y: this.camera.y,
                zoom: this.camera.zoom
              }
            : preClamp,
          clamped: pinchChangedCamera
            ? preClamp.x !== this.camera.x || preClamp.y !== this.camera.y
            : false
        });
      }

      updateOverlayTransform() {
        const overlay = document.getElementById('canvasOverlay');
        if (overlay) {
          // translate3d promotes a stable compositor layer during touch pinch (fewer flashes than translate2d)
          overlay.style.transform = `translate3d(${this.camera.x}px, ${this.camera.y}px, 0) scale(${this.camera.zoom})`;
        }
      }

      updateCanvasTransform() {
        this.clampCameraBounds();
        this.updateOverlayTransform();
        // Redraw canvas with updated grid
        this.drawCanvas();
      }

      drawCanvas() {
        // Canvas drawing is now handled by CSS dotted background pattern
        // No need for manual grid drawing - the CSS background provides the dots
      }

      // Zoom controls for the infinite canvas
      zoomIn() {
        this.stopShellPanMomentum();
        this.camera.zoom = Math.min(5, this.camera.zoom + 0.2);
        this.updateCanvasTransform();
        console.log(`🔍 Camera zoom in: ${this.camera.zoom.toFixed(1)}x`);
      }

      zoomOut() {
        this.camera.zoom = Math.max(0.1, this.camera.zoom - 0.2);
        this.updateCanvasTransform();
        console.log(`🔍 Camera zoom out: ${this.camera.zoom.toFixed(1)}x`);
      }

      resetZoom() {
        this.stopShellPanMomentum();
        this.camera.zoom = 1;
        this.camera.x = 0;
        this.camera.y = 0;
        this.updateCanvasTransform();
        console.log('🔍 Camera reset');
      }

      // Zoom menu toggle methods
      toggleZoomMenu() {
        const toggle = document.getElementById('zoomToggle');
        const drawer = document.getElementById('zoomDrawer');
        if (drawer && toggle) {
          const isOpen = drawer.classList.contains('open');
          if (isOpen) {
            this.closeZoomMenu();
          } else {
            this.openZoomMenu();
          }
        }
      }

      openZoomMenu() {
        const toggle = document.getElementById('zoomToggle');
        const drawer = document.getElementById('zoomDrawer');
        if (toggle) {
          toggle.classList.add('open');
          toggle.classList.remove('idle');
        }
        if (drawer) {
          drawer.classList.add('open');
          drawer.classList.remove('idle');
          // Load position when opening to ensure it's in the right place
          this.loadDrawerPosition();
        }
        // Reset idle timer
        if (this._resetIdleTimer) this._resetIdleTimer();
      }

      closeZoomMenu() {
        const toggle = document.getElementById('zoomToggle');
        const drawer = document.getElementById('zoomDrawer');
        if (toggle) {
          toggle.classList.remove('open');
          toggle.classList.remove('idle');
        }
        if (drawer) {
          drawer.classList.remove('open');
          drawer.classList.remove('idle');
          // Save position when closing
          this.saveDrawerPosition();
        }
        // Reset idle timer
        if (this._resetIdleTimer) this._resetIdleTimer();
      }
      
      // ========================================
      // DATA PERSISTENCE
      // ========================================
      
      loadData() {
        try {
          // Load products
          const savedProducts = localStorage.getItem('invoiceApp_products');
          this.data.products = savedProducts ? JSON.parse(savedProducts) : this.getDefaultProducts();
          
          // Load clients
          const savedClients = localStorage.getItem('invoiceApp_clients');
          this.data.clients = savedClients ? JSON.parse(savedClients) : this.getDefaultClients();
          
          // Load company info
          const savedCompany = localStorage.getItem('invoiceApp_company');
          this.data.company = savedCompany ? JSON.parse(savedCompany) : this.getDefaultCompany();
          
          // Load settings
          const savedSettings = localStorage.getItem('invoiceApp_settings');
          this.data.settings = savedSettings ? JSON.parse(savedSettings) : { currentMode: 'edit', autoSave: true, defaultCurrency: '£' };
          
          console.log('📁 Data loaded from localStorage');
        } catch (error) {
          console.error('Error loading data:', error);
          this.data = {
            products: this.getDefaultProducts(),
            clients: this.getDefaultClients(),
            company: this.getDefaultCompany(),
            settings: { currentMode: 'edit', autoSave: true, defaultCurrency: '£' }
          };
        }
      }
      
      saveData() {
        try {
          localStorage.setItem('invoiceApp_products', JSON.stringify(this.data.products));
          localStorage.setItem('invoiceApp_clients', JSON.stringify(this.data.clients));
          localStorage.setItem('invoiceApp_company', JSON.stringify(this.data.company));
          localStorage.setItem('invoiceApp_settings', JSON.stringify(this.data.settings));
          console.log('💾 Data saved to localStorage');
        } catch (error) {
          console.error('Error saving data:', error);
        }
      }
      
      // ========================================
      // DEFAULT DATA
      // ========================================
      
      getDefaultProducts() {
        return [
          {
            id: 1,
            name: 'Example Product',
            category: 'product',
            icon: '📦',
            image: null,
            description: 'Sample product for demonstration',
            price: 0.00
          },
          {
            id: 2,
            name: 'Service Example',
            category: 'service',
            icon: '🔧',
            image: null,
            description: 'Sample service for demonstration',
            price: 0.00
          }
        ];
      }
      
      getDefaultClients() {
        return [
          {
            clientId: 1,
            client: {
              name: 'John Smith',
              address: '123 Main Street',
              city: 'London, E1 1AA',
              phone: '+44 20 1234 5678',
              email: 'john.smith@email.com',
              type: 'Individual',
              status: 'active',
              notes: 'Regular customer, prefers morning deliveries'
            }
          },
          {
            clientId: 2,
            client: {
              name: 'Sarah Johnson',
              address: '456 High Road',
              city: 'Manchester, M1 1AA',
              phone: '+44 161 123 4567',
              email: 'sarah.j@email.com',
              type: 'Company',
              status: 'active',
              notes: 'Business client, office hours only'
            }
          }
        ];
      }
      
      getDefaultCompany() {
        return {
          name: 'Your Company Name',
          address: 'Your Company Address',
          city: 'Your City, Postcode',
          phone: 'Your Phone Number',
          email: 'your.email@company.com',
          companyNumber: 'Your Company Number',
          vatNumber: 'Your VAT Number',
          bankName: 'Your Bank Name',
          accountName: 'Your Account Name',
          sortCode: 'Your Sort Code',
          account: 'Your Account Number',
          logo: null
        };
      }
      
      // ========================================
      // MODE MANAGEMENT
      // ========================================
      
      initModeToggle() {
        const modeButtons = document.querySelectorAll('.mode-btn');
        modeButtons.forEach(btn => {
          btn.addEventListener('click', (e) => {
            const mode = e.target.dataset.mode;
            this.switchMode(mode);
          });
        });
        
        // Set initial mode
        this.switchMode(this.data.settings.currentMode);
      }
      
      switchMode(mode) {
        this.currentMode = mode;
        this.data.settings.currentMode = mode;
        
        // Update body class
        document.body.className = `${mode}-mode`;
        
        // Update mode buttons
        document.querySelectorAll('.mode-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        
        // Show/hide mode-specific buttons
        document.querySelectorAll('.edit-mode-only').forEach(el => {
          el.classList.toggle('hidden', mode !== 'edit');
        });
        
        document.querySelectorAll('.preview-mode-only').forEach(el => {
          el.classList.toggle('hidden', mode !== 'preview');
        });
        
        // Apply JavaScript-based editing restrictions for preview mode
        if (mode === 'preview') {
          this.disableEditing();
        } else {
          this.enableEditing();
        }
        
        this.saveData();
        try {
          var sidebarFrame = document.getElementById('sidebarIframe');
          if (sidebarFrame && sidebarFrame.contentWindow) {
            sidebarFrame.contentWindow.postMessage({ source: 'parent-invoice', action: 'setMode', mode: mode }, '*');
          }
          var invoiceFrame = document.getElementById('invoiceFrame');
          if (invoiceFrame && invoiceFrame.contentWindow) {
            invoiceFrame.contentWindow.postMessage({ type: 'switch-mode', mode: mode }, '*');
          }
        } catch (_) {}
        console.log(`🔄 Switched to ${mode} mode`);
      }
      
      // ========================================
      // EDITING CONTROL METHODS
      // ========================================
      
      disableEditing() {
        // Disable all contenteditable elements
        document.querySelectorAll('[contenteditable]').forEach(el => {
          el.setAttribute('data-original-contenteditable', 'true');
          el.contentEditable = false;
        });
        
        // Disable all input fields
        document.querySelectorAll('input, textarea, select').forEach(el => {
          el.setAttribute('data-original-disabled', el.disabled);
          el.disabled = true;
          el.readOnly = true;
        });
        
        // Disable all buttons except mode buttons, preview mode buttons, always-enabled, and floating menu buttons
        document.querySelectorAll('button:not(.mode-btn):not(.preview-mode-only):not(.always-enabled):not(.category-shortcut-btn)').forEach(el => {
          el.setAttribute('data-original-disabled', el.disabled);
          el.disabled = true;
        });
        
        console.log('🔒 Editing disabled in preview mode');
      }
      
      enableEditing() {
        // Ensure body is not stuck with preview-mode
        document.body.classList.remove('preview-mode');
        
        // Restore contenteditable elements
        document.querySelectorAll('[data-original-contenteditable]').forEach(el => {
          el.contentEditable = true;
          el.removeAttribute('data-original-contenteditable');
        });
        
        // Restore input fields
        document.querySelectorAll('input[data-original-disabled], textarea[data-original-disabled], select[data-original-disabled]').forEach(el => {
          el.disabled = el.getAttribute('data-original-disabled') === 'true';
          el.readOnly = false;
          el.removeAttribute('data-original-disabled');
        });
        
        // Restore buttons (excluding mode/preview-only/always-enabled/category-shortcut which should remain enabled)
        document.querySelectorAll('button[data-original-disabled]:not(.mode-btn):not(.preview-mode-only):not(.always-enabled):not(.category-shortcut-btn)').forEach(el => {
          el.disabled = el.getAttribute('data-original-disabled') === 'true';
          el.removeAttribute('data-original-disabled');
        });
        
        // Fallback: force-enable any still-disabled fields in modals (parent has receipt/statement modals)
        document.querySelectorAll('.modal-overlay input, .modal-overlay textarea, .modal-overlay select, .modal-overlay button').forEach(el => {
          if (el.disabled) el.disabled = false;
          if (el.tagName !== 'SELECT' && el.readOnly) el.readOnly = false;
        });
        
        console.log('🔓 Editing enabled in edit mode');
      }
      
      // Event prevention methods removed - using CSS-based approach instead
      
      // ========================================
      // DATA MANAGEMENT MODAL
      // ========================================
      
      showDataManagement() {
        const modal = document.getElementById('dataModal');
        modal.classList.add('show');
        this.populateDataModal();
      }
      
      initDataManagement() {
        const dataBtn = document.getElementById('dataManagementBtn');
        const modal = document.getElementById('dataModal');
        const closeBtn = document.getElementById('closeModal');
        
        // Open modal
        dataBtn.addEventListener('click', () => {
          this.showDataManagement();
        });
        
        // Close modal
        closeBtn.addEventListener('click', () => {
          modal.classList.remove('show');
          this.syncInvoiceFrameFromStorage();
        });
        
        // Close on overlay click
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            modal.classList.remove('show');
            this.syncInvoiceFrameFromStorage();
          }
        });
        
        // Tab switching
        document.querySelectorAll('.tab-button').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const tabId = e.target.dataset.tab;
            this.switchTab(tabId);
          });
        });
        
        // Initialize forms
        this.initProductForm();
        this.initClientForm();
        this.initCompanyForm();
        this.initCounterControl();
      }
      
      switchTab(tabId) {
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        
        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
          content.classList.toggle('active', content.id === `${tabId}-tab`);
        });
        
        // Refresh tab-specific content
        if (tabId === 'products') {
          this.populateProductsList();
        } else if (tabId === 'clients') {
          this.populateClientsList();
        } else if (tabId === 'company') {
          this.populateCompanyForm();
        } else if (tabId === 'export') {
          this.refreshCounterControl();
        }
      }
      
      populateDataModal() {
        this.populateProductsList();
        this.populateClientsList();
        this.populateCompanyForm();
        this.refreshCounterControl();
      }

      initCounterControl() {
        const input = document.getElementById('counterInput');
        const minusBtn = document.getElementById('counterStepperMinus');
        const plusBtn = document.getElementById('counterStepperPlus');
        const resetBtn = document.getElementById('counterResetBtn');
        if (!input || !minusBtn || !plusBtn || !resetBtn) return;

        const syncInputFromStorage = () => {
          const n = typeof GlobalStorage !== 'undefined' ? GlobalStorage.getNextInvoiceNumber() : 1;
          input.value = n;
        };

        const applyAndUpdate = (value) => {
          const n = Math.max(1, Math.min(99999, Math.floor(Number(value)) || 1));
          if (typeof GlobalStorage !== 'undefined' && GlobalStorage.setNextInvoiceNumber) {
            GlobalStorage.setNextInvoiceNumber(n);
          } else if (typeof GlobalStorage !== 'undefined') {
            GlobalStorage.saveGlobalData({ nextInvoiceNumber: n });
          }
          input.value = n;
          if (window.canvasShell && window.canvasShell.invoiceAction) {
            window.canvasShell.invoiceAction('applyCounterToDraft', { value: n });
          }
          this.syncInvoiceFrameFromStorage();
        };

        syncInputFromStorage();

        minusBtn.addEventListener('click', () => {
          const current = Math.max(1, Math.floor(Number(input.value)) || 1);
          applyAndUpdate(current - 1);
        });
        plusBtn.addEventListener('click', () => {
          const current = Math.max(1, Math.floor(Number(input.value)) || 1);
          applyAndUpdate(current + 1);
        });
        resetBtn.addEventListener('click', () => applyAndUpdate(1));

        input.addEventListener('change', () => applyAndUpdate(input.value));
        input.addEventListener('blur', () => {
          const v = input.value;
          if (v === '' || isNaN(Number(v))) syncInputFromStorage();
          else applyAndUpdate(v);
        });
      }

      refreshCounterControl() {
        const input = document.getElementById('counterInput');
        if (input && typeof GlobalStorage !== 'undefined') {
          input.value = GlobalStorage.getNextInvoiceNumber();
        }
      }
      
      // ========================================
      // PRODUCTS MANAGEMENT
      // ========================================
      
      initProductForm() {
        document.getElementById('addProductBtn').addEventListener('click', () => {
          this.showProductForm();
        });
      }
      
      showProductForm(product = null) {
        const isEdit = !!product;
        const formHtml = `
          <div class="form-row">
            <div class="form-group">
              <label>Name *</label>
              <input type="text" id="productName" value="${product?.name || ''}" required>
            </div>
            <div class="form-group">
              <label>Type</label>
              <select id="productCategory">
                <option value="product" ${product?.category === 'product' ? 'selected' : ''}>Product</option>
                <option value="service" ${product?.category === 'service' ? 'selected' : ''}>Service</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Price (£)</label>
              <input type="number" id="productPrice" step="0.01" value="${product?.price || '0.00'}" placeholder="0.00">
            </div>
            <div class="form-group">
              <label>Icon</label>
              <input type="text" id="productIcon" value="${product?.icon || '📦'}" placeholder="📦">
            </div>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea id="productDescription" placeholder="Item description...">${product?.description || ''}</textarea>
          </div>
          <div class="form-group">
            <label>Item Image</label>
            <div class="image-upload" onclick="document.getElementById('productImageFile').click()">
              <input type="file" id="productImageFile" accept="image/*" style="display: none;">
              <p>📁 Click to upload item image</p>
              <div class="image-preview" id="productImagePreview">
                ${product?.image ? `<img src="${product.image}" alt="Item">` : ''}
              </div>
            </div>
          </div>
          <div class="text-center mt-20">
            <button type="button" class="btn btn-primary" onclick="app.saveProduct(${isEdit ? product.id : 'null'})">
              💾 ${isEdit ? 'Update' : 'Add'} Item
            </button>
            <button type="button" class="btn btn-secondary" onclick="app.populateProductsList()">
              ❌ Cancel
            </button>
          </div>
        `;
        
        document.getElementById('productsList').innerHTML = formHtml;
        
        // Handle image upload
        document.getElementById('productImageFile').addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
              document.getElementById('productImagePreview').innerHTML = 
                `<img src="${e.target.result}" alt="Product">`;
            };
            reader.readAsDataURL(file);
          }
        });
      }
      
      saveProduct(editId = null) {
        const name = document.getElementById('productName').value.trim();
        const category = document.getElementById('productCategory').value;
        const price = parseFloat(document.getElementById('productPrice').value) || 0.00;
        const icon = document.getElementById('productIcon').value.trim() || '📦';
        const description = document.getElementById('productDescription').value.trim();
        const imagePreview = document.querySelector('#productImagePreview img');
        const image = imagePreview ? imagePreview.src : null;
        
        if (!name) {
          alert('Name is required!');
          return;
        }
        
        const productData = { name, category, price, icon, description, image };
        
        if (editId) {
          // Update existing product
          const index = this.data.products.findIndex(p => p.id === editId);
          if (index !== -1) {
            this.data.products[index] = { ...this.data.products[index], ...productData };
          }
        } else {
          // Add new product
          const newId = Math.max(...this.data.products.map(p => p.id), 0) + 1;
          this.data.products.push({ id: newId, ...productData });
        }
        
        this.saveData();
        this.populateProductsList();
        this.syncInvoiceFrameFromStorage();
        
        console.log(`✅ Product ${editId ? 'updated' : 'added'}: ${name}`);
      }
      
      deleteProduct(id) {
        if (confirm('Are you sure you want to delete this product?')) {
          this.data.products = this.data.products.filter(p => p.id !== id);
          this.saveData();
          this.populateProductsList();
          this.syncInvoiceFrameFromStorage();
          console.log(`🗑️ Product deleted: ID ${id}`);
        }
      }
      
      populateProductsList() {
        const container = document.getElementById('productsList');
        if (this.data.products.length === 0) {
          container.innerHTML = '<div class="text-center" style="padding: 40px; color: #666;">No products added yet.</div>';
          return;
        }
        
        const html = this.data.products.map(product => `
          <div class="data-item">
            <div class="data-item-info">
              <div class="data-item-name">${product.icon} ${product.name}</div>
              <div class="data-item-details">
                ${product.category} • £${product.price.toFixed(2)} • ${product.description}
              </div>
            </div>
            <div class="data-item-actions">
              <button class="btn-sm btn-edit" onclick="app.showProductForm(${JSON.stringify(product).replace(/"/g, '&quot;')})">
                ✏️ Edit
              </button>
              <button class="btn-sm btn-delete" onclick="app.deleteProduct(${product.id})">
                🗑️ Delete
              </button>
            </div>
          </div>
        `).join('');
        
        container.innerHTML = html;
      }
      
      // ========================================
      // CLIENTS MANAGEMENT  
      // ========================================
      
      initClientForm() {
        document.getElementById('addClientBtn').addEventListener('click', () => {
          this.showClientForm();
        });
      }
      
      showClientForm(clientData = null) {
        const isEdit = !!clientData;
        const client = clientData?.client || {};
        
        const formHtml = `
          <div class="form-row">
            <div class="form-group">
              <label>Client Name *</label>
              <input type="text" id="clientName" value="${client.name || ''}" required>
            </div>
            <div class="form-group">
              <label>Type</label>
              <select id="clientType">
                <option value="Individual" ${client.type === 'Individual' ? 'selected' : ''}>Individual</option>
                <option value="Company" ${client.type === 'Company' ? 'selected' : ''}>Company</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Address</label>
              <input type="text" id="clientAddress" value="${client.address || ''}">
            </div>
            <div class="form-group">
              <label>City</label>
              <input type="text" id="clientCity" value="${client.city || ''}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Phone</label>
              <input type="text" id="clientPhone" value="${client.phone || ''}">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="clientEmail" value="${client.email || ''}">
            </div>
          </div>
          <div class="form-group">
            <label>Notes</label>
            <textarea id="clientNotes" placeholder="Additional notes...">${client.notes || ''}</textarea>
          </div>
          <div class="text-center mt-20">
            <button type="button" class="btn btn-primary" onclick="app.saveClient(${isEdit ? clientData.clientId : 'null'})">
              💾 ${isEdit ? 'Update' : 'Add'} Client
            </button>
            <button type="button" class="btn btn-secondary" onclick="app.populateClientsList()">
              ❌ Cancel
            </button>
          </div>
        `;
        
        document.getElementById('clientsList').innerHTML = formHtml;
      }
      
      saveClient(editId = null) {
        const name = document.getElementById('clientName').value.trim();
        const type = document.getElementById('clientType').value;
        const address = document.getElementById('clientAddress').value.trim();
        const city = document.getElementById('clientCity').value.trim();
        const phone = document.getElementById('clientPhone').value.trim();
        const email = document.getElementById('clientEmail').value.trim();
        const notes = document.getElementById('clientNotes').value.trim();
        
        if (!name) {
          alert('Client name is required!');
          return;
        }
        
        const clientData = {
          client: { name, type, address, city, phone, email, notes, status: 'active' }
        };
        
        if (editId) {
          // Update existing client
          const index = this.data.clients.findIndex(c => c.clientId === editId);
          if (index !== -1) {
            this.data.clients[index] = { clientId: editId, ...clientData };
          }
        } else {
          // Add new client
          const newId = Math.max(...this.data.clients.map(c => c.clientId), 0) + 1;
          this.data.clients.push({ clientId: newId, ...clientData });
        }
        
        this.saveData();
        this.populateClientsList();
        this.syncInvoiceFrameFromStorage();
        
        console.log(`✅ Client ${editId ? 'updated' : 'added'}: ${name}`);
      }
      
      deleteClient(id) {
        if (confirm('Are you sure you want to delete this client?')) {
          this.data.clients = this.data.clients.filter(c => c.clientId !== id);
          this.saveData();
          this.populateClientsList();
          this.syncInvoiceFrameFromStorage();
          console.log(`🗑️ Client deleted: ID ${id}`);
        }
      }
      
      populateClientsList() {
        const container = document.getElementById('clientsList');
        if (this.data.clients.length === 0) {
          container.innerHTML = '<div class="text-center" style="padding: 40px; color: #666;">No clients added yet.</div>';
          return;
        }
        
        const html = this.data.clients.map(clientData => {
          const client = clientData.client;
          return `
            <div class="data-item">
              <div class="data-item-info">
                <div class="data-item-name">👤 ${client.name}</div>
                <div class="data-item-details">
                  ${client.type} • ${client.address}, ${client.city} • ${client.phone} • ${client.email}
                </div>
              </div>
              <div class="data-item-actions">
                <button class="btn-sm btn-edit" onclick="app.showClientForm(${JSON.stringify(clientData).replace(/"/g, '&quot;')})">
                  ✏️ Edit
                </button>
                <button class="btn-sm btn-delete" onclick="app.deleteClient(${clientData.clientId})">
                  🗑️ Delete
                </button>
              </div>
            </div>
          `;
        }).join('');
        
        container.innerHTML = html;
      }
      
      // ========================================
      // COMPANY MANAGEMENT
      // ========================================
      
      initCompanyForm() {
        const form = document.getElementById('companyForm');
        const logoUpload = document.getElementById('logoUpload');
        const logoFile = document.getElementById('logoFile');
        
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          this.saveCompanyInfo();
        });
        
        logoUpload.addEventListener('click', () => {
          logoFile.click();
        });
        
        logoFile.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
              document.getElementById('logoPreview').innerHTML = 
                `<img src="${e.target.result}" alt="Company Logo">`;
            };
            reader.readAsDataURL(file);
          }
        });
      }
      
      populateCompanyForm() {
        document.getElementById('companyName').value = this.data.company.name || '';
        document.getElementById('companyPhone').value = this.data.company.phone || '';
        document.getElementById('companyAddress').value = this.data.company.address || '';
        document.getElementById('companyCity').value = this.data.company.city || '';
        document.getElementById('companyEmail').value = this.data.company.email || '';
        document.getElementById('companyNumber').value = this.data.company.companyNumber || '';
        document.getElementById('vatNumber').value = this.data.company.vatNumber || '';
        document.getElementById('companyBankName').value = this.data.company.bankName || '';
        document.getElementById('companyAccountName').value = this.data.company.accountName || '';
        document.getElementById('companySortCode').value = this.data.company.sortCode || '';
        document.getElementById('companyAccountNo').value = this.data.company.account || '';
        
        const logoPreview = document.getElementById('logoPreview');
        if (this.data.company.logo) {
          logoPreview.innerHTML = `<img src="${this.data.company.logo}" alt="Company Logo">`;
        } else {
          logoPreview.innerHTML = '';
        }
      }
      
      saveCompanyInfo() {
        const logoPreview = document.querySelector('#logoPreview img');
        
        this.data.company = {
          name: document.getElementById('companyName').value.trim(),
          phone: document.getElementById('companyPhone').value.trim(),
          address: document.getElementById('companyAddress').value.trim(),
          city: document.getElementById('companyCity').value.trim(),
          email: document.getElementById('companyEmail').value.trim(),
          companyNumber: document.getElementById('companyNumber').value.trim(),
          vatNumber: document.getElementById('vatNumber').value.trim(),
          bankName: document.getElementById('companyBankName').value.trim(),
          accountName: document.getElementById('companyAccountName').value.trim(),
          sortCode: document.getElementById('companySortCode').value.trim(),
          account: document.getElementById('companyAccountNo').value.trim(),
          logo: logoPreview ? logoPreview.src : this.data.company.logo
        };
        
        this.saveData();
        this.syncInvoiceFrameFromStorage();
        
        alert('✅ Company information saved successfully!');
        console.log('✅ Company information updated');
      }
      
      // ========================================
      // SAVE FUNCTIONALITY
      // ========================================
      
      initSaveFunctionality() {
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) {
          saveBtn.addEventListener('click', () => {
            this.invoiceAction('saveInvoice');
          });
        }
      }

      showSaveSuccessFeedback(documentType) {
        const saveBtn = document.getElementById('saveBtn');
        if (!saveBtn) return;
        const label = documentType === 'receipt' ? 'Receipt' : documentType === 'statement' ? 'Statement' : 'Invoice';
        const originalText = saveBtn.textContent || saveBtn.innerText || 'Save';
        saveBtn.textContent = '✓ ' + label + ' saved!';
        saveBtn.style.background = '#2e7d32';
        if (this._saveFeedbackTimer) clearTimeout(this._saveFeedbackTimer);
        this._saveFeedbackTimer = setTimeout(() => {
          saveBtn.textContent = originalText;
          saveBtn.style.background = '';
          this._saveFeedbackTimer = null;
        }, 2500);
      }
      
    }
    
    // ========================================
    // GLOBAL INSTANCE
    // ========================================
    
    window.canvasShell = new CanvasShellControls();
    /** @deprecated Prefer window.canvasShell; kept for inline onclick="app.*" and older snippets */
    window.app = window.canvasShell;
    window.enableShellCameraDebug = function enableShellCameraDebug() {
      window.canvasShell.setShellCameraDebug(true);
    };

    (function shellDebugStartupHint() {
      const shell = window.canvasShell;
      if (
        shell &&
        typeof shell.isShellCameraDebug === 'function' &&
        shell.isShellCameraDebug()
      ) {
        console.log(
          '%c[shell-camera] debug ON',
          'color:#0ae;font-weight:bold',
          '(env/URL). Verbose pinch/pan/clamp logs active.'
        );
        return;
      }
      try {
        if (sessionStorage.getItem('_shellCameraDebugHint') === '1') return;
        sessionStorage.setItem('_shellCameraDebugHint', '1');
      } catch (_) {}
      console.log(
        '[shell-camera] Verbose logs off. Enable: ?debugShell=1 | #debugShell | enableShellCameraDebug() | canvasShell.setShellCameraDebug(true)'
      );
    })();

    document.addEventListener('DOMContentLoaded', () => {
      console.log('🎉 Static Invoice System ready!');
    });
