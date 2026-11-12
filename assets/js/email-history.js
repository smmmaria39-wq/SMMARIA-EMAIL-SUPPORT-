/* ============================================================================
 * SMMARIA Email Manager — email-history.js
 * ----------------------------------------------------------------------------
 * Backend endpoints used:
 *   GET  /api/admin/emails        list (+search/status/type/date/pagination)
 *   GET  /api/admin/emails/:id    detail incl. delivery attempts + provider response
 *   POST /api/admin/emails/:id/retry   (optional)
 *
 * Status vocabulary mirrors reality: queued / processing / accepted / sent /
 * delivered / failed / bounced. "Accepted" means the provider took the API
 * request — it is NOT presented as "delivered" unless the backend says so.
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG, UI = window.SMMUI, API = window.SMMApi;
  var EP = CFG.ENDPOINTS.emails;

  var state = { page: 1, limit: CFG.DEFAULT_PAGE_SIZE, search: '', status: '', type: '', from: '', to: '' };

  document.addEventListener('DOMContentLoaded', function () {
    var tbody = document.querySelector('#hist-table tbody');
    var stateBox = document.getElementById('hist-state');
    var searchEl = document.getElementById('hist-search');
    var statusEl = document.getElementById('hist-status');
    var typeEl = document.getElementById('hist-type');
    var fromEl = document.getElementById('hist-from');
    var toEl = document.getElementById('hist-to');

    // Deep link from dashboard failures panel (?status=failed)
    var qs = new URLSearchParams(location.search);
    if (qs.get('status')) { state.status = qs.get('status'); statusEl.value = state.status; }

    document.getElementById('hist-refresh').addEventListener('click', function () { load(); UI.toast('info', 'Refreshed', 'Email history reloaded.'); });
    searchEl.addEventListener('input', UI.debounce(function () { state.search = searchEl.value.trim(); state.page = 1; load(); }, 350));
    statusEl.addEventListener('change', function () { state.status = statusEl.value; state.page = 1; load(); });
    typeEl.addEventListener('change', function () { state.type = typeEl.value; state.page = 1; load(); });
    fromEl.addEventListener('change', function () { state.from = fromEl.value; state.page = 1; load(); });
    toEl.addEventListener('change', function () { state.to = toEl.value; state.page = 1; load(); });
    document.getElementById('hist-clear').addEventListener('click', function () {
      state = { page: 1, limit: state.limit, search: '', status: '', type: '', from: '', to: '' };
      searchEl.value = ''; statusEl.value = ''; typeEl.value = ''; fromEl.value = ''; toEl.value = '';
      load();
    });

    load();

    function load() {
      UI.skeletonRows(tbody, 6, 6);
      UI.renderState(stateBox, { type: 'clear' });

      API.get(EP.list, {
        page: state.page, limit: state.limit,
        search: state.search || undefined,
        status: state.status || undefined,
        type: state.type || undefined,
        from: state.from || undefined,
        to: state.to || undefined
      }).then(function (payload) {
        var items = UI.extractList(payload);
        var total = UI.extractTotal(payload, items.length);
        var totalPages = UI.extractTotalPages(payload, total, state.limit);
        if (!items.length) {
          tbody.innerHTML = '';
          UI.renderState(stateBox, {
            type: 'empty', icon: 'inbox', title: 'No emails found',
            text: state.search || state.status || state.type ? 'No emails match the current filters.' : 'Emails processed by the backend will appear here.'
          });
          document.getElementById('hist-info').textContent = '';
          UI.pagination(document.getElementById('hist-pagination'), { page: 1, totalPages: 1, total: 0 });
          return;
        }
        tbody.innerHTML = items.map(rowHtml).join('');
        wireRows(items);
        document.getElementById('hist-info').textContent =
          'Showing ' + ((state.page - 1) * state.limit + 1) + '–' + Math.min(state.page * state.limit, total) + ' of ' + UI.fmt.number(total) + ' emails';
        UI.pagination(document.getElementById('hist-pagination'), {
          page: state.page, totalPages: totalPages, total: total,
          onPage: function (p) { state.page = p; load(); }
        });
        if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
      }).catch(function (err) {
        tbody.innerHTML = '';
        UI.renderState(stateBox, { type: 'error', title: 'Could not load email history', error: err, retry: load });
      });
    }

    function rowHtml(e) {
      var id = e.id !== undefined ? e.id : e._id;
      var status = String(e.status || '').toLowerCase();
      var retriable = status === 'failed';
      return '<tr data-id="' + UI.esc(id) + '">' +
        '<td><div class="cell-main">' + UI.esc(e.recipient || e.to || e.email || '—') + '</div></td>' +
        '<td><div class="truncate" style="max-width:220px">' + UI.esc(e.subject || '(no subject)') + '</div>' +
          (e.campaign_name ? '<div class="cell-sub">Campaign: ' + UI.esc(e.campaign_name) + '</div>' : '') + '</td>' +
        '<td><span class="badge badge-neutral">' + UI.esc(e.type || 'system') + '</span></td>' +
        '<td>' + UI.statusBadge(e.status) +
          (status === 'accepted' ? '<div class="cell-sub">provider accepted — delivery not confirmed</div>' : '') + '</td>' +
        '<td class="cell-muted nowrap">' + UI.esc(UI.fmt.dateTime(e.created_at || e.sent_at || e.date)) + '</td>' +
        '<td class="td-actions"><div class="row-actions">' +
          '<button class="icon-btn" data-act="view" title="Details" style="width:32px;height:32px"><i data-lucide="eye"></i></button>' +
          (retriable ? '<button class="icon-btn" data-act="retry" title="Retry" style="width:32px;height:32px"><i data-lucide="rotate-cw"></i></button>' : '') +
        '</div></td></tr>';
    }

    function wireRows(items) {
      var tbody = document.querySelector('#hist-table tbody');
      tbody.querySelectorAll('tr').forEach(function (tr) {
        var id = tr.getAttribute('data-id');
        var e = items.find(function (x) { return String(x.id !== undefined ? x.id : x._id) === String(id); });
        if (!e) return;
        var viewBtn = tr.querySelector('[data-act="view"]');
        viewBtn && viewBtn.addEventListener('click', function () { viewEmail(e); });
        var retryBtn = tr.querySelector('[data-act="retry"]');
        retryBtn && retryBtn.addEventListener('click', function () { retryEmail(e); });
      });
    }

    /* ---------------------------------------------------------------- */
    function viewEmail(e) {
      var id = e.id !== undefined ? e.id : e._id;
      API.get(EP.get, null, { repl: { id: id } })
        .then(function (full) { showDetail(full || e); })
        .catch(function (err) {
          if (err.kind === 'NOT_FOUND') showDetail(e);
          else UI.toast('error', 'Could not load email', err.message);
        });
    }

    function showDetail(e) {
      var attempts = e.attempts || e.delivery_attempts || [];
      var provider = e.provider_response || e.provider || e.response;
      var campaign = e.campaign || (e.campaign_id ? { id: e.campaign_id, name: e.campaign_name } : null);

      var body =
        '<dl class="detail-grid">' +
        '<dt>Email ID</dt><dd class="mono">' + UI.esc(e.id !== undefined ? e.id : (e._id || '—')) + '</dd>' +
        '<dt>Recipient</dt><dd>' + UI.esc(e.recipient || e.to || '—') + '</dd>' +
        '<dt>Subject</dt><dd>' + UI.esc(e.subject || '(no subject)') + '</dd>' +
        '<dt>Type</dt><dd>' + UI.esc(e.type || '—') + '</dd>' +
        '<dt>Status</dt><dd>' + UI.statusBadge(e.status) + '</dd>' +
        '<dt>Created</dt><dd>' + UI.esc(UI.fmt.dateTime(e.created_at)) + '</dd>' +
        (e.sent_at ? '<dt>Sent</dt><dd>' + UI.esc(UI.fmt.dateTime(e.sent_at)) + '</dd>' : '') +
        (e.delivered_at ? '<dt>Delivered</dt><dd>' + UI.esc(UI.fmt.dateTime(e.delivered_at)) + '</dd>' : '') +
        (e.provider ? '<dt>Provider</dt><dd>' + UI.esc(e.provider) + '</dd>' : '') +
        (e.error_message || e.error ? '<dt>Error</dt><dd style="color:var(--c-danger)">' + UI.esc(e.error_message || e.error) + '</dd>' : '') +
        (campaign ? '<dt>Campaign</dt><dd>' + UI.esc(campaign.name || campaign.id) + '</dd>' : '') +
        '</dl>';

      if (attempts.length) {
        body += '<div class="detail-section-title">Delivery attempts</div>' +
          '<table class="mini-table"><thead><tr><th>#</th><th>Time</th><th>Result</th><th>Detail</th></tr></thead><tbody>' +
          attempts.map(function (a, i) {
            return '<tr><td>' + (i + 1) + '</td>' +
              '<td class="nowrap">' + UI.esc(UI.fmt.dateTime(a.at || a.time || a.created_at)) + '</td>' +
              '<td>' + UI.statusBadge(a.status || a.result) + '</td>' +
              '<td>' + UI.esc(a.detail || a.message || a.error || '—') + '</td></tr>';
          }).join('') + '</tbody></table>';
      }

      if (provider) {
        body += '<div class="detail-section-title">Provider response</div>' +
          '<div class="json-block">' + UI.esc(typeof provider === 'string' ? provider : JSON.stringify(provider, null, 2)) + '</div>';
      }

      body += '<div class="detail-section-title">Message body</div><div id="email-body-preview"></div>';

      UI.modal({
        title: 'Email details',
        sub: e.status === 'accepted' ? 'Provider accepted this message — delivery is not confirmed yet.' : undefined,
        size: 'lg',
        body: body,
        foot: (String(e.status).toLowerCase() === 'failed'
            ? '<button class="btn btn-outline-danger" id="detail-retry"><i data-lucide="rotate-cw" class="btn-icon"></i><span>Retry send</span></button>' : '') +
            '<button class="btn btn-secondary" data-close>Close</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          var prev = box.querySelector('#email-body-preview');
          var html = e.html || e.body || e.body_html;
          prev && html && prev.appendChild(UI.previewIframe(html));
          var retryBtn = box.querySelector('#detail-retry');
          retryBtn && retryBtn.addEventListener('click', function () { close(); retryEmail(e); });
        }
      });
    }

    function retryEmail(e) {
      var id = e.id !== undefined ? e.id : e._id;
      UI.confirm({
        title: 'Retry this email?',
        message: 'The backend will queue a new attempt for <strong>' + UI.esc(e.recipient || e.to || '') + '</strong>: ' + UI.esc(e.subject || '(no subject)'),
        confirmLabel: 'Retry send'
      }).then(function (ok) {
        if (!ok) return;
        API.post(EP.retry.replace(':id', id))
          .then(function () { UI.toast('success', 'Retry queued', 'The backend accepted the retry request.'); load(); })
          .catch(function (err) {
            if (err.kind === 'NOT_FOUND') UI.toast('warning', 'Retry not supported', 'POST /api/admin/emails/:id/retry is not implemented on the backend. See README.');
            else UI.toast('error', 'Retry failed', err.message);
          });
      });
    }
  });
})();
