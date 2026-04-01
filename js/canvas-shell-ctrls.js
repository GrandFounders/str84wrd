/**
 * CanvasShellControls: infinite canvas / iframe chrome, drawers, Settings, postMessage to templates.
 * @file canvas-shell-ctrls.js
 */
    // ========================================
    // ARCHITECTURE (separation of concerns)
    // ========================================
    // - js/invoice-app-catalog-storage.js: catalog localStorage (shared with templates).
    // - js/invoice-catalog-admin.js: data modal (products/clients/company/counter); shell holds data + delegates for app.*.
    // - index.html + invoice-shell-bootstrap.js + canvas-shell-ctrls.js: CanvasShellControls — canvas, drawers,
    //   mode toggle, InvoiceAppCatalogStorage + InvoiceCatalogAdmin, postMessage to #invoiceFrame.
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
        /** While true, skip clamp so finger delta isn’t fought each frame (reduces motion jitter near slack). */
        this._skipClampDuringShellTouchPan = false;

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

      /**
       * Push catalog/company/settings from the parent into #invoiceFrame.
       * Required when the iframe is a different storage partition than the shell (e.g. file:// per-document
       * origins). iframe-only syncSharedDataFromStorage + loadData() would read the wrong localStorage.
       */
      pushInvoiceCatalogToFrame() {
        const iframe = this.getInvoiceFrame();
        if (!iframe || !iframe.contentWindow) return;
        try {
          const C = window.InvoiceAppCatalogStorage;
          if (C && typeof C.loadCatalogState === 'function') {
            const catalog = C.loadCatalogState();
            iframe.contentWindow.postMessage({ type: 'apply-invoice-catalog', catalog }, '*');
          }
        } catch (e) {
          console.warn('pushInvoiceCatalogToFrame failed:', e);
        }
      }

      /** Parent wrote shared catalog/company to localStorage — refresh the iframe document. */
      syncInvoiceFrameFromStorage() {
        this.pushInvoiceCatalogToFrame();
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
            // Defer so the iframe message listener and window.app are ready; then apply shell catalog.
            setTimeout(() => {
              this.pushInvoiceCatalogToFrame();
            }, 0);
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

        let canvasOneFingerPanRaf = null;
        let pendingCanvasOneFingerPan = null;
        const cancelCanvasOneFingerPanRaf = () => {
          if (canvasOneFingerPanRaf != null) {
            cancelAnimationFrame(canvasOneFingerPanRaf);
            canvasOneFingerPanRaf = null;
          }
        };
        const applyCanvasOneFingerPanFromPending = () => {
          canvasOneFingerPanRaf = null;
          const p = pendingCanvasOneFingerPan;
          if (!p || !touchState.active) return;
          const div = this.mobilePanPixelDivisor();
          const deltaX = p.cx - touchState.oneFingerStart.x;
          const deltaY = p.cy - touchState.oneFingerStart.y;
          this._skipClampDuringShellTouchPan = true;
          this.camera.x = touchState.startCameraX + deltaX / div;
          this.camera.y = touchState.startCameraY + deltaY / div;
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
            cancelCanvasOneFingerPanRaf();
            pendingCanvasOneFingerPan = null;
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
            const t = e.touches[0];
            touchState.startCameraX = this.camera.x;
            touchState.startCameraY = this.camera.y;
            touchState.oneFingerStart = { x: t.clientX, y: t.clientY };
            canvas.classList.add('panning');
            this._skipClampDuringShellTouchPan = true;
            cancelCanvasOneFingerPanRaf();
            pendingCanvasOneFingerPan = null;
            this.resetTouchPanInertiaTracking(t.clientX, t.clientY);
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
            const t = e.touches[0];
            const d = touchState.touches.get(t.identifier);
            if (d) {
              pendingCanvasOneFingerPan = { cx: t.clientX, cy: t.clientY, id: t.identifier };
              const div = this.mobilePanPixelDivisor();
              this.touchPanInertiaSampleFromMove(t.clientX, t.clientY, div);
              if (canvasOneFingerPanRaf == null) {
                canvasOneFingerPanRaf = requestAnimationFrame(applyCanvasOneFingerPanFromPending);
              }
            }
          } else if (e.touches.length === 2) {
            cancelCanvasOneFingerPanRaf();
            pendingCanvasOneFingerPan = null;
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
          cancelCanvasOneFingerPanRaf();
          if (wasOneFingerPan && e.changedTouches.length > 0) {
            const ch = e.changedTouches[0];
            const div = this.mobilePanPixelDivisor();
            const deltaX = ch.clientX - touchState.oneFingerStart.x;
            const deltaY = ch.clientY - touchState.oneFingerStart.y;
            this._skipClampDuringShellTouchPan = true;
            this.camera.x = touchState.startCameraX + deltaX / div;
            this.camera.y = touchState.startCameraY + deltaY / div;
            this.touchPanInertiaSampleFromMove(ch.clientX, ch.clientY, div);
            this.updateCanvasTransform();
          }
          pendingCanvasOneFingerPan = null;
          for (const touch of e.changedTouches) {
            touchState.touches.delete(touch.identifier);
          }
          if (e.touches.length === 0) {
            touchState.active = false;
            touchState.lastPinchDistance = 0;
            canvas.classList.remove('panning');
            this.setWorkspacePinchActive(false);
            this.setWorkspaceGestureActive(false);
            this._skipClampDuringShellTouchPan = false;
            if (wasOneFingerPan) {
              this.kickTouchPanInertiaIfFastEnough();
            }
            this._touchPanInertPrev = null;
            this.updateCanvasTransform();
          }
          if (e.touches.length === 1) {
            const t = e.touches[0];
            touchState.startCameraX = this.camera.x;
            touchState.startCameraY = this.camera.y;
            touchState.oneFingerStart = { x: t.clientX, y: t.clientY };
            touchState.lastPinchDistance = 0;
            this.setWorkspacePinchActive(false);
            this._skipClampDuringShellTouchPan = true;
            this.resetTouchPanInertiaTracking(t.clientX, t.clientY);
          }
        }, passiveFalse);

        canvas.addEventListener('touchcancel', (e) => {
          shellPreventDefaultIfCancelable(e);
          cancelCanvasOneFingerPanRaf();
          pendingCanvasOneFingerPan = null;
          touchState.active = false;
          touchState.touches.clear();
          touchState.lastPinchDistance = 0;
          canvas.classList.remove('panning');
          this.setWorkspacePinchActive(false);
          this.setWorkspaceGestureActive(false);
          this._skipClampDuringShellTouchPan = false;
          this.abortTouchPanInertiaSampling();
          this.updateCanvasTransform();
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
       * Same-origin iframe: wheel/keyboard to shell; two-finger pinch; one-finger / primary-button drag on
       * non-interactive areas pans the shell camera (whitespace / margins — not table cells or inputs).
       */
      attachSubdocumentZoomToShellCamera(iframe) {
        if (!iframe || !iframe.contentWindow) return;
        try {
          const doc = iframe.contentWindow.document;
          if (!doc || !doc.documentElement) return;
          if (!this._subdocZoomHooked) this._subdocZoomHooked = new WeakSet();
          if (this._subdocZoomHooked.has(doc)) return;
          this._subdocZoomHooked.add(doc);

          const isParentDrawModeActive = () => {
            try {
              return !!(iframe.contentWindow.parent && iframe.contentWindow.parent._drawModeActive);
            } catch (_) {
              return false;
            }
          };
          /** Draw layer while parent draw mode on: shell pan only after press-and-hold (see drawModeIframeHold). */
          const isDrawLayerDeferShellPan = (el) => {
            if (!el || typeof el.closest !== 'function') return false;
            return !!el.closest('#draw-layer') && isParentDrawModeActive();
          };
          const allowIframeShellPanTarget = (el) => {
            if (!el || typeof el.closest !== 'function') return false;
            if (el.closest('input, textarea, select, button, a[href], label')) return false;
            if (el.closest('[contenteditable]:not([contenteditable="false"])')) return false;
            if (el.closest('.items-table tbody')) return false;
            const shellGraphicRoot = el.closest('.overlay-image, .page-overlay-wrapper');
            if (shellGraphicRoot) {
              if (shellGraphicRoot.classList.contains('locked')) {
                return true;
              }
              return false;
            }
            if (isDrawLayerDeferShellPan(el)) return false;
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
            /** Draw-mode draw-layer blocks pointer pan (hold-to-pan) but trackpad swipe is not inking—allow shell pan. */
            if (!allowIframeShellPanTarget(e.target) && !isDrawLayerDeferShellPan(e.target)) return;
            this.applyTrackpadCanvasGesture(e);
          };
          const pinch = { lastSpan: 0, deferredToGraphic: false };
          const pan = {
            active: false,
            startX: 0,
            startY: 0,
            camX: 0,
            camY: 0,
            /** Locked at gesture start so pan speed does not flicker if zoom/divisor shifts mid-drag. */
            panDivLocked: null,
            /** Last move position/time for release-only flick sampling (not updated on pointer up). */
            lastMoveCx: 0,
            lastMoveCy: 0,
            lastMoveT: null
          };
          const iframePanNow = () =>
            typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
          const DRAW_MODE_IFRAME_PAN_HOLD_MS = 420;
          const DRAW_MODE_IFRAME_PAN_HOLD_SLOP_PX = 14;
          /** Touch: wait for hold on draw layer before shell pan; cleared on slop or release. */
          let drawModeIframeHold = null;
          /** True if draw-layer was paused for shell pan (hold path); resume when pan ends. */
          let iframeShellPanPausedDrawForHold = false;
          let drawModeMouseHoldCleanup = null;
          /** After a 2-finger pinch, the lifted finger leaves one active touch with no new touchstart — arm pan on first move. */
          let iframePanArmAfterPinchRelease = false;
          /** Remove iframe + top window mouse listeners for shell pan. */
          let iframeMouseShellPanCleanup = null;
          /** True between iframe primary-down and matching mouseup (touch can preempt mid-drag). */
          let iframeMouseShellPanDragging = false;
          const removeIframeMouseShellListeners = () => {
            if (typeof iframeMouseShellPanCleanup !== 'function') return;
            iframeMouseShellPanCleanup();
            iframeMouseShellPanCleanup = null;
          };
          /** Drop mouse listeners; if a mouse drag was in progress, reset shell pan state (e.g. touch preempted). */
          const resumeDrawLayerAfterShellHoldPan = () => {
            if (!iframeShellPanPausedDrawForHold) return;
            iframeShellPanPausedDrawForHold = false;
            const w = iframe.contentWindow;
            if (w && typeof w.setDrawPausedForShellPan === 'function') {
              w.setDrawPausedForShellPan(false);
            }
          };
          const removeDrawModeMouseHoldListeners = () => {
            if (typeof drawModeMouseHoldCleanup !== 'function') return;
            drawModeMouseHoldCleanup();
            drawModeMouseHoldCleanup = null;
          };
          const teardownIframeMouseShellPan = () => {
            removeDrawModeMouseHoldListeners();
            removeIframeMouseShellListeners();
            drawModeIframeHold = null;
            if (!iframeMouseShellPanDragging) return;
            iframeMouseShellPanDragging = false;
            pendingIframeOneFingerPan = null;
            pan.active = false;
            pan.panDivLocked = null;
            resumeDrawLayerAfterShellHoldPan();
            const sh = parentShell();
            if (sh) {
              sh._skipClampDuringShellTouchPan = false;
              if (typeof sh.updateCanvasTransform === 'function') sh.updateCanvasTransform();
              if (typeof sh.abortTouchPanInertiaSampling === 'function') sh.abortTouchPanInertiaSampling();
              if (typeof sh.setWorkspaceGestureActive === 'function') sh.setWorkspaceGestureActive(false);
            }
          };
          /** True while the iframe 2-finger gesture is driving the shell (not deferred to overlay graphic). */
          let iframePinchWentToShell = false;
          let pendingIframeOneFingerPan = null;
          const resolveIframePanDivisor = (shell) => {
            if (
              pan.panDivLocked != null &&
              Number.isFinite(pan.panDivLocked) &&
              pan.panDivLocked > 0
            ) {
              return pan.panDivLocked;
            }
            return typeof shell.mobilePanPixelDivisor === 'function'
              ? shell.mobilePanPixelDivisor()
              : Math.max(1, shell.camera.zoom || 1);
          };
          const flushIframeOneFingerPan = () => {
            const shell = parentShell();
            const p = pendingIframeOneFingerPan;
            if (!shell || !shell.camera || !p || !pan.active) return;
            if (typeof shell.stopShellPanMomentum === 'function') {
              shell.stopShellPanMomentum();
            }
            const panDiv = resolveIframePanDivisor(shell);
            shell._skipClampDuringShellTouchPan = true;
            shell.camera.x = pan.camX + (p.cx - pan.startX) / panDiv;
            shell.camera.y = pan.camY + (p.cy - pan.startY) / panDiv;
            shell.updateCanvasTransform();
            if (shell.isShellCameraDebug && shell.isShellCameraDebug()) {
              shell.logShellCameraThrottled('pan-iframe', 200, 'shell pan (iframe)', {
                panDiv,
                delta: { x: p.cx - pan.startX, y: p.cy - pan.startY },
                camera: { x: shell.camera.x, y: shell.camera.y, zoom: shell.camera.zoom }
              });
            }
          };
          const parentShell = () =>
            iframe.contentWindow.parent &&
            (iframe.contentWindow.parent.canvasShell || iframe.contentWindow.parent.app);

          const tryCommitDrawModeHoldPanTouch = (e, t) => {
            const h = drawModeIframeHold;
            if (!h || pan.active || !t) return false;
            const dx = t.clientX - h.startX;
            const dy = t.clientY - h.startY;
            if (Math.hypot(dx, dy) > DRAW_MODE_IFRAME_PAN_HOLD_SLOP_PX) {
              drawModeIframeHold = null;
              return false;
            }
            if (iframePanNow() - h.startT < DRAW_MODE_IFRAME_PAN_HOLD_MS) return false;
            const ox = h.startX;
            const oy = h.startY;
            drawModeIframeHold = null;
            const w = iframe.contentWindow;
            if (w && typeof w.abortStrokeInProgress === 'function') w.abortStrokeInProgress();
            if (w && typeof w.setDrawPausedForShellPan === 'function') w.setDrawPausedForShellPan(true);
            iframeShellPanPausedDrawForHold = true;
            const shell = parentShell();
            if (!shell || !shell.camera) {
              resumeDrawLayerAfterShellHoldPan();
              return false;
            }
            pan.active = true;
            pan.startX = ox;
            pan.startY = oy;
            pan.camX = shell.camera.x;
            pan.camY = shell.camera.y;
            pan.panDivLocked =
              typeof shell.mobilePanPixelDivisor === 'function'
                ? shell.mobilePanPixelDivisor()
                : Math.max(1, shell.camera.zoom || 1);
            shell._skipClampDuringShellTouchPan = true;
            if (typeof shell.resetTouchPanInertiaTracking === 'function') {
              shell.resetTouchPanInertiaTracking(ox, oy);
            }
            pan.lastMoveCx = t.clientX;
            pan.lastMoveCy = t.clientY;
            pan.lastMoveT = iframePanNow();
            pendingIframeOneFingerPan = { cx: t.clientX, cy: t.clientY };
            flushIframeOneFingerPan();
            shellPreventDefaultIfCancelable(e);
            return true;
          };

          const attachIframeMouseShellPanListeners = (shell) => {
            if (typeof shell.setWorkspaceGestureActive === 'function') {
              shell.setWorkspaceGestureActive(true);
            }
            const winIframe = iframe.contentWindow;
            const winTop = window;
            const onMouseMove = (ev) => {
              if (!pan.active) return;
              shellPreventDefaultIfCancelable(ev);
              const sh = parentShell();
              if (!sh || !sh.camera) return;
              pendingIframeOneFingerPan = { cx: ev.clientX, cy: ev.clientY };
              flushIframeOneFingerPan();
              pan.lastMoveCx = ev.clientX;
              pan.lastMoveCy = ev.clientY;
              pan.lastMoveT = iframePanNow();
            };
            const onMouseUp = (ev) => {
              if (ev.button !== 0) return;
              if (iframeMouseShellPanCleanup == null) return;
              const sh = parentShell();
              const hadPan = pan.active;
              if (hadPan) {
                pendingIframeOneFingerPan = { cx: ev.clientX, cy: ev.clientY };
                flushIframeOneFingerPan();
              }
              pendingIframeOneFingerPan = null;
              pan.active = false;
              pan.panDivLocked = null;
              resumeDrawLayerAfterShellHoldPan();
              if (sh) {
                sh._skipClampDuringShellTouchPan = false;
                if (typeof sh.updateCanvasTransform === 'function') sh.updateCanvasTransform();
              }
              if (hadPan && sh && typeof sh.setWorkspaceGestureActive === 'function') {
                sh.setWorkspaceGestureActive(false);
              }
              if (hadPan && sh && typeof sh.abortTouchPanInertiaSampling === 'function') {
                sh.abortTouchPanInertiaSampling();
              }
              iframeMouseShellPanDragging = false;
              removeIframeMouseShellListeners();
            };
            iframeMouseShellPanCleanup = () => {
              winIframe.removeEventListener('mousemove', onMouseMove, cap);
              winIframe.removeEventListener('mouseup', onMouseUp, cap);
              winTop.removeEventListener('mousemove', onMouseMove, cap);
              winTop.removeEventListener('mouseup', onMouseUp, cap);
            };
            winIframe.addEventListener('mousemove', onMouseMove, cap);
            winIframe.addEventListener('mouseup', onMouseUp, cap);
            winTop.addEventListener('mousemove', onMouseMove, cap);
            winTop.addEventListener('mouseup', onMouseUp, cap);
          };

          const beginIframeMouseShellPan = (shell, startClientX, startClientY, curClientX, curClientY, sourceEvent) => {
            if (sourceEvent) shellPreventDefaultIfCancelable(sourceEvent);
            shell.stopShellPanMomentum();
            teardownIframeMouseShellPan();
            iframeMouseShellPanDragging = true;
            pan.active = true;
            pan.startX = startClientX;
            pan.startY = startClientY;
            pan.camX = shell.camera.x;
            pan.camY = shell.camera.y;
            pan.panDivLocked =
              typeof shell.mobilePanPixelDivisor === 'function'
                ? shell.mobilePanPixelDivisor()
                : Math.max(1, shell.camera.zoom || 1);
            shell._skipClampDuringShellTouchPan = true;
            if (typeof shell.resetTouchPanInertiaTracking === 'function') {
              shell.resetTouchPanInertiaTracking(startClientX, startClientY);
            }
            pan.lastMoveCx = curClientX;
            pan.lastMoveCy = curClientY;
            pan.lastMoveT = iframePanNow();
            pendingIframeOneFingerPan = { cx: curClientX, cy: curClientY };
            flushIframeOneFingerPan();
            attachIframeMouseShellPanListeners(shell);
          };

          const startDrawModeMouseHold = (downEvent) => {
            removeDrawModeMouseHoldListeners();
            const winIframe = iframe.contentWindow;
            const winTop = window;
            const holdState = {
              startT: iframePanNow(),
              startX: downEvent.clientX,
              startY: downEvent.clientY,
              active: true
            };
            const finishHoldWithoutPan = () => {
              holdState.active = false;
              removeDrawModeMouseHoldListeners();
            };
            const onHoldMouseMove = (ev) => {
              if (!holdState.active || pan.active) return;
              const dx = ev.clientX - holdState.startX;
              const dy = ev.clientY - holdState.startY;
              if (Math.hypot(dx, dy) > DRAW_MODE_IFRAME_PAN_HOLD_SLOP_PX) {
                finishHoldWithoutPan();
                return;
              }
              if (iframePanNow() - holdState.startT < DRAW_MODE_IFRAME_PAN_HOLD_MS) return;
              holdState.active = false;
              removeDrawModeMouseHoldListeners();
              const shell = parentShell();
              if (!shell || !shell.camera) {
                resumeDrawLayerAfterShellHoldPan();
                return;
              }
              const ox = holdState.startX;
              const oy = holdState.startY;
              const w = iframe.contentWindow;
              if (w && typeof w.abortStrokeInProgress === 'function') w.abortStrokeInProgress();
              if (w && typeof w.setDrawPausedForShellPan === 'function') w.setDrawPausedForShellPan(true);
              iframeShellPanPausedDrawForHold = true;
              beginIframeMouseShellPan(shell, ox, oy, ev.clientX, ev.clientY, ev);
            };
            const onHoldMouseUp = (ev) => {
              if (ev.button !== 0) return;
              if (!holdState.active) return;
              finishHoldWithoutPan();
            };
            drawModeMouseHoldCleanup = () => {
              holdState.active = false;
              winIframe.removeEventListener('mousemove', onHoldMouseMove, cap);
              winIframe.removeEventListener('mouseup', onHoldMouseUp, cap);
              winTop.removeEventListener('mousemove', onHoldMouseMove, cap);
              winTop.removeEventListener('mouseup', onHoldMouseUp, cap);
            };
            winIframe.addEventListener('mousemove', onHoldMouseMove, cap);
            winIframe.addEventListener('mouseup', onHoldMouseUp, cap);
            winTop.addEventListener('mousemove', onHoldMouseMove, cap);
            winTop.addEventListener('mouseup', onHoldMouseUp, cap);
          };

          const clearPinch = (e) => {
            if (!e.touches || e.touches.length < 2) {
              if (e.touches && e.touches.length === 1 && iframePinchWentToShell) {
                iframePanArmAfterPinchRelease = true;
              }
              iframePinchWentToShell = false;
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
              iframePanArmAfterPinchRelease = false;
              teardownIframeMouseShellPan();
              const shellGesture = parentShell();
              if (shellGesture && typeof shellGesture.setWorkspaceGestureActive === 'function') {
                shellGesture.setWorkspaceGestureActive(true);
              }
              if (e.touches.length === 2) {
                drawModeIframeHold = null;
                pendingIframeOneFingerPan = null;
                pan.active = false;
                pan.panDivLocked = null;
                const shell2 = parentShell();
                if (shell2 && typeof shell2.abortTouchPanInertiaSampling === 'function') {
                  shell2.abortTouchPanInertiaSampling();
                }
                if (shouldDeferPinchToSelectedGraphic(e)) {
                  pinch.deferredToGraphic = true;
                  iframePinchWentToShell = false;
                  pinch.lastSpan = 0;
                  return;
                }
                pinch.deferredToGraphic = false;
                iframePinchWentToShell = true;
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
                const t0 = e.touches[0];
                if (allowIframeShellPanTarget(t)) {
                  drawModeIframeHold = null;
                  pan.active = true;
                  pan.startX = t0.clientX;
                  pan.startY = t0.clientY;
                  const shell = parentShell();
                  if (shell && shell.camera) {
                    pan.camX = shell.camera.x;
                    pan.camY = shell.camera.y;
                    pan.panDivLocked =
                      typeof shell.mobilePanPixelDivisor === 'function'
                        ? shell.mobilePanPixelDivisor()
                        : Math.max(1, shell.camera.zoom || 1);
                    shell._skipClampDuringShellTouchPan = true;
                    if (typeof shell.resetTouchPanInertiaTracking === 'function') {
                      shell.resetTouchPanInertiaTracking(pan.startX, pan.startY);
                    }
                    pan.lastMoveCx = pan.startX;
                    pan.lastMoveCy = pan.startY;
                    pan.lastMoveT = iframePanNow();
                  } else {
                    pan.active = false;
                    pan.panDivLocked = null;
                  }
                } else {
                  pan.active = false;
                  pan.panDivLocked = null;
                  if (isDrawLayerDeferShellPan(t)) {
                    drawModeIframeHold = {
                      startT: iframePanNow(),
                      startX: t0.clientX,
                      startY: t0.clientY
                    };
                  } else {
                    drawModeIframeHold = null;
                  }
                }
              }
            },
            cap
          );
          doc.addEventListener(
            'mousedown',
            (e) => {
              if (e.button !== 0) return;
              if (pan.active) return;
              if (!allowIframeShellPanTarget(e.target)) {
                if (isDrawLayerDeferShellPan(e.target)) startDrawModeMouseHold(e);
                return;
              }
              const shell = parentShell();
              if (!shell || !shell.camera) return;
              beginIframeMouseShellPan(shell, e.clientX, e.clientY, e.clientX, e.clientY, e);
            },
            cap
          );
          doc.addEventListener(
            'touchmove',
            (e) => {
              if (e.touches.length === 2) {
                pendingIframeOneFingerPan = null;
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
                  /** clientX/Y are already in the parent viewport — same as canvas pinch handlers. */
                  shell.applyPinchGestureStep(scale, cx, cy);
                }
                pinch.lastSpan = span;
                return;
              }
              if (e.touches.length === 1) {
                const t = e.touches[0];
                if (drawModeIframeHold && !pan.active) {
                  tryCommitDrawModeHoldPanTouch(e, t);
                }
                const shellArm = parentShell();
                if (
                  !pan.active &&
                  iframePanArmAfterPinchRelease &&
                  allowIframeShellPanTarget(e.target) &&
                  shellArm &&
                  shellArm.camera
                ) {
                  iframePanArmAfterPinchRelease = false;
                  pan.active = true;
                  pan.startX = t.clientX;
                  pan.startY = t.clientY;
                  pan.camX = shellArm.camera.x;
                  pan.camY = shellArm.camera.y;
                  pan.panDivLocked =
                    typeof shellArm.mobilePanPixelDivisor === 'function'
                      ? shellArm.mobilePanPixelDivisor()
                      : Math.max(1, shellArm.camera.zoom || 1);
                  shellArm._skipClampDuringShellTouchPan = true;
                  if (typeof shellArm.resetTouchPanInertiaTracking === 'function') {
                    shellArm.resetTouchPanInertiaTracking(pan.startX, pan.startY);
                  }
                  pan.lastMoveCx = pan.startX;
                  pan.lastMoveCy = pan.startY;
                  pan.lastMoveT = iframePanNow();
                }
              }
              if (e.touches.length === 1 && pan.active) {
                shellPreventDefaultIfCancelable(e);
                const shell = parentShell();
                const t = e.touches[0];
                if (shell && shell.camera) {
                  pendingIframeOneFingerPan = { cx: t.clientX, cy: t.clientY };
                  flushIframeOneFingerPan();
                  pan.lastMoveCx = t.clientX;
                  pan.lastMoveCy = t.clientY;
                  pan.lastMoveT = iframePanNow();
                }
              }
            },
            cap
          );
          const onTouchEndOrCancel = (e) => {
            if (!e.touches || e.touches.length === 0) {
              drawModeIframeHold = null;
            }
            const hadShellPan = pan.active;
            if (
              hadShellPan &&
              pan.active &&
              (!e.touches || e.touches.length === 0) &&
              e.changedTouches &&
              e.changedTouches.length > 0
            ) {
              const ch = e.changedTouches[0];
              pendingIframeOneFingerPan = { cx: ch.clientX, cy: ch.clientY };
              flushIframeOneFingerPan();
            }
            pendingIframeOneFingerPan = null;
            clearPinch(e);
            if (!e.touches || e.touches.length === 0) {
              iframePanArmAfterPinchRelease = false;
              pan.active = false;
              pan.panDivLocked = null;
              resumeDrawLayerAfterShellHoldPan();
              const sh = parentShell();
              if (sh) {
                sh._skipClampDuringShellTouchPan = false;
                if (typeof sh.updateCanvasTransform === 'function') {
                  sh.updateCanvasTransform();
                }
              }
              if (sh && typeof sh.setWorkspaceGestureActive === 'function') {
                sh.setWorkspaceGestureActive(false);
              }
              if (hadShellPan && sh && typeof sh.abortTouchPanInertiaSampling === 'function') {
                sh.abortTouchPanInertiaSampling();
              }
            }
          };
          doc.addEventListener('touchend', onTouchEndOrCancel, cap);
          doc.addEventListener('touchcancel', (e) => {
            pendingIframeOneFingerPan = null;
            drawModeIframeHold = null;
            teardownIframeMouseShellPan();
            clearPinch(e);
            iframePanArmAfterPinchRelease = false;
            pan.active = false;
            pan.panDivLocked = null;
            resumeDrawLayerAfterShellHoldPan();
            const sh = parentShell();
            if (sh) {
              sh._skipClampDuringShellTouchPan = false;
              if (typeof sh.updateCanvasTransform === 'function') {
                sh.updateCanvasTransform();
              }
            }
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

      /**
       * Flick sample on pointer up: velocity from last drag point → release only (not averaged over the stroke).
       * Call after synchronous pan flush; avoids EMA churn during drag and pairs with immediate pan updates.
       */
      sampleTouchPanInertiaForRelease(lastCx, lastCy, lastT, endCx, endCy, panDiv) {
        if (!Number.isFinite(endCx) || !Number.isFinite(endCy)) return;
        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        if (
          lastT == null ||
          !Number.isFinite(lastCx) ||
          !Number.isFinite(lastCy) ||
          !Number.isFinite(lastT)
        ) {
          this._touchPanInertPrev = { x: endCx, y: endCy, t: now };
          if (!this._touchPanInertEma) this._touchPanInertEma = { vx: 0, vy: 0 };
          this._touchPanInertEma.vx = 0;
          this._touchPanInertEma.vy = 0;
          return;
        }
        this._touchPanInertPrev = { x: lastCx, y: lastCy, t: lastT };
        this.touchPanInertiaSampleFromMove(endCx, endCy, panDiv);
      }

      /** Samples touch velocity for **flick on release only** — does not move the camera during drag. */
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
        const z = Math.max(0.15, Math.min(5, this.camera.zoom || 1));
        const inertiaZoom = z < 1 ? Math.max(0.22, z * z) : 1;
        this._shellPanMomentumVel.vx += e.vx * boost * inertiaZoom;
        this._shellPanMomentumVel.vy += e.vy * boost * inertiaZoom;
        this._touchPanInertEma.vx = 0;
        this._touchPanInertEma.vy = 0;
        this._touchPanInertPrev = null;
        this.ensureShellPanMomentumRaf();
      }

      /** Trackpad cardinal swipe: extra coast so rapid two-finger scrolls match OS-like inertia. */
      impulseShellPanMomentumTrackpad(panX, panY) {
        if (this._skipClampDuringShellTouchPan) return;
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
        if (this._skipClampDuringShellTouchPan) {
          this.stopShellPanMomentum();
          return;
        }
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
       * One-finger **touch** pan sensitivity vs shell zoom `z`.
       * Pan uses `translate(px) scale(z)` — translation is in **parent CSS pixels**, so the same camera delta moves
       * the overlay the same distance on screen at every zoom. When zoomed out the invoice is tiny, so 1:1 finger→camera
       * px feels like the page “flies off”; we scale the divisor up as `baseline / z` so each finger pixel moves the
       * camera **less** when `z` is small.
       * **Above 100%:** sub-linear `pow(z,·)` softens integer touch steps vs raw divisor=z.
       */
      mobilePanPixelDivisor() {
        const z = Math.max(0.1, Math.min(5, this.camera.zoom || 1));
        const baseline = 1.08;
        const zoomInGamma = 0.78;
        if (z <= 1) {
          return baseline / z;
        }
        return Math.max(baseline, Math.pow(z, zoomInGamma));
      }

      /** Keep pan from drifting arbitrarily far on mobile (reduces “flies off screen”). */
      clampCameraBounds() {
        if (this._skipClampDuringShellTouchPan) return;
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
        const v = this._shellPanMomentumVel;
        if (v && this._shellPanMomentumRaf != null) {
          const eps = 0.5;
          if (this.camera.x <= -maxX + eps && v.vx < 0) v.vx = 0;
          if (this.camera.x >= maxX - eps && v.vx > 0) v.vx = 0;
          if (this.camera.y <= -maxY + eps && v.vy < 0) v.vy = 0;
          if (this.camera.y >= maxY - eps && v.vy > 0) v.vy = 0;
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
        console.log('🔍 Camera reset — reframing invoice (same as Center View at 100%)');
        this.centerIframeInViewport();
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
          const C = window.InvoiceAppCatalogStorage;
          if (!C || typeof C.loadCatalogState !== 'function') {
            throw new Error('InvoiceAppCatalogStorage missing (load invoice-app-catalog-storage.js before canvas-shell-ctrls.js)');
          }
          const loaded = C.loadCatalogState();
          this.data.products = loaded.products;
          this.data.clients = loaded.clients;
          this.data.company = loaded.company;
          this.data.settings = loaded.settings;
          console.log('📁 Data loaded from localStorage');
        } catch (error) {
          console.error('Error loading data:', error);
          const C = window.InvoiceAppCatalogStorage;
          if (C) {
            this.data = {
              products: C.getDefaultProducts(),
              clients: C.getDefaultClients(),
              company: C.getDefaultCompany(),
              settings: C.getDefaultSettings()
            };
          }
        }
      }
      
      saveData() {
        try {
          const C = window.InvoiceAppCatalogStorage;
          if (C && typeof C.saveCatalogState === 'function') {
            C.saveCatalogState(this.data);
          }
          console.log('💾 Data saved to localStorage');
        } catch (error) {
          console.error('Error saving data:', error);
        }
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
      // CATALOG DATA MODAL (implementation: js/invoice-catalog-admin.js)
      // ========================================
      
      initDataManagement() {
        if (typeof window.InvoiceCatalogAdmin !== 'function') {
          console.warn('InvoiceCatalogAdmin missing — load js/invoice-catalog-admin.js before canvas-shell-ctrls.js');
          return;
        }
        this._catalogAdmin = new window.InvoiceCatalogAdmin(this);
        this._catalogAdmin.init();
      }
      
      /** Delegates for inline onclick="app.*" inside the data modal */
      showDataManagement() {
        return this._catalogAdmin && this._catalogAdmin.showDataManagement();
      }
      switchTab(tabId) {
        return this._catalogAdmin && this._catalogAdmin.switchTab(tabId);
      }
      populateDataModal() {
        return this._catalogAdmin && this._catalogAdmin.populateDataModal();
      }
      refreshCounterControl() {
        return this._catalogAdmin && this._catalogAdmin.refreshCounterControl();
      }
      showProductForm(product) {
        return this._catalogAdmin && this._catalogAdmin.showProductForm(product);
      }
      saveProduct(editId) {
        return this._catalogAdmin && this._catalogAdmin.saveProduct(editId);
      }
      deleteProduct(id) {
        return this._catalogAdmin && this._catalogAdmin.deleteProduct(id);
      }
      populateProductsList() {
        return this._catalogAdmin && this._catalogAdmin.populateProductsList();
      }
      showClientForm(clientData) {
        return this._catalogAdmin && this._catalogAdmin.showClientForm(clientData);
      }
      saveClient(editId) {
        return this._catalogAdmin && this._catalogAdmin.saveClient(editId);
      }
      deleteClient(id) {
        return this._catalogAdmin && this._catalogAdmin.deleteClient(id);
      }
      populateClientsList() {
        return this._catalogAdmin && this._catalogAdmin.populateClientsList();
      }
      populateCompanyForm() {
        return this._catalogAdmin && this._catalogAdmin.populateCompanyForm();
      }
      saveCompanyInfo() {
        return this._catalogAdmin && this._catalogAdmin.saveCompanyInfo();
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
