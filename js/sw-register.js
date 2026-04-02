/**
 * Service worker registration — client-side lifecycle for learning.
 *
 * Stages (see MDN: ServiceWorker.state):
 * - "installing" — browser is running the worker's "install" event (precache, etc.)
 * - "installed"  — install finished; if an older worker still controls pages, this one is **waiting**
 * - "activating" — "activate" event running (cleanup old caches, claim clients if skipWaiting fired)
 * - "activated"  — this worker is (or is about to be) the controller
 * - "redundant"  — replaced; discarded
 *
 * Registration object (ServiceWorkerRegistration):
 * - reg.installing — the worker currently in "installing", or null
 * - reg.waiting    — a **new** worker that finished install but is blocked by an active tab using the old worker
 * - reg.active     — the worker controlling this origin (may be null on very first install until reload)
 *
 * Open DevTools → Console and watch [sw:page] / [sw:worker] logs.
 */
(function () {
  'use strict';

  var LOG = '[sw:page]';

  function hideSwLearningPanel() {
    var hint = document.getElementById('sw-dev-hint');
    if (hint) hint.hidden = true;
  }

  if (!('serviceWorker' in navigator)) {
    console.info(LOG, 'Service workers not supported in this browser.');
    hideSwLearningPanel();
    return;
  }

  var secure = location.protocol === 'https:';
  var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!secure && !local) {
    console.info(LOG, 'Skipped: need https or localhost (not file://).');
    hideSwLearningPanel();
    return;
  }

  function describeRegistration(reg) {
    return {
      scope: reg.scope,
      installing: reg.installing && workerBrief(reg.installing),
      waiting: reg.waiting && workerBrief(reg.waiting),
      active: reg.active && workerBrief(reg.active),
    };
  }

  function workerBrief(w) {
    return { state: w.state, scriptURL: w.scriptURL };
  }

  /**
   * Log every state transition for one ServiceWorker instance.
   */
  function trackServiceWorker(worker, label) {
    if (!worker) return;

    var prev = worker.state;
    console.log(LOG, label + ' initial state:', prev, worker.scriptURL);

    worker.addEventListener('statechange', function () {
      console.log(
        LOG,
        label + ' statechange:',
        prev,
        '→',
        worker.state,
        worker.scriptURL
      );
      prev = worker.state;

      if (worker.state === 'installed') {
        console.info(
          LOG,
          '"' + label + '" installed. If SKIP_WAITING_ON_INSTALL is false in sw.js, this worker may stay **waiting** until skipWaiting() (see [sw:worker] logs).'
        );
      }
      if (worker.state === 'activated') {
        console.info(LOG, '"' + label + '" is now activated.');
      }
    });
  }

  function updateWaitingUi(reg) {
    var hint = document.getElementById('sw-dev-hint');
    var btn = document.getElementById('swSkipWaitingBtn');
    var title = document.getElementById('sw-dev-hint-title');
    var statusEl = document.getElementById('sw-dev-hint-status');
    if (!hint || !btn) return;

    hint.hidden = false;

    var ctrl = navigator.serviceWorker.controller;
    var ctrlLine = ctrl
      ? 'This page’s controller: ' + ctrl.state + ' · ' + (ctrl.scriptURL || '').replace(location.origin, '') + '.'
      : 'No controller on this page yet (first visit or not registered).';

    if (!reg) {
      if (title) title.textContent = 'Service worker (learning)';
      if (statusEl) {
        statusEl.textContent =
          ctrlLine + ' No registration object. Watch the console for ' + LOG + ' logs.';
      }
      btn.disabled = true;
      btn.style.opacity = '0.45';
      btn.style.cursor = 'default';
      btn.onclick = null;
      return;
    }

    if (reg.waiting) {
      if (title) title.textContent = 'Service worker update waiting';
      if (statusEl) {
        statusEl.innerHTML =
          'A new worker finished install but has not taken control yet. Use the button, close other tabs, or run <code style="font-size:11px;background:rgba(255,255,255,.08);padding:2px 4px;border-radius:4px;">__guappSwSkipWaiting()</code> in the console.<br><br><span style="opacity:.85">' +
          ctrlLine +
          '</span>';
      }
      console.warn(
        LOG,
        'A new service worker is **waiting**. Old tabs still use the previous worker. Close other tabs, or click “Activate service worker update” (calls skipWaiting).',
        describeRegistration(reg)
      );
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.onclick = function () {
        console.log(LOG, 'Posting SKIP_WAITING to waiting worker.');
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      };
    } else {
      if (title) title.textContent = 'Service worker (learning)';
      if (statusEl) {
        statusEl.innerHTML =
          ctrlLine +
          ' No worker is <strong>waiting</strong> right now. To practice: set <code style="font-size:11px;background:rgba(255,255,255,.08);padding:2px 4px;border-radius:4px;">SKIP_WAITING_ON_INSTALL</code> to <code style="font-size:11px;background:rgba(255,255,255,.08);padding:2px 4px;border-radius:4px;">false</code> in <code style="font-size:11px;background:rgba(255,255,255,.08);padding:2px 4px;border-radius:4px;">sw.js</code>, bump <code style="font-size:11px;background:rgba(255,255,255,.08);padding:2px 4px;border-radius:4px;">VERSION</code>, save, then refresh twice so a new worker stays waiting. Watch the console for ' +
          LOG +
          ' / [sw:worker].';
      }
      btn.disabled = true;
      btn.style.opacity = '0.45';
      btn.style.cursor = 'default';
      btn.onclick = null;
    }
  }

  /** Call from console: forces the waiting worker to call skipWaiting() inside sw.js */
  window.__guappSwSkipWaiting = function () {
    if (navigator.serviceWorker.controller && navigator.serviceWorker.controller.state) {
      console.log(LOG, 'Current controller:', navigator.serviceWorker.controller.state);
    }
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg || !reg.waiting) {
        console.info(LOG, 'No registration or no waiting worker — nothing to skip.');
        return;
      }
      console.log(LOG, 'Posting SKIP_WAITING via __guappSwSkipWaiting().');
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  };

  /** What is controlling this page right now (may be null on first ever visit before activation). */
  if (navigator.serviceWorker.controller) {
    console.log(LOG, 'This page is controlled by:', workerBrief(navigator.serviceWorker.controller));
  } else {
    console.info(LOG, 'No controller yet (first visit before SW activated, or SW not registered).');
  }

  /**
   * Fires when a **new** ServiceWorker script is found (e.g. after you edit sw.js and refresh).
   * reg.installing will usually point at the new worker.
   */
  function attachUpdateFound(reg) {
    reg.addEventListener('updatefound', function () {
      console.log(LOG, 'updatefound — browser is installing a new service worker script.');
      var nw = reg.installing;
      if (nw) {
        trackServiceWorker(nw, 'installing worker');
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              console.info(
                LOG,
                'New worker installed while an old controller still exists → new worker typically enters **waiting** unless skipWaiting runs.'
              );
            } else {
              console.info(
                LOG,
                'First worker installed; it can become active without waiting (no previous controller).'
              );
            }
          }
          updateWaitingUi(reg);
        });
      }
      updateWaitingUi(reg);
    });
  }

  /**
   * Fires when navigator.serviceWorker.controller changes — e.g. after skipWaiting + clients.claim.
   * Usually followed by a reload for "hard" updates; clients.claim can take over without reload.
   */
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    console.log(LOG, 'controllerchange — controlling worker swapped.');
    if (navigator.serviceWorker.controller) {
      console.log(LOG, 'New controller:', workerBrief(navigator.serviceWorker.controller));
    }
    navigator.serviceWorker.getRegistration().then(updateWaitingUi);
  });

  window.addEventListener('load', function () {
    console.log(LOG, 'load — calling register(sw.js) …');

    navigator.serviceWorker
      .register('sw.js', {
        scope: './',
        updateViaCache: 'none',
      })
      .then(function (reg) {
        console.log(LOG, 'register() resolved — ServiceWorkerRegistration:', describeRegistration(reg));

        if (reg.installing) {
          trackServiceWorker(reg.installing, 'reg.installing');
        }
        if (reg.waiting) {
          trackServiceWorker(reg.waiting, 'reg.waiting');
        }
        if (reg.active) {
          trackServiceWorker(reg.active, 'reg.active');
        }

        attachUpdateFound(reg);
        updateWaitingUi(reg);
      })
      .catch(function (err) {
        console.warn(LOG, 'register() rejected', err);
        var title = document.getElementById('sw-dev-hint-title');
        var statusEl = document.getElementById('sw-dev-hint-status');
        var btn = document.getElementById('swSkipWaitingBtn');
        if (title) title.textContent = 'Service worker (learning)';
        if (statusEl) {
          statusEl.textContent =
            'register() failed: ' + (err && err.message ? err.message : String(err));
        }
        if (btn) {
          btn.disabled = true;
          btn.style.opacity = '0.45';
          btn.style.cursor = 'default';
          btn.onclick = null;
        }
      });
  });
})();
