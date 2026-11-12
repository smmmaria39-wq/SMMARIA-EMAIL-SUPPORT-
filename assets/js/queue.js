/* ============================================================================
 * SMMARIA Email Manager — queue.js
 * ----------------------------------------------------------------------------
 * Backend endpoints used:
 *   GET  /api/admin/queue           list (+search/status/pagination)
 *   GET  /api/admin/queue/stats     counters
 *   POST /api/admin/queue/:id/retry    (confirm)
 *   POST /api/admin/queue/:id/cancel   (confirm)
 *
 * Auto-refresh: configurable interval, cancelled when leaving the page
 * (beforeunload + visibilitychange pauses polling in background tabs).
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG, UI = window.SMMUI, API = window.SMMApi;
  var EP = CFG.ENDPOINTS.queue;

  var state = { page: 1, limit: CFG.DEFAULT_PAGE_SIZE, search: '', status: '' };
  var pollTimer = null;
  var statsTimer = null;

  document.addEventListener('DOMContentLoaded', function () {
    var tbody = document.querySelector('#queue-table tbody');
    var stateBox = document.getElementById('queue-state');
    var searchEl = document.getElementById('queue-search');
    var statusEl = document.getElementById('queue-status');
    var autoEl = document.getElementById('queue-auto');
    var intervalEl = document.getElementById('queue-interval');

    document.getElementById('queue-refresh').addEventListener('click', function () { loadAll(); UI.toast('info', 'Queue refreshed', ''); });
    searchEl.addEventListener('input', UI.debounce(function () { state.search = searchEl.value.trim(); state.page = 1; loadAll(); }, 350));
    statusEl.addEventListener('change', function () { state.status = statusEl.value; state.page = 1; loadAll(); });
    document.getElementById('queue-clear').addEventListener('click', function () {
      state = { page: 1, limit: state.limit, search: '', status: '' };
      searchEl.value = ''; statusEl.value = '';
      loadAll();
    });

    autoEl.addEventListener('change', function () {
      if (autoEl.checked) startPolling(); else stopPolling();
    });
    intervalEl.addEventListener('change', function () {
      if (autoEl.checked) { stopPolling(); startPolling(); }
    });

    // Cleanup on leave — never leave a timer behind.
    window.addEventListener('beforeunload', stopPolling);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopPolling();
      else if (autoEl.checked) startPolling();
    });

    loadAll();
    startPolling();

    /* ---------------------------------------------------------------- */
    function startPolling() {
      stopPolling();
      var ms = Number(intervalEl.value) || 10000;
      pollTimer = setInterval(loadJobs, ms);
      statsTimer = setInterval(loadStats, ms);
    }
    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    }

    function loadAll() { loadStats(); loadJobs(); }

    function loadStats() {
      var box = document.getElementById('queue-stats');
      API.get(EP.stats).then(function (s) {
        s = s || {};
        var cards = [
          { label: 'Pending',    v: pick(s, ['pending', 'pending_jobs', 'waiting']),    icon: 'clock',        tone: 'kpi-amber' },
          { label: 'Processing', v: pick(s, ['processing', 'active', 'in_progress']),   icon: 'loader-2',     tone: 'kpi-blue' },
          { label: 'Completed',  v: pick(s, ['completed', 'done']),                     icon: 'check-circle', tone: 'kpi-green' },
          { label: 'Failed',     v: pick(s, ['failed', 'errors']),                      icon: 'x-circle',     tone: 'kpi-red' },
          { label: 'Retrying',   v: pick(s, ['retrying', 'retries_scheduled']),         icon: 'rotate-cw',    tone: 'kpi-purple' }
        ];
        box.setAttribute('aria-busy', 'false');
        box.innerHTML = cards.map(function (c) {
          return '<div class="kpi-card">' +
            '<span class="kpi-icon ' + c.tone + '"><i data-lucide="' + c.icon + '"></i></span>' +
            '<div class="kpi-body"><div class="kpi-label">' + c.label + '</div>' +
            '<div class="kpi-value">' + (c.v === null ? '—' : UI.fmt.number(c.v)) + '</div></div></div>';
        }).join('');
        if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
      }).catch(function () {
        // Stats panel failure is non-fatal; the job table reports its own errors.
        box.innerHTML = '<div class="kpi-card" style="grid-column:1/-1"><div class="kpi-body">' +
          '<div class="kpi-label">Queue stats unavailable</div>' +
          '<div class="kpi-sub">GET /api/admin/queue/stats failed. See the job table below for details.</div></div></div>';
      });
    }

    function pick(obj, keys) {
      for (var i = 0; i < keys.length; i++) {
        var v = obj[keys[i]];
        if (v !== undefined && v !== null) return Number(v);
      }
      return null;
    }

    function loadJobs() {
      var first = !tbody.querySelector('tr[data-id]');
      if (first) UI.skeletonRows(tbody, 8, 6);
      UI.renderState(stateBox, { type: 'clear' });

      API.get(EP.list, {
        page: state.page, limit: state.limit,
        search: state.search || undefined,
        status: state.status || undefined
      }).then(function (payload) {
        var items = UI.extractList(payload);
        var total = UI.extractTotal(payload, items.length);
        var totalPages = UI.extractTotalPages(payload, total, state.limit);
        if (!items.length) {
          tbody.innerHTML = '';
          UI.renderState(stateBox, {
            type: 'empty', icon: 'list-checks', title: 'Queue is empty',
            text: state.search || state.status ? 'No jobs match the current filters.' : 'No email jobs right now. New jobs appear here automatically.'
          });
          document.getElementById('queue-info').textContent = '';
          UI.pagination(document.getElementById('queue-pagination'), { page: 1, totalPages: 1, total: 0 });
          return;
        }
        tbody.innerHTML = items.map(rowHtml).join('');
        wireRows(items);
        document.getElementById('queue-info').textContent =
          'Showing ' + ((state.page - 1) * state.limit + 1) + '–' + Math.min(state.page * state.limit, total) + ' of ' + UI.fmt.number(total) + ' jobs';
        UI.pagination(document.getElementById('queue-pagination'), {
          page: state.page, totalPages: totalPages, total: total,
          onPage: function (p) { state.page = p; loadJobs(); }
        });
        if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
      }).catch(function (err) {
        tbody.innerHTML = '';
        UI.renderState(stateBox, { type: 'error', title: 'Could not load the queue', error: err, retry: loadJobs });
      });
    }

    function rowHtml(j) {
      var id = j.id !== undefined ? j.id : j._id;
      var status = String(j.status || 'pending').toLowerCase();
      var canRetry = status === 'failed';
      var canCancel = status === 'pending' || status === 'queued';
      return '<tr data-id="' + UI.esc(id) + '">' +
        '<td><div class="cell-main">' + UI.esc(j.recipient || j.to || j.email || '—') + '</div></td>' +
        '<td><div class="truncate" style="max-width:180px">' + UI.esc(j.subject || '(no subject)') + '</div></td>' +
        '<td>' + UI.statusBadge(j.status) +
          (j.attempts !== undefined && j.attempts !== null ? '<div class="cell-sub">' + UI.esc(String(j.attempts)) + ' attempt(s)</div>' : '') + '</td>' +
        '<td class="cell-num">' + UI.esc(j.attempts !== undefined && j.attempts !== null ? String(j.attempts) : '—') +
          (j.max_attempts ? '<div class="cell-sub">max ' + UI.esc(String(j.max_attempts)) + '</div>' : '') + '</td>' +
        '<td class="cell-muted nowrap">' + UI.esc(UI.fmt.timeAgo(j.created_at)) + '</td>' +
        '<td class="cell-muted nowrap">' + UI.esc(j.last_attempt_at ? UI.fmt.timeAgo(j.last_attempt_at) : '—') + '</td>' +
        '<td class="cell-muted nowrap">' + UI.esc(j.next_retry_at ? UI.fmt.timeAgo(j.next_retry_at) : '—') + '</td>' +
        '<td class="td-actions"><div class="row-actions">' +
          '<button class="icon-btn" data-act="view" title="Job details" style="width:32px;height:32px"><i data-lucide="eye"></i></button>' +
          (canRetry ? '<button class="icon-btn" data-act="retry" title="Retry now" style="width:32px;height:32px"><i data-lucide="rotate-cw"></i></button>' : '') +
          (canCancel ? '<button class="icon-btn" data-act="cancel" title="Cancel job" style="width:32px;height:32px;color:var(--c-danger)"><i data-lucide="x-circle"></i></button>' : '') +
        '</div></td></tr>';
    }

    function wireRows(items) {
      var tbody = document.querySelector('#queue-table tbody');
      tbody.querySelectorAll('tr').forEach(function (tr) {
        var id = tr.getAttribute('data-id');
        var j = items.find(function (x) { return String(x.id !== undefined ? x.id : x._id) === String(id); });
        if (!j) return;
        var v = tr.querySelector('[data-act="view"]');
        v && v.addEventListener('click', function () { viewJob(j); });
        var r = tr.querySelector('[data-act="retry"]');
        r && r.addEventListener('click', function () { retryJob(j); });
        var c = tr.querySelector('[data-act="cancel"]');
        c && c.addEventListener('click', function () { cancelJob(j); });
      });
    }

    function viewJob(j) {
      UI.modal({
        title: 'Queue job',
        sub: 'Job ' + (j.id !== undefined ? j.id : ''),
        body:
          '<dl class="detail-grid">' +
          '<dt>Job ID</dt><dd class="mono">' + UI.esc(j.id !== undefined ? j.id : (j._id || '')) + '</dd>' +
          '<dt>Recipient</dt><dd>' + UI.esc(j.recipient || j.to || j.email || '—') + '</dd>' +
          '<dt>Subject</dt><dd>' + UI.esc(j.subject || '(no subject)') + '</dd>' +
          '<dt>Status</dt><dd>' + UI.statusBadge(j.status) + '</dd>' +
          '<dt>Attempts</dt><dd>' + UI.esc(j.attempts !== undefined ? String(j.attempts) : '—') + (j.max_attempts ? ' of ' + UI.esc(String(j.max_attempts)) : '') + '</dd>' +
          '<dt>Created</dt><dd>' + UI.esc(UI.fmt.dateTime(j.created_at)) + '</dd>' +
          (j.last_attempt_at ? '<dt>Last attempt</dt><dd>' + UI.esc(UI.fmt.dateTime(j.last_attempt_at)) + '</dd>' : '') +
          (j.next_retry_at ? '<dt>Next retry</dt><dd>' + UI.esc(UI.fmt.dateTime(j.next_retry_at)) + '</dd>' : '') +
          (j.error || j.error_message ? '<dt>Error</dt><dd style="color:var(--c-danger)">' + UI.esc(j.error || j.error_message) + '</dd>' : '') +
          '</dl>' +
          (j.payload ? '<div class="detail-section-title">Job payload</div><div class="json-block">' +
            UI.esc(typeof j.payload === 'string' ? j.payload : JSON.stringify(j.payload, null, 2)) + '</div>' : ''),
        foot:
          (String(j.status).toLowerCase() === 'failed'
            ? '<button class="btn btn-outline-danger" id="job-retry"><i data-lucide="rotate-cw" class="btn-icon"></i><span>Retry job</span></button>' : '') +
          '<button class="btn btn-secondary" data-close>Close</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          var rb = box.querySelector('#job-retry');
          rb && rb.addEventListener('click', function () { close(); retryJob(j); });
        }
      });
    }

    function retryJob(j) {
      var id = j.id !== undefined ? j.id : j._id;
      UI.confirm({
        title: 'Retry this job?',
        message: 'A new attempt will be scheduled for <strong>' + UI.esc(j.recipient || j.to || '') + '</strong>: ' + UI.esc(j.subject || '(no subject)'),
        confirmLabel: 'Retry job'
      }).then(function (ok) {
        if (!ok) return;
        API.post(EP.retry.replace(':id', id))
          .then(function () { UI.toast('success', 'Job retry scheduled', ''); loadAll(); })
          .catch(function (err) {
            if (err.kind === 'NOT_FOUND') UI.toast('warning', 'Not supported', 'POST /api/admin/queue/:id/retry is not implemented on the backend.');
            else UI.toast('error', 'Retry failed', err.message);
          });
      });
    }

    function cancelJob(j) {
      var id = j.id !== undefined ? j.id : j._id;
      UI.confirm({
        title: 'Cancel this job?',
        message: 'The pending job for <strong>' + UI.esc(j.recipient || j.to || '') + '</strong> will be removed from the queue and never sent.',
        confirmLabel: 'Cancel job', danger: true
      }).then(function (ok) {
        if (!ok) return;
        API.post(EP.cancel.replace(':id', id))
          .then(function () { UI.toast('success', 'Job cancelled', ''); loadAll(); })
          .catch(function (err) {
            if (err.kind === 'NOT_FOUND') UI.toast('warning', 'Not supported', 'POST /api/admin/queue/:id/cancel is not implemented on the backend.');
            else UI.toast('error', 'Cancel failed', err.message);
          });
      });
    }
  });
})();
