/* ============================================================================
 * SMMARIA Email Manager — subscribers.js
 * ----------------------------------------------------------------------------
 * Backend endpoints used:
 *   GET    /api/admin/subscribers            list (+filters/pagination)
 *   POST   /api/admin/subscribers            create
 *   GET    /api/admin/subscribers/:id        detail
 *   PUT    /api/admin/subscribers/:id        update
 *   DELETE /api/admin/subscribers/:id        delete (confirm)
 *   GET    /api/admin/subscribers/export     CSV download (optional)
 *   POST   /api/admin/subscribers/import     CSV upload (optional)
 *   POST   /api/admin/subscribers/bulk       { action, ids[] } (optional)
 *
 * Suppression respect: unsubscribed / complained / bounced subscribers are
 * clearly labelled; manual selection can never force email to them — that is
 * enforced by the backend and echoed in the UI.
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG, UI = window.SMMUI, API = window.SMMApi;
  var EP = CFG.ENDPOINTS.subscribers;

  var state = { page: 1, limit: CFG.DEFAULT_PAGE_SIZE, search: '', status: '', from: '', to: '' };
  var selected = {}; // id -> true

  document.addEventListener('DOMContentLoaded', function () {
    var tbody = document.querySelector('#subs-table tbody');
    var stateBox = document.getElementById('subs-state');
    var searchEl = document.getElementById('subs-search');
    var statusEl = document.getElementById('subs-status');
    var fromEl = document.getElementById('subs-from');
    var toEl = document.getElementById('subs-to');
    var checkAll = document.getElementById('subs-check-all');

    document.getElementById('subs-add').addEventListener('click', function () { openEditor(null); });
    document.getElementById('subs-export').addEventListener('click', exportCsv);
    document.getElementById('subs-import').addEventListener('click', openImport);
    document.getElementById('subs-bulk-clear').addEventListener('click', function () {
      selected = {}; checkAll.checked = false; updateBulkBar();
      tbody.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { cb.checked = false; });
    });
    document.getElementById('subs-bulk-delete').addEventListener('click', function () { bulkAction('delete'); });
    document.getElementById('subs-bulk-unsubscribe').addEventListener('click', function () { bulkAction('unsubscribe'); });
    document.getElementById('subs-bulk-resubscribe').addEventListener('click', function () { bulkAction('resubscribe'); });

    searchEl.addEventListener('input', UI.debounce(function () { state.search = searchEl.value.trim(); state.page = 1; load(); }, 350));
    statusEl.addEventListener('change', function () { state.status = statusEl.value; state.page = 1; load(); });
    fromEl.addEventListener('change', function () { state.from = fromEl.value; state.page = 1; load(); });
    toEl.addEventListener('change', function () { state.to = toEl.value; state.page = 1; load(); });
    document.getElementById('subs-clear').addEventListener('click', function () {
      state = { page: 1, limit: state.limit, search: '', status: '', from: '', to: '' };
      searchEl.value = ''; statusEl.value = ''; fromEl.value = ''; toEl.value = '';
      load();
    });

    checkAll.addEventListener('change', function () {
      tbody.querySelectorAll('input[data-id]').forEach(function (cb) {
        cb.checked = checkAll.checked && !cb.disabled;
        var id = cb.getAttribute('data-id');
        if (cb.checked) selected[id] = true; else delete selected[id];
      });
      updateBulkBar();
    });

    load();

    /* ---------------------------------------------------------------- */
    function load() {
      UI.skeletonRows(tbody, 7, 6);
      UI.renderState(stateBox, { type: 'clear' });

      API.get(EP.list, {
        page: state.page, limit: state.limit,
        search: state.search || undefined,
        status: state.status || undefined,
        from: state.from || undefined,
        to: state.to || undefined
      }).then(function (payload) {
        var items = UI.extractList(payload);
        var total = UI.extractTotal(payload, items.length);
        var totalPages = UI.extractTotalPages(payload, total, state.limit);
        if (!items.length) {
          tbody.innerHTML = '';
          UI.renderState(stateBox, {
            type: 'empty', icon: 'users', title: 'No subscribers found',
            text: state.search || state.status ? 'No subscribers match the current filters.' : 'Import a CSV or add subscribers manually.',
            action: '<button class="btn btn-secondary btn-sm" id="empty-import"><i data-lucide="upload" class="btn-icon"></i><span>Import CSV</span></button>' +
                    '<button class="btn btn-primary btn-sm" id="empty-add"><i data-lucide="user-plus" class="btn-icon"></i><span>Add subscriber</span></button>'
          });
          var bi = document.getElementById('empty-import'); bi && bi.addEventListener('click', openImport);
          var ba = document.getElementById('empty-add'); ba && ba.addEventListener('click', function () { openEditor(null); });
          document.getElementById('subs-info').textContent = '';
          UI.pagination(document.getElementById('subs-pagination'), { page: 1, totalPages: 1, total: 0 });
          return;
        }
        tbody.innerHTML = items.map(rowHtml).join('');
        wireRows(items);
        document.getElementById('subs-info').textContent =
          'Showing ' + ((state.page - 1) * state.limit + 1) + '–' + Math.min(state.page * state.limit, total) + ' of ' + UI.fmt.number(total) + ' subscribers';
        UI.pagination(document.getElementById('subs-pagination'), {
          page: state.page, totalPages: totalPages, total: total,
          onPage: function (p) { state.page = p; load(); }
        });
        updateBulkBar();
        if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
      }).catch(function (err) {
        tbody.innerHTML = '';
        UI.renderState(stateBox, { type: 'error', title: 'Could not load subscribers', error: err, retry: load });
      });
    }

    function rowHtml(s) {
      var id = s.id !== undefined ? s.id : s._id;
      var status = String(s.status || 'active').toLowerCase();
      var blocked = status === 'unsubscribed' || status === 'complained' || status === 'bounced' || s.suppressed === true;
      return '<tr data-id="' + UI.esc(id) + '">' +
        '<td class="td-check"><input type="checkbox" data-id="' + UI.esc(id) + '"' + (selected[id] ? ' checked' : '') + '/></td>' +
        '<td><div class="cell-main">' + UI.esc(s.email || s.address || '—') + '</div>' +
          (blocked ? '<div class="cell-sub">Cannot receive marketing email' + (s.suppressed ? ' · suppressed' : '') + '</div>' : '') + '</td>' +
        '<td>' + UI.esc(s.name || s.full_name || s.first_name || '—') + '</td>' +
        '<td>' + UI.statusBadge(s.status) + (s.tags ? '<div class="cell-sub">' + UI.esc(String(s.tags)) + '</div>' : '') + '</td>' +
        '<td class="cell-muted nowrap">' + UI.esc(UI.fmt.date(s.subscribed_at || s.created_at || s.registered_at)) + '</td>' +
        '<td class="cell-muted nowrap">' + UI.esc(s.last_email_at ? UI.fmt.timeAgo(s.last_email_at) : '—') + '</td>' +
        '<td class="td-actions">' +
          '<div class="row-actions">' +
            '<button class="icon-btn" data-act="view" title="Details" style="width:32px;height:32px"><i data-lucide="eye"></i></button>' +
            '<button class="icon-btn" data-act="edit" title="Edit" style="width:32px;height:32px"><i data-lucide="pencil"></i></button>' +
            '<button class="icon-btn" data-act="delete" title="Delete" style="width:32px;height:32px;color:var(--c-danger)"><i data-lucide="trash-2"></i></button>' +
          '</div>' +
        '</td></tr>';
    }

    function wireRows(items) {
      var tbody = document.querySelector('#subs-table tbody');
      tbody.querySelectorAll('tr').forEach(function (tr) {
        var id = tr.getAttribute('data-id');
        var s = items.find(function (x) { return String(x.id !== undefined ? x.id : x._id) === String(id); });
        if (!s) return;

        tr.querySelector('input[data-id]').addEventListener('change', function (e) {
          if (e.target.checked) selected[id] = true; else delete selected[id];
          updateBulkBar();
        });
        tr.querySelector('[data-act="view"]').addEventListener('click', function () { viewSubscriber(s); });
        tr.querySelector('[data-act="edit"]').addEventListener('click', function () { openEditor(s); });
        tr.querySelector('[data-act="delete"]').addEventListener('click', function () { deleteSubscriber(s); });
      });
    }

    function updateBulkBar() {
      var count = Object.keys(selected).length;
      var bar = document.getElementById('subs-bulkbar');
      bar.classList.toggle('hidden', count === 0);
      document.getElementById('subs-bulk-count').textContent = count;
    }

    /* ---------------------------------------------------------------- */
    function viewSubscriber(s) {
      var id = s.id !== undefined ? s.id : s._id;
      API.get(EP.get, null, { repl: { id: id } })
        .then(function (full) { showDetail(full || s); })
        .catch(function (err) {
          if (err.kind === 'NOT_FOUND') showDetail(s);
          else UI.toast('error', 'Could not load details', err.message);
        });
    }

    function showDetail(s) {
      UI.modal({
        title: s.email || 'Subscriber',
        sub: 'Subscriber details',
        body:
          '<dl class="detail-grid">' +
          '<dt>ID</dt><dd class="mono">' + UI.esc(s.id !== undefined ? s.id : (s._id || '—')) + '</dd>' +
          '<dt>Email</dt><dd>' + UI.esc(s.email || s.address || '—') + '</dd>' +
          '<dt>Name</dt><dd>' + UI.esc(s.name || s.full_name || '—') + '</dd>' +
          '<dt>Status</dt><dd>' + UI.statusBadge(s.status) + '</dd>' +
          '<dt>Suppressed</dt><dd>' + (s.suppressed ? 'Yes — excluded from all sends' : 'No') + '</dd>' +
          '<dt>Subscribed</dt><dd>' + UI.esc(UI.fmt.dateTime(s.subscribed_at || s.created_at || s.registered_at)) + '</dd>' +
          '<dt>Last email activity</dt><dd>' + UI.esc(s.last_email_at ? UI.fmt.dateTime(s.last_email_at) : '—') + '</dd>' +
          (s.tags ? '<dt>Tags</dt><dd>' + UI.esc(String(s.tags)) + '</dd>' : '') +
          (s.unsubscribe_reason ? '<dt>Unsubscribe reason</dt><dd>' + UI.esc(s.unsubscribe_reason) + '</dd>' : '') +
          '</dl>',
        foot: '<button class="btn btn-secondary" data-close>Close</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
        }
      });
    }

    function openEditor(existing) {
      var isEdit = !!existing;
      UI.modal({
        title: isEdit ? 'Edit subscriber' : 'Add subscriber',
        sub: isEdit ? 'Update subscription details.' : 'The address is added with active status unless the backend decides otherwise.',
        size: 'sm',
        body:
          '<div class="form-group"><label class="form-label">Email address *</label>' +
          '<input type="email" class="form-input" id="sub-email" autocomplete="off" spellcheck="false"/></div>' +
          '<div class="form-group"><label class="form-label">Name</label>' +
          '<input type="text" class="form-input" id="sub-name"/></div>' +
          '<div class="form-group"><label class="form-label">Status</label>' +
          '<select class="form-input" id="sub-status">' +
            '<option value="active">Active</option>' +
            '<option value="unsubscribed">Unsubscribed</option>' +
          '</select>' +
          '<p class="form-hint">Bounced / complained states are managed by the backend from delivery events.</p></div>',
        foot:
          '<button class="btn btn-secondary" data-close>Cancel</button>' +
          '<button class="btn btn-primary" id="sub-save">' + (isEdit ? 'Save changes' : 'Add subscriber') + '</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          if (isEdit) {
            box.querySelector('#sub-email').value = existing.email || existing.address || '';
            box.querySelector('#sub-name').value = existing.name || existing.full_name || '';
            box.querySelector('#sub-status').value = String(existing.status || 'active').toLowerCase() === 'unsubscribed' ? 'unsubscribed' : 'active';
          }
          box.querySelector('#sub-save').addEventListener('click', function () {
            var email = box.querySelector('#sub-email').value.trim().toLowerCase();
            var name = box.querySelector('#sub-name').value.trim();
            var status = box.querySelector('#sub-status').value;
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              box.querySelector('#sub-email').classList.add('input-invalid');
              UI.toast('warning', 'Invalid email', 'Check the email address format.');
              return;
            }
            var btn = this;
            btn.disabled = true;
            var payload = { email: email, name: name || undefined, status: status };
            var req = isEdit
              ? API.put(EP.update.replace(':id', existing.id !== undefined ? existing.id : existing._id), payload)
              : API.post(EP.create, payload);
            req.then(function () {
              close();
              UI.toast('success', isEdit ? 'Subscriber updated' : 'Subscriber added', email);
              load();
            }).catch(function (err) {
              btn.disabled = false;
              UI.toast('error', isEdit ? 'Update failed' : 'Could not add subscriber', err.message);
            });
          });
        }
      });
    }

    function deleteSubscriber(s) {
      var id = s.id !== undefined ? s.id : s._id;
      var email = s.email || s.address || 'this subscriber';
      UI.confirm({
        title: 'Delete subscriber?',
        message: 'Removes <strong>' + UI.esc(email) + '</strong> from the audience. Past email history is kept. If the address should never receive email again, add a suppression instead.',
        confirmLabel: 'Delete subscriber', danger: true
      }).then(function (ok) {
        if (!ok) return;
        API.del(EP.delete.replace(':id', id))
          .then(function () { UI.toast('success', 'Subscriber deleted', email); load(); })
          .catch(function (err) { UI.toast('error', 'Delete failed', err.message); });
      });
    }

    function bulkAction(action) {
      var ids = Object.keys(selected);
      if (!ids.length) return;
      var labels = {
        delete: ['Delete subscribers?', 'Permanently removes the selected subscribers from the audience.', 'Delete'],
        unsubscribe: ['Unsubscribe selected?', 'They will stop receiving campaigns; the backend keeps a record.', 'Unsubscribe'],
        resubscribe: ['Re-subscribe selected?', 'Only allowed when the backend permits re-subscription for these addresses.', 'Re-subscribe']
      }[action];

      UI.confirm({
        title: labels[0],
        message: labels[1] + '<br/><br/><strong>' + ids.length + '</strong> subscriber(s) selected.',
        confirmLabel: labels[2], danger: action === 'delete',
        requireText: action === 'delete' ? 'DELETE' : undefined
      }).then(function (ok) {
        if (!ok) return;
        API.post(EP.bulk, { action: action, ids: ids })
          .then(function () {
            UI.toast('success', 'Bulk action applied', ids.length + ' subscriber(s) updated.');
            selected = {}; updateBulkBar(); load();
          })
          .catch(function (err) {
            if (err.kind === 'NOT_FOUND') UI.toast('warning', 'Not supported', 'POST /api/admin/subscribers/bulk is not implemented on the backend. See README.');
            else UI.toast('error', 'Bulk action failed', err.message);
          });
      });
    }

    /* ---------------------------------------------------------------- */
    function exportCsv() {
      UI.toast('info', 'Preparing export…', 'Requesting CSV from the backend.');
      API.download(EP.export, null, 'smmaria-subscribers-' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv')
        .then(function () { UI.toast('success', 'Export ready', 'The CSV file has been downloaded.'); })
        .catch(function (err) {
          if (err.kind === 'NOT_FOUND') UI.toast('warning', 'Export not supported', 'GET /api/admin/subscribers/export is not implemented on the backend. See README.');
          else UI.toast('error', 'Export failed', err.message);
        });
    }

    function openImport() {
      UI.modal({
        title: 'Import subscribers',
        sub: 'Upload a CSV file. Expected columns: email (required), name (optional). One subscriber per line.',
        size: 'sm',
        body:
          '<div class="form-group">' +
          '<label class="form-label">CSV file *</label>' +
          '<input type="file" class="form-input" id="import-file" accept=".csv,text/csv"/>' +
          '<p class="form-hint">Duplicate handling and validation are performed by the backend.</p>' +
          '</div>' +
          '<div id="import-result"></div>',
        foot:
          '<button class="btn btn-secondary" data-close>Cancel</button>' +
          '<button class="btn btn-primary" id="import-go">Upload &amp; import</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          box.querySelector('#import-go').addEventListener('click', function () {
            var fileInput = box.querySelector('#import-file');
            var file = fileInput.files && fileInput.files[0];
            if (!file) { UI.toast('warning', 'Choose a file', 'Select a CSV file first.'); return; }
            if (file.size > 5 * 1024 * 1024) { UI.toast('warning', 'File too large', 'Maximum CSV size is 5 MB.'); return; }
            var btn = this;
            btn.disabled = true;
            var fd = new FormData();
            fd.append('file', file);
            API.upload(EP.import, fd)
              .then(function (res) {
                close();
                var r = res || {};
                UI.toast('success', 'Import finished',
                  'Created: ' + (r.created !== undefined ? r.created : '?') +
                  ' · Updated: ' + (r.updated !== undefined ? r.updated : '?') +
                  ' · Skipped: ' + (r.skipped !== undefined ? r.skipped : '?'));
                load();
              })
              .catch(function (err) {
                btn.disabled = false;
                if (err.kind === 'NOT_FOUND') UI.toast('warning', 'Import not supported', 'POST /api/admin/subscribers/import is not implemented on the backend. See README.');
                else UI.toast('error', 'Import failed', err.message);
              });
          });
        }
      });
    }
  });
})();
