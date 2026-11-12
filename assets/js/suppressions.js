/* ============================================================================
 * SMMARIA Email Manager — suppressions.js
 * ----------------------------------------------------------------------------
 * Backend endpoints used:
 *   GET    /api/admin/suppressions          list (+search/reason/pagination)
 *   POST   /api/admin/suppressions          { email, reason, note? }
 *   DELETE /api/admin/suppressions/:id      remove (confirm, backend-authorized)
 *
 * Policy: the backend enforces suppression on every send. Removing an entry
 * requires backend authorization; the frontend only relays the request and
 * surfaces the backend's decision.
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG, UI = window.SMMUI, API = window.SMMApi;
  var EP = CFG.ENDPOINTS.suppressions;

  var state = { page: 1, limit: CFG.DEFAULT_PAGE_SIZE, search: '', reason: '' };

  document.addEventListener('DOMContentLoaded', function () {
    var tbody = document.querySelector('#supp-table tbody');
    var stateBox = document.getElementById('supp-state');
    var searchEl = document.getElementById('supp-search');
    var reasonEl = document.getElementById('supp-reason');

    document.getElementById('supp-add').addEventListener('click', openAdd);
    document.getElementById('supp-refresh').addEventListener('click', function () { load(); UI.toast('info', 'Refreshed', 'Suppression list reloaded.'); });
    searchEl.addEventListener('input', UI.debounce(function () { state.search = searchEl.value.trim(); state.page = 1; load(); }, 350));
    reasonEl.addEventListener('change', function () { state.reason = reasonEl.value; state.page = 1; load(); });
    document.getElementById('supp-clear').addEventListener('click', function () {
      state = { page: 1, limit: state.limit, search: '', reason: '' };
      searchEl.value = ''; reasonEl.value = '';
      load();
    });

    load();

    function load() {
      UI.skeletonRows(tbody, 6, 6);
      UI.renderState(stateBox, { type: 'clear' });

      API.get(EP.list, {
        page: state.page, limit: state.limit,
        search: state.search || undefined,
        reason: state.reason || undefined
      }).then(function (payload) {
        var items = UI.extractList(payload);
        var total = UI.extractTotal(payload, items.length);
        var totalPages = UI.extractTotalPages(payload, total, state.limit);
        if (!items.length) {
          tbody.innerHTML = '';
          UI.renderState(stateBox, {
            type: 'empty', icon: 'shield-check', title: 'No suppressions found',
            text: state.search || state.reason ? 'Nothing matches the current filters.' : 'A clean suppression list. Addresses are added automatically on hard bounces, spam complaints and unsubscribes.'
          });
          document.getElementById('supp-info').textContent = '';
          UI.pagination(document.getElementById('supp-pagination'), { page: 1, totalPages: 1, total: 0 });
          return;
        }
        tbody.innerHTML = items.map(rowHtml).join('');
        wireRows(items);
        document.getElementById('supp-info').textContent =
          'Showing ' + ((state.page - 1) * state.limit + 1) + '–' + Math.min(state.page * state.limit, total) + ' of ' + UI.fmt.number(total) + ' entries';
        UI.pagination(document.getElementById('supp-pagination'), {
          page: state.page, totalPages: totalPages, total: total,
          onPage: function (p) { state.page = p; load(); }
        });
        if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
      }).catch(function (err) {
        tbody.innerHTML = '';
        UI.renderState(stateBox, { type: 'error', title: 'Could not load suppressions', error: err, retry: load });
      });
    }

    function rowHtml(s) {
      var id = s.id !== undefined ? s.id : s._id;
      return '<tr data-id="' + UI.esc(id) + '">' +
        '<td><div class="cell-main">' + UI.esc(s.email || s.address || '—') + '</div></td>' +
        '<td>' + UI.statusBadge(s.reason) + (s.note ? '<div class="cell-sub">' + UI.esc(s.note) + '</div>' : '') + '</td>' +
        '<td>' + UI.esc(s.source || s.created_by || 'system') + '</td>' +
        '<td class="cell-muted nowrap">' + UI.esc(UI.fmt.date(s.created_at || s.added_at)) + '</td>' +
        '<td>' + (s.active === false
            ? '<span class="badge badge-neutral">inactive</span>'
            : '<span class="badge badge-success">active</span>') + '</td>' +
        '<td class="td-actions"><div class="row-actions">' +
          '<button class="icon-btn" data-act="view" title="Details" style="width:32px;height:32px"><i data-lucide="eye"></i></button>' +
          '<button class="icon-btn" data-act="remove" title="Remove suppression" style="width:32px;height:32px;color:var(--c-danger)"><i data-lucide="trash-2"></i></button>' +
        '</div></td></tr>';
    }

    function wireRows(items) {
      var tbody = document.querySelector('#supp-table tbody');
      tbody.querySelectorAll('tr').forEach(function (tr) {
        var id = tr.getAttribute('data-id');
        var s = items.find(function (x) { return String(x.id !== undefined ? x.id : x._id) === String(id); });
        if (!s) return;
        tr.querySelector('[data-act="view"]').addEventListener('click', function () { viewEntry(s); });
        tr.querySelector('[data-act="remove"]').addEventListener('click', function () { removeEntry(s); });
      });
    }

    function viewEntry(s) {
      UI.modal({
        title: 'Suppression details',
        size: 'sm',
        body:
          '<dl class="detail-grid">' +
          '<dt>Email</dt><dd>' + UI.esc(s.email || s.address || '—') + '</dd>' +
          '<dt>Reason</dt><dd>' + UI.statusBadge(s.reason) + '</dd>' +
          '<dt>Source</dt><dd>' + UI.esc(s.source || s.created_by || 'system') + '</dd>' +
          '<dt>Added</dt><dd>' + UI.esc(UI.fmt.dateTime(s.created_at || s.added_at)) + '</dd>' +
          '<dt>Status</dt><dd>' + (s.active === false ? 'inactive' : 'active — backend blocks all email to this address') + '</dd>' +
          (s.note ? '<dt>Note</dt><dd>' + UI.esc(s.note) + '</dd>' : '') +
          '</dl>',
        foot: '<button class="btn btn-secondary" data-close>Close</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
        }
      });
    }

    function removeEntry(s) {
      var id = s.id !== undefined ? s.id : s._id;
      var email = s.email || s.address || '';
      UI.confirm({
        title: 'Remove suppression?',
        message:
          'The backend will stop blocking <strong>' + UI.esc(email) + '</strong> for <em>future</em> sends.<br/><br/>' +
          'Only do this if the address is verified and wants to receive email again. If the suppression came from a spam complaint or hard bounce, removing it can hurt deliverability. The backend may reject this request based on your permissions.',
        confirmLabel: 'Remove suppression', danger: true, requireText: 'REMOVE'
      }).then(function (ok) {
        if (!ok) return;
        API.del(EP.remove.replace(':id', id))
          .then(function () { UI.toast('success', 'Suppression removed', email + ' can receive email again (backend-authorized).'); load(); })
          .catch(function (err) {
            if (err.kind === 'FORBIDDEN') UI.toast('error', 'Not authorized', 'The backend refused to remove this suppression with your account permissions.');
            else UI.toast('error', 'Could not remove suppression', err.message);
          });
      });
    }

    function openAdd() {
      UI.modal({
        title: 'Add suppression',
        sub: 'The address will be blocked from every send path — campaigns, automations, announcements and manual email.',
        size: 'sm',
        body:
          '<div class="form-group"><label class="form-label">Email address *</label>' +
          '<input type="email" class="form-input" id="supp-email" autocomplete="off" spellcheck="false"/></div>' +
          '<div class="form-group"><label class="form-label">Reason *</label>' +
          '<select class="form-input" id="supp-new-reason">' +
            '<option value="admin_blocked">Administrator blocked</option>' +
            '<option value="invalid">Invalid address</option>' +
            '<option value="unsubscribed">Unsubscribed</option>' +
            '<option value="spam_complaint">Spam complaint</option>' +
            '<option value="hard_bounce">Hard bounce</option>' +
          '</select></div>' +
          '<div class="form-group"><label class="form-label">Note</label>' +
          '<input type="text" class="form-input" id="supp-note" maxlength="200" placeholder="Why is this address blocked?"/></div>',
        foot:
          '<button class="btn btn-secondary" data-close>Cancel</button>' +
          '<button class="btn btn-primary" id="supp-save">Add suppression</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          box.querySelector('#supp-save').addEventListener('click', function () {
            var email = box.querySelector('#supp-email').value.trim().toLowerCase();
            var reason = box.querySelector('#supp-new-reason').value;
            var note = box.querySelector('#supp-note').value.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              box.querySelector('#supp-email').classList.add('input-invalid');
              UI.toast('warning', 'Invalid email', 'Check the address format.');
              return;
            }
            var btn = this;
            btn.disabled = true;
            API.post(EP.create, { email: email, reason: reason, note: note || undefined })
              .then(function () { close(); UI.toast('success', 'Suppression added', email + ' is now blocked by the backend.'); load(); })
              .catch(function (err) { btn.disabled = false; UI.toast('error', 'Could not add suppression', err.message); });
          });
        }
      });
    }
  });
})();
