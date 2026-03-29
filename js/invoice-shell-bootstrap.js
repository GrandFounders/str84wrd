/**
 * Shell bootstrap: sidebar, receipt/statement modals, postMessage, category shortcuts, page overlays.
 * Requires: global-storage.js, invoice-app-catalog-storage.js, invoice-catalog-admin.js before deferred shell scripts.
 * @file invoice-shell-bootstrap.js
 */
    function handleSidebarIframeLoad(iframe) {
      if (iframe && iframe.classList) iframe.classList.add('loaded');
    }
    function handleSidebarIframeError(iframe) {
      if (!iframe || !iframe.parentElement) return;
      iframe.style.display = 'none';
      var err = document.createElement('div');
      err.className = 'iframe-error';
      err.innerHTML = '<p>Menu could not be loaded.</p>';
      iframe.parentElement.appendChild(err);
    }
    function closeSidebarDrawer() {
      var t = document.getElementById('zoomToggle');
      var d = document.getElementById('mobileDrawer');
      var o = document.getElementById('mobileOverlay');
      if (t) t.classList.remove('open');
      if (d) d.classList.remove('open');
      if (o) o.classList.remove('open');
      document.body.style.overflow = '';
    }

    // Sidebar invoke: one place for New Invoice, New Receipt, Statement, Load Invoice/Receipt/Statement, Setup, Save, Send
    function handleSidebarInvoke(id) {
      var iframe = document.getElementById('invoiceFrame');
      if (!iframe) return;
      function sendNewInvoice() {
        if (window.canvasShell && window.canvasShell.invoiceAction) window.canvasShell.invoiceAction('newInvoice');
      }
      function sendShowList() {
        if (window.canvasShell && window.canvasShell.invoiceAction) window.canvasShell.invoiceAction('showInvoiceList');
      }
      function switchAndSend(templatePath, afterLoad, forceReload) {
        var src = (iframe.src || '').replace(/#.*/, '');
        var needsReload = !src.endsWith(templatePath) || forceReload;
        if (needsReload) {
          var once = function() {
            iframe.removeEventListener('load', once);
            if (afterLoad) afterLoad();
          };
          iframe.addEventListener('load', once);
          iframe.src = 'templates/' + templatePath + (forceReload && src.endsWith(templatePath) ? '?t=' + Date.now() : '');
        } else if (afterLoad) {
          afterLoad();
        }
      }
      switch (id) {
        case 'newInvoiceBtn':
          switchAndSend('invoice.html', function() {
            setTimeout(sendNewInvoice, 100);
          }, true);
          break;
        case 'newReceiptBtn':
          showReceiptInvoiceListModal();
          break;
        case 'exportBtn':
          showStatementInvoiceListModal();
          break;
        case 'newSummaryBtn':
          switchAndSend('Summary.html', function() {}, true);
          break;
        case 'newOrderListBtn':
          switchAndSend('Orders.html', function() {}, true);
          break;
        case 'newDocumentBtn':
          switchAndSend('blankDoc.html', function() {}, true);
          break;
        case 'loadInvoiceBtnEdit':
          switchAndSend('invoice.html', sendShowList);
          break;
        case 'loadReceiptBtnEdit':
          switchAndSend('Receipt.html', function() {});
          break;
        case 'loadStatementBtnEdit':
          switchAndSend('statement.html', sendShowList);
          break;
        case 'newTransactionsBtn':
          switchAndSend('Transactions.html', function() {}, true);
          break;
        case 'dataManagementBtn':
          var btn = document.getElementById('dataManagementBtn');
          if (btn) btn.click();
          break;
        case 'saveBtn':
          if (window.canvasShell && window.canvasShell.invoiceAction) window.canvasShell.invoiceAction('saveInvoice');
          break;
        case 'sendBtn':
          if (window.canvasShell && window.canvasShell.invoiceAction) window.canvasShell.invoiceAction('sendInvoice');
          break;
        default:
          var fallback = document.getElementById(id);
          if (fallback) fallback.click();
      }
    }

    function showReceiptInvoiceListModal() {
      var modal = document.getElementById('receiptInvoiceListModal');
      if (modal) {
        var zoomOverlay = document.getElementById('zoomOverlay');
        var zoomDrawer = document.getElementById('zoomDrawer');
        if (zoomOverlay) zoomOverlay.classList.remove('open');
        if (zoomDrawer) zoomDrawer.classList.remove('open');
        modal.classList.add('show');
        renderReceiptInvoiceList();
        var searchInput = document.getElementById('receiptInvoiceSearchInput');
        if (searchInput) searchInput.value = '';
        setTimeout(function() { if (searchInput) searchInput.focus(); }, 100);
      }
    }

    function hideReceiptInvoiceListModal() {
      var modal = document.getElementById('receiptInvoiceListModal');
      if (modal) modal.classList.remove('show');
    }

    function renderReceiptInvoiceList(query) {
      var list = typeof GlobalStorage !== 'undefined' ? GlobalStorage.getAllSavedInvoices() : [];
      if (query && typeof query === 'string' && query.trim()) {
        list = typeof GlobalStorage !== 'undefined' ? GlobalStorage.searchSavedInvoices(query) : list;
      }
      list.sort(function(a, b) {
        var dateA = new Date(a.archivedAt || a.createdAt || a.lastSaved || 0);
        var dateB = new Date(b.archivedAt || b.createdAt || b.lastSaved || 0);
        return dateB - dateA;
      });
      var countEl = document.getElementById('receiptInvoiceCount');
      var container = document.getElementById('receiptInvoiceListContainer');
      var emptyState = document.getElementById('receiptInvoiceEmptyState');
      if (countEl) countEl.textContent = list.length;
      if (!container) return;
      container.innerHTML = '';
      if (list.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        return;
      }
      if (emptyState) emptyState.style.display = 'none';
      list.forEach(function(inv) {
        var card = document.createElement('div');
        card.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa;';
        var archiveDate = inv.archivedAt ? new Date(inv.archivedAt).toLocaleDateString() : 'N/A';
        var docLabel = (inv.documentType === 'receipt') ? 'Receipt' : (inv.documentType === 'statement') ? 'Statement' : 'Invoice';
        var docNo = inv.invoiceNo || inv.statementNo || inv.receiptNo || 'N/A';
        card.innerHTML =
          '<div style="flex: 1;">' +
          '<div style="font-weight: bold; font-size: 16px; color: #333; margin-bottom: 4px;">' + docLabel + ' #' + docNo + '</div>' +
          '<div style="color: #666; font-size: 14px;">' + (inv.customerName || 'No customer') + (inv.customerEmail ? ' · ' + inv.customerEmail : '') + '</div>' +
          '<div style="color: #999; font-size: 12px; margin-top: 4px;">Archived: ' + archiveDate + '</div>' +
          '</div>' +
          '<div style="text-align: right; display: flex; align-items: center; gap: 10px;">' +
          '<div style="font-weight: bold; font-size: 18px; color: #333; margin-right: 15px;">' + (inv.total || inv.closingBalance || inv.outstanding || '£0.00') + '</div>' +
          '<button type="button" class="receipt-create-btn always-enabled" data-invoice-id="' + (inv.id || '') + '" style="padding: 8px 16px; background: #926E4C; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 13px; pointer-events: auto; touch-action: manipulation;">Create receipt</button>' +
          '</div>';
        var btn = card.querySelector('.receipt-create-btn');
        if (btn) {
          btn.addEventListener('click', function() {
            var id = btn.getAttribute('data-invoice-id');
            createReceiptFromInvoice(id);
          });
        }
        container.appendChild(card);
      });
    }

    function createReceiptFromInvoice(invoiceId) {
      var list = typeof GlobalStorage !== 'undefined' ? GlobalStorage.getAllSavedInvoices() : [];
      var inv = list.filter(function(i) { return i.id === invoiceId || i.originalId === invoiceId; })[0];
      if (!inv) {
        alert('Invoice not found.');
        return;
      }
      hideReceiptInvoiceListModal();
      var iframe = document.getElementById('invoiceFrame');
      if (!iframe) return;
      var src = (iframe.src || '').replace(/#.*/, '');
      if (!src.endsWith('Receipt.html')) {
        var once = function() {
          iframe.removeEventListener('load', once);
          try {
            iframe.contentWindow.postMessage({ type: 'populate-receipt-from-invoice', payload: inv }, '*');
          } catch (e) { console.warn('Receipt postMessage failed', e); }
        };
        iframe.addEventListener('load', once);
        iframe.src = 'templates/Receipt.html';
      } else {
        try {
          iframe.contentWindow.postMessage({ type: 'populate-receipt-from-invoice', payload: inv }, '*');
        } catch (e) { console.warn('Receipt postMessage failed', e); }
      }
    }

    function attachReceiptModalListeners() {
      var closeReceiptListBtn = document.getElementById('closeReceiptInvoiceListModal');
      if (closeReceiptListBtn) closeReceiptListBtn.addEventListener('click', hideReceiptInvoiceListModal);
      var receiptListModal = document.getElementById('receiptInvoiceListModal');
      if (receiptListModal) {
        receiptListModal.addEventListener('click', function(e) {
          if (e.target === receiptListModal) hideReceiptInvoiceListModal();
        });
      }
      var input = document.getElementById('receiptInvoiceSearchInput');
      if (input) {
        var timeout;
        input.addEventListener('input', function() {
          clearTimeout(timeout);
          timeout = setTimeout(function() { renderReceiptInvoiceList(input.value); }, 200);
        });
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attachReceiptModalListeners);
    } else {
      attachReceiptModalListeners();
    }

    function showStatementInvoiceListModal() {
      var modal = document.getElementById('statementInvoiceListModal');
      if (modal) {
        var zoomOverlay = document.getElementById('zoomOverlay');
        var zoomDrawer = document.getElementById('zoomDrawer');
        if (zoomOverlay) zoomOverlay.classList.remove('open');
        if (zoomDrawer) zoomDrawer.classList.remove('open');
        modal.classList.add('show');
        renderStatementInvoiceList();
        var searchInput = document.getElementById('statementInvoiceSearchInput');
        if (searchInput) searchInput.value = '';
        var selectAll = document.getElementById('statementSelectAllCheckbox');
        if (selectAll) selectAll.checked = false;
        setTimeout(function() { if (searchInput) searchInput.focus(); }, 100);
      }
    }

    function hideStatementInvoiceListModal() {
      var modal = document.getElementById('statementInvoiceListModal');
      if (modal) modal.classList.remove('show');
    }

    function renderStatementInvoiceList(query) {
      var list = typeof GlobalStorage !== 'undefined' ? GlobalStorage.getAllSavedInvoices() : [];
      if (query && typeof query === 'string' && query.trim()) {
        list = typeof GlobalStorage !== 'undefined' ? GlobalStorage.searchSavedInvoices(query) : list;
      }
      list.sort(function(a, b) {
        var dateA = new Date(a.archivedAt || a.createdAt || a.lastSaved || 0);
        var dateB = new Date(b.archivedAt || b.createdAt || b.lastSaved || 0);
        return dateB - dateA;
      });
      var countEl = document.getElementById('statementInvoiceCount');
      var container = document.getElementById('statementInvoiceListContainer');
      var emptyState = document.getElementById('statementInvoiceEmptyState');
      if (countEl) countEl.textContent = list.length;
      if (!container) return;
      container.innerHTML = '';
      if (list.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        return;
      }
      if (emptyState) emptyState.style.display = 'none';
      list.forEach(function(inv) {
        var card = document.createElement('div');
        card.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa;';
        var archiveDate = inv.archivedAt ? new Date(inv.archivedAt).toLocaleDateString() : 'N/A';
        var invId = (inv.id || '').replace(/"/g, '&quot;');
        card.innerHTML =
          '<div style="display: flex; align-items: center; gap: 12px; flex: 1;">' +
          '<input type="checkbox" class="statement-invoice-cb" data-invoice-id="' + invId + '" />' +
          '<div style="flex: 1;">' +
          '<div style="font-weight: bold; font-size: 16px; color: #333; margin-bottom: 4px;">' + ((inv.documentType === 'receipt') ? 'Receipt' : (inv.documentType === 'statement') ? 'Statement' : 'Invoice') + ' #' + (inv.invoiceNo || inv.statementNo || inv.receiptNo || 'N/A') + '</div>' +
          '<div style="color: #666; font-size: 14px;">' + (inv.customerName || 'No customer') + (inv.customerEmail ? ' · ' + inv.customerEmail : '') + '</div>' +
          '<div style="color: #999; font-size: 12px; margin-top: 4px;">Archived: ' + archiveDate + '</div>' +
          '</div>' +
          '</div>' +
          '<div style="font-weight: bold; font-size: 18px; color: #333;">' + (inv.total || inv.closingBalance || '£0.00') + '</div>';
        container.appendChild(card);
      });
      var selectAll = document.getElementById('statementSelectAllCheckbox');
      if (selectAll) {
        selectAll.onclick = function() {
          var checked = selectAll.checked;
          container.querySelectorAll('.statement-invoice-cb').forEach(function(cb) { cb.checked = checked; });
        };
      }
    }

    function createStatementFromInvoices(selectedIds) {
      if (!selectedIds || selectedIds.length === 0) {
        alert('Please select at least one invoice.');
        return;
      }
      var list = typeof GlobalStorage !== 'undefined' ? GlobalStorage.getAllSavedInvoices() : [];
      var selected = selectedIds.map(function(id) {
        return list.filter(function(i) { return i.id === id || i.originalId === id; })[0];
      }).filter(Boolean);
      if (selected.length === 0) {
        alert('Selected invoice(s) not found.');
        return;
      }
      var first = selected[0];
      var statementNo = typeof GlobalStorage !== 'undefined' ? GlobalStorage.formatStatementNumber(GlobalStorage.getNextStatementNumber()) : '00001';
      var today = new Date().toLocaleDateString('en-GB');
      var items = selected.map(function(inv) {
        var ref = (inv.reference != null && String(inv.reference).trim() !== '') ? String(inv.reference).trim() : String(inv.invoiceNo || inv.statementNo || '');
        return {
          date: inv.invoiceDate || inv.archivedAt ? new Date(inv.archivedAt).toLocaleDateString('en-GB') : today,
          ref: ref,
          description: 'Invoice',
          charges: inv.total || '£0.00',
          credits: '£0.00'
        };
      });
      var payload = {
        statementNo: statementNo,
        statementDate: today,
        period: '',
        customerName: first.customerName || '',
        customerAddress: first.customerAddress || '',
        customerCity: first.customerCity || '',
        customerPhone: first.customerPhone || '',
        customerEmail: first.customerEmail || '',
        reference: statementNo,
        bankName: first.bankName || '',
        accountName: first.accountName || '',
        sortCode: first.sortCode || '',
        account: first.account || '',
        items: items
      };
      hideStatementInvoiceListModal();
      var iframe = document.getElementById('invoiceFrame');
      if (!iframe) return;
      var src = (iframe.src || '').replace(/#.*/, '');
      if (!src.endsWith('statement.html')) {
        var once = function() {
          iframe.removeEventListener('load', once);
          try {
            iframe.contentWindow.postMessage({ type: 'populate-statement-from-invoices', payload: payload }, '*');
          } catch (e) { console.warn('Statement postMessage failed', e); }
        };
        iframe.addEventListener('load', once);
        iframe.src = 'templates/statement.html';
      } else {
        try {
          iframe.contentWindow.postMessage({ type: 'populate-statement-from-invoices', payload: payload }, '*');
        } catch (e) { console.warn('Statement postMessage failed', e); }
      }
    }

    function attachStatementModalListeners() {
      var generateStatementBtn = document.getElementById('generateStatementBtn');
      if (generateStatementBtn) {
        generateStatementBtn.addEventListener('click', function() {
          var checked = document.querySelectorAll('#statementInvoiceListContainer .statement-invoice-cb:checked');
          var ids = Array.prototype.map.call(checked, function(cb) { return cb.getAttribute('data-invoice-id'); });
          createStatementFromInvoices(ids);
        });
      }
      var closeStatementListBtn = document.getElementById('closeStatementInvoiceListModal');
      if (closeStatementListBtn) closeStatementListBtn.addEventListener('click', hideStatementInvoiceListModal);
      var cancelStatementListBtn = document.getElementById('cancelStatementInvoiceListBtn');
      if (cancelStatementListBtn) cancelStatementListBtn.addEventListener('click', hideStatementInvoiceListModal);
      var statementListModal = document.getElementById('statementInvoiceListModal');
      if (statementListModal) {
        statementListModal.addEventListener('click', function(e) {
          if (e.target === statementListModal) hideStatementInvoiceListModal();
        });
      }
      var input = document.getElementById('statementInvoiceSearchInput');
      var timeout;
      if (input) {
        input.oninput = function() {
          clearTimeout(timeout);
          timeout = setTimeout(function() { renderStatementInvoiceList(input.value); }, 200);
        };
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attachStatementModalListeners);
    } else {
      attachStatementModalListeners();
    }

    window.addEventListener('message', function(e) {
      if (!e.data) return;
      if (e.data.source === 'sidebar-invoice') {
        var action = e.data.action;
        if (action === 'openCategoryShortcut' && e.data.category) {
          openCategoryShortcutDrawer(e.data.category);
        } else if (action === 'closeSidebar') {
          closeSidebarDrawer();
        } else if (action === 'openInvoiceById' && e.data.invoiceId) {
          try {
            var invoiceId = String(e.data.invoiceId);
            var loaded = (typeof GlobalStorage !== 'undefined' && typeof GlobalStorage.loadInvoiceForEditing === 'function')
              ? GlobalStorage.loadInvoiceForEditing(invoiceId)
              : false;
            if (!loaded) {
              alert('Failed to load invoice. Please try again.');
            } else {
              var invoiceFrame = document.getElementById('invoiceFrame');
              if (invoiceFrame) invoiceFrame.src = 'templates/invoice.html?t=' + Date.now();
            }
          } catch (err) {
            console.warn('openInvoiceById failed', err);
            alert('Failed to load invoice. Please try again.');
          }
        } else {
          if (action === 'invoke' && e.data.id) {
            handleSidebarInvoke(e.data.id);
          } else if (action === 'setMode' && e.data.mode && window.canvasShell) {
            var modeBtn = document.querySelector('.mode-btn[data-mode="' + e.data.mode + '"]');
            if (modeBtn) modeBtn.click();
          } else if (action === 'print') {
            window.print();
          } else if (action === 'send') {
            handleSidebarInvoke('sendBtn');
          } else if (action === 'addToPage' && e.data.type) {
            handleAddToPage(e.data.type);
          } else if (action === 'drawMode' && e.data.enabled !== undefined) {
            setDrawMode(e.data.enabled);
          }
          closeSidebarDrawer();
        }
      }
    });

    function getPageOverlaysContainer() {
      var iframe = document.getElementById('invoiceFrame');
      if (!iframe || !iframe.contentDocument) return null;
      var doc = iframe.contentDocument;
      var a4 = doc.querySelector('.a4');
      if (!a4) return null;
      a4.style.position = 'relative';
      var oldContainer = doc.getElementById('pageOverlays');
      if (oldContainer) {
        while (oldContainer.firstChild) a4.appendChild(oldContainer.firstChild);
        oldContainer.remove();
      }
      if (!doc.querySelector('script[src*="page-overlay-elements"]')) {
        var poScript = doc.createElement('script');
        try {
          poScript.src = new URL('js/page-overlay-elements.js', window.location.href).href;
        } catch (_) {
          poScript.src = '../js/page-overlay-elements.js';
        }
        doc.body.appendChild(poScript);
      }
      if (!doc.defaultView.makePageOverlayDraggable) {
        var fallback = doc.createElement('script');
        fallback.textContent = 'window.makePageOverlayDraggable=function(el){var g=function(e){return e.touches&&e.touches[0]?{x:e.touches[0].clientX,y:e.touches[0].clientY}:{x:e.clientX,y:e.clientY};};el.style.pointerEvents="auto";el.style.cursor="move";el.style.touchAction="none";var lx=0,ly=0,d=false,onM,onU;function down(e){e.preventDefault();d=true;var p=g(e);lx=p.x;ly=p.y;document.addEventListener("mousemove",onM);document.addEventListener("mouseup",onU);document.addEventListener("touchmove",onM,{passive:false});document.addEventListener("touchend",onU);}onM=function(e){if(!d)return;e.preventDefault();var p=g(e);el.style.left=((parseFloat(el.style.left)||0)+(p.x-lx))+"px";el.style.top=((parseFloat(el.style.top)||0)+(p.y-ly))+"px";lx=p.x;ly=p.y;};onU=function(){d=false;document.removeEventListener("mousemove",onM);document.removeEventListener("mouseup",onU);document.removeEventListener("touchmove",onM);document.removeEventListener("touchend",onU);};el.addEventListener("mousedown",down);el.addEventListener("touchstart",down,{passive:false});};';
        doc.body.appendChild(fallback);
      }
      return { doc: doc, container: a4 };
    }

    var _addToPageOffset = 0;
    function addElementToPage(type, optSrc) {
      var result = getPageOverlaysContainer();
      if (!result) return;
      var doc = result.doc;
      var container = result.container;
      _addToPageOffset = (_addToPageOffset + 30) % 120;
      var left = 80 + _addToPageOffset;
      var top = 100 + _addToPageOffset;

      var wrapper = doc.createElement('div');
      wrapper.style.cssText = 'position:absolute;left:' + left + 'px;top:' + top + 'px;';
      var innerEl;

      if (type === 'text') {
        wrapper.style.width = '120px';
        wrapper.style.height = '32px';
        var textDragHandle = doc.createElement('div');
        textDragHandle.className = 'page-overlay-text-drag';
        textDragHandle.style.cssText = 'height:6px;background:#926E4C;cursor:move;flex-shrink:0;';
        textDragHandle.title = 'Drag to move';
        innerEl = doc.createElement('div');
        innerEl.contentEditable = 'true';
        innerEl.textContent = 'Text';
        innerEl.style.cssText = 'flex:1;min-width:0;min-height:24px;padding:4px 8px;font-size:14px;font-family:Arial,sans-serif;border:1px dashed #926E4C;border-top:none;background:rgba(255,255,255,0.95);color:#333;box-sizing:border-box;overflow:hidden;';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.appendChild(textDragHandle);
      } else if (type === 'stamp' && optSrc) {
        wrapper.style.width = '120px';
        wrapper.style.height = '80px';
        innerEl = doc.createElement('img');
        innerEl.src = optSrc;
        innerEl.alt = 'Stamp';
        innerEl.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
      } else if (type === 'rectangle') {
        wrapper.style.width = '80px';
        wrapper.style.height = '50px';
        innerEl = doc.createElement('div');
        innerEl.style.cssText = 'width:100%;height:100%;border:2px solid #926E4C;background:rgba(146,110,76,0.1);box-sizing:border-box;';
      } else if (type === 'circle') {
        wrapper.style.width = '60px';
        wrapper.style.height = '60px';
        innerEl = doc.createElement('div');
        innerEl.style.cssText = 'width:100%;height:100%;border-radius:50%;border:2px solid #926E4C;background:rgba(146,110,76,0.1);box-sizing:border-box;';
      } else if (type === 'ellipse') {
        wrapper.style.width = '90px';
        wrapper.style.height = '50px';
        innerEl = doc.createElement('div');
        innerEl.style.cssText = 'width:100%;height:100%;border-radius:50%;border:2px solid #926E4C;background:rgba(146,110,76,0.1);box-sizing:border-box;';
      } else if (type === 'triangle') {
        wrapper.style.width = '80px';
        wrapper.style.height = '60px';
        innerEl = doc.createElement('div');
        innerEl.style.cssText = 'position:absolute;left:0;bottom:0;width:0;height:0;border-left:40px solid transparent;border-right:40px solid transparent;border-bottom:60px solid rgba(146,110,76,0.5);';
      } else if (type === 'line') {
        wrapper.style.width = '100px';
        wrapper.style.height = '4px';
        innerEl = doc.createElement('div');
        innerEl.style.cssText = 'position:absolute;left:0;top:50%;margin-top:-1px;width:100%;height:0;border-top:2px solid #926E4C;';
      } else if (type === 'draw') {
        return;
      } else {
        return;
      }

      wrapper.appendChild(innerEl);
      container.appendChild(wrapper);

      var iframe = document.getElementById('invoiceFrame');
      try {
        if (iframe && iframe.contentWindow.makePageOverlayInteractable) {
          iframe.contentWindow.makePageOverlayInteractable(wrapper, innerEl, type);
        } else if (iframe && iframe.contentWindow.makePageOverlayDraggable) {
          iframe.contentWindow.makePageOverlayDraggable(wrapper);
        }
      } catch (err) {}
    }

    window._drawModeActive = false;
    function setDrawMode(enabled) {
      window._drawModeActive = !!enabled;
      var iframe = document.getElementById('invoiceFrame');
      if (iframe && iframe.contentWindow) {
        try {
          if (iframe.contentWindow.enableDrawMode) {
            if (enabled) iframe.contentWindow.enableDrawMode();
            else iframe.contentWindow.disableDrawMode();
          }
        } catch (e) {}
      }
    }
    function toggleDrawMode() {
      setDrawMode(!window._drawModeActive);
      try {
        var sidebar = document.getElementById('sidebarIframe');
        if (sidebar && sidebar.contentWindow) {
          sidebar.contentWindow.postMessage({ source: 'parent-invoice', action: 'drawMode', enabled: window._drawModeActive }, '*');
        }
      } catch (e) {}
    }
    function handleAddOverlayImage(src) {
      if (!src) return;
      var iframe = document.getElementById('invoiceFrame');
      if (iframe && iframe.contentWindow && iframe.contentWindow.addOverlayImage) {
        try { iframe.contentWindow.addOverlayImage(src); } catch (e) {}
      }
    }
    function handleAddToPage(type) {
      if (type === 'stamp') {
        var input = document.getElementById('stampImageInput');
        if (input) {
          input.onchange = function() {
            var file = input.files && input.files[0];
            if (file) {
              var r = new FileReader();
              r.onload = function() { addElementToPage('stamp', r.result); };
              r.readAsDataURL(file);
            }
            input.value = '';
          };
          input.click();
        }
      } else if (type === 'draw') {
        toggleDrawMode();
        if (window._drawModeActive) {
          var iframe = document.getElementById('invoiceFrame');
          if (iframe && iframe.contentWindow && iframe.contentWindow.setDrawTool) {
            try { iframe.contentWindow.setDrawTool('draw'); } catch (e) {}
          }
        }
      } else if (type === 'eraser') {
        setDrawMode(true);
        var iframe = document.getElementById('invoiceFrame');
        if (iframe && iframe.contentWindow && iframe.contentWindow.setDrawTool) {
          try { iframe.contentWindow.setDrawTool('eraser'); } catch (e) {}
        }
      } else if (type === 'overlayImage') {
        var input = document.getElementById('overlayImageInput');
        if (input) {
          input.onchange = function() {
            var file = input.files && input.files[0];
            if (file) {
              var r = new FileReader();
              r.onload = function() { handleAddOverlayImage(r.result); };
              r.readAsDataURL(file);
            }
            input.value = '';
          };
          input.click();
        }
      } else {
        addElementToPage(type);
      }
    }

    var CATEGORY_SHORTCUT_BUTTONS = {
      Mode: [
        { label: 'Edit', icon: '\u270E', action: 'setMode', mode: 'edit' },
        { label: 'Preview', icon: '\u25CB', action: 'setMode', mode: 'preview' },
        { label: 'Save', icon: '\u2713', action: 'invoke', id: 'saveBtn' },
        { label: 'Send', icon: '\u2197', action: 'send' },
        { label: 'Print', icon: '\u2399', action: 'print' }
      ],
      New: [
        { label: 'Invoice', icon: '\u25A1', action: 'invoke', id: 'newInvoiceBtn' },
        { label: 'Receipt', icon: '\u2261', action: 'invoke', id: 'newReceiptBtn' },
        { label: 'Statement', icon: '\u2193', action: 'invoke', id: 'exportBtn' },
        { label: 'Summary', icon: '\u03A3', action: 'invoke', id: 'newSummaryBtn' },
        { label: 'Order List', icon: '\u2630', action: 'invoke', id: 'newOrderListBtn' },
        { label: 'Document', icon: '\u2398', action: 'invoke', id: 'newDocumentBtn' }
      ],
      Document: [
        { label: 'Load Invoice', icon: '\u229E', action: 'invoke', id: 'loadInvoiceBtnEdit' },
        { label: 'Load Receipt', icon: '\u229E', action: 'invoke', id: 'loadReceiptBtnEdit' },
        { label: 'Load Statement', icon: '\u229E', action: 'invoke', id: 'loadStatementBtnEdit' },
        { label: 'View Transactions', icon: '\u229E', action: 'invoke', id: 'newTransactionsBtn' }
      ],
      Settings: [
        { label: 'Setup', icon: '\u2699', action: 'invoke', id: 'dataManagementBtn' },
        { label: 'Themes', icon: '\u25C7', action: 'invoke', id: 'dataManagementBtn' },
        { label: 'About', icon: '\u2139', action: 'invoke', id: 'dataManagementBtn' },
        { label: 'Help', icon: '?', action: 'invoke', id: 'dataManagementBtn' }
      ],
      Tools: [
        { label: 'Rectangle', icon: '\u25AD', action: 'addToPage', type: 'rectangle' },
        { label: 'Circle', icon: '\u25CF', action: 'addToPage', type: 'circle' },
        { label: 'Ellipse', icon: '\u2B2D', action: 'addToPage', type: 'ellipse' },
        { label: 'Triangle', icon: '\u25B2', action: 'addToPage', type: 'triangle' },
        { label: 'Line', icon: '\u2014', action: 'addToPage', type: 'line' },
        { label: 'Text', icon: 'T', action: 'addToPage', type: 'text' },
        { label: 'Stamp', icon: '\u25A3', action: 'addToPage', type: 'stamp' },
        { label: 'Image Overlay', icon: '\uD83D\uDDBC', action: 'addToPage', type: 'overlayImage' },
        { label: 'Draw', icon: '\u270E', action: 'addToPage', type: 'draw' },
        { label: 'Eraser', icon: '\u232B', action: 'addToPage', type: 'eraser' }
      ]
    };
    var CATEGORY_ORDER = ['Mode', 'New', 'Document', 'Settings', 'Tools'];

    function openCategoryShortcutDrawer(category) {
      var drawer = document.getElementById('categoryShortcutDrawer');
      var content = document.getElementById('categoryShortcutContent');
      if (!drawer || !content) return;
      var buttons = CATEGORY_SHORTCUT_BUTTONS[category];
      if (!buttons || !buttons.length) return;
      content.innerHTML = '';
      buttons.forEach(function(b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'category-shortcut-btn';
        btn.setAttribute('data-action', b.action);
        if (b.id) btn.setAttribute('data-id', b.id);
        if (b.type) btn.setAttribute('data-type', b.type);
        btn.innerHTML = '<span class="icon">' + b.icon + '</span><span class="text">' + b.label + '</span>';
        btn.addEventListener('click', function() {
          if (b.action === 'invoke' && b.id) handleSidebarInvoke(b.id);
          else if (b.action === 'addToPage' && b.type) handleAddToPage(b.type);
          else if (b.action === 'setMode' && b.mode && window.canvasShell) {
            var modeBtn = document.querySelector('.mode-btn[data-mode="' + b.mode + '"]');
            if (modeBtn) modeBtn.click();
          }
          else if (b.action === 'send') handleSidebarInvoke('sendBtn');
          else if (b.action === 'print') window.print();
        });
        content.appendChild(btn);
      });
      drawer.setAttribute('data-current-category', category);
      drawer.classList.remove('idle');
      drawer.classList.add('open');
      if (document.body) document.body.classList.add('category-shortcut-drawer-open');
    }

    function closeCategoryShortcutDrawer() {
      var drawer = document.getElementById('categoryShortcutDrawer');
      if (drawer) drawer.classList.remove('open');
      if (document.body) document.body.classList.remove('category-shortcut-drawer-open');
    }

    function initCategoryShortcutDrawer() {
      var drawer = document.getElementById('categoryShortcutDrawer');
      var handleLeft = document.getElementById('categoryShortcutHandleLeft');
      var handleRight = document.getElementById('categoryShortcutHandleRight');
      if (!drawer || !handleLeft || !handleRight) return;
      if (window.canvasShell && window.canvasShell.initCategoryShortcutDragging) {
        window.canvasShell.initCategoryShortcutDragging(drawer, handleLeft, handleRight);
      }
    }
    document.addEventListener('DOMContentLoaded', function() {
      if (window.canvasShell && window.canvasShell.initCategoryShortcutDragging) initCategoryShortcutDrawer();
    });

    // Wire trigger buttons so click runs same logic as sidebar invoke (dataManagementBtn/saveBtn keep canvasShell-only listeners to avoid double fire)
    (function() {
      var ids = ['newInvoiceBtn', 'newReceiptBtn', 'exportBtn', 'newSummaryBtn', 'newOrderListBtn', 'newDocumentBtn', 'loadInvoiceBtnEdit', 'loadReceiptBtnEdit', 'loadStatementBtnEdit', 'newTransactionsBtn', 'sendBtn'];
      ids.forEach(function(id) {
        var btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', function() { handleSidebarInvoke(id); });
      });
    })();
