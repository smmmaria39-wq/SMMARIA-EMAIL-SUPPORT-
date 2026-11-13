/* ============================================================================
 * SMMARIA Email Manager — announcements.js
 * ----------------------------------------------------------------------------
 * Backend endpoints used:
 *   GET    /api/admin/announcements                  list (+search/status)
 *   POST   /api/admin/announcements                  create (draft or scheduled)
 *   PUT    /api/admin/announcements/:id              update
 *   DELETE /api/admin/announcements/:id              delete (confirm)
 *   POST   /api/admin/announcements/:id/publish      publish now (confirm + estimate)
 *   POST   /api/admin/announcements/:id/schedule     { scheduled_at }
 *   POST   /api/admin/announcements/:id/cancel       (optional)
 *   GET    /api/admin/campaigns/recipients-estimate  (optional — estimate fallback: dashboard stats)
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG, UI = window.SMMUI, API = window.SMMApi;
  var EP = CFG.ENDPOINTS.announcements;

  var state = { page: 1, limit: CFG.DEFAULT_PAGE_SIZE, search: '', status: '' };
  var quill = null;

  var TYPES = [
    { value: 'new_service',    label: 'New services' },
    { value: 'new_inventory',  label: 'New account inventory' },
    { value: 'price_change',   label: 'Service price changes' },
    { value: 'platform_update',label: 'Platform updates' },
    { value: 'offer',          label: 'Special offers' },
    { value: 'maintenance',    label: 'Maintenance notices' },
    { value: 'other',          label: 'Other' }
  ];

  document.addEventListener('DOMContentLoaded', function () {
    var tbody = document.querySelector('#ann-table tbody');
    var stateBox = document.getElementById('ann-state');
    var searchEl = document.getElementById('ann-search');
    var statusEl = document.getElementById('ann-status');

    document.getElementById('ann-create').addEventListener('click', function () { openEditor(null); });
    document.getElementById('ann-refresh').addEventListener('click', function () { load(); UI.toast('info', 'Refreshed', 'Announcements reloaded.'); });
    searchEl.addEventListener('input', UI.debounce(function () { state.search = searchEl.value.trim(); state.page = 1; load(); }, 350));
    statusEl.addEventListener('change', function () { state.status = statusEl.value; state.page = 1; load(); });
    document.getElementById('ann-clear').addEventListener('click', function () {
      state = { page: 1, limit: state.limit, search: '', status: '' };
      searchEl.value = ''; statusEl.value = '';
      load();
    });

    load();

    function load() {
      UI.skeletonRows(tbody, 6, 6);
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
            type: 'empty', icon: 'bell-ring', title: 'No announcements found',
            text: state.search || state.status ? 'Nothing matches the current filters.' : 'Draft an announcement to update your audience about services, prices or maintenance.',
            action: '<button class="btn btn-primary btn-sm" id="empty-ann-create"><i data-lucide="plus" class="btn-icon"></i><span>New announcement</span></button>'
          });
          var b = document.getElementById('empty-ann-create');
          b && b.addEventListener('click', function () { openEditor(null); });
          document.getElementById('ann-info').textContent = '';
          UI.pagination(document.getElementById('ann-pagination'), { page: 1, totalPages: 1, total: 0 });
          return;
        }
        tbody.innerHTML = items.map(rowHtml).join('');
        wireRows(items);
        document.getElementById('ann-info').textContent =
          'Showing ' + ((state.page - 1) * state.limit + 1) + '–' + Math.min(state.page * state.limit, total) + ' of ' + UI.fmt.number(total);
        UI.pagination(document.getElementById('ann-pagination'), {
          page: state.page, totalPages: totalPages, total: total,
          onPage: function (p) { state.page = p; load(); }
        });
        if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
      }).catch(function (err) {
        tbody.innerHTML = '';
        UI.renderState(stateBox, { type: 'error', title: 'Could not load announcements', error: err, retry: load });
      });
    }

    function typeLabel(v) {
      var t = TYPES.find(function (x) { return x.value === String(v || '').toLowerCase(); });
      return t ? t.label : (v || 'other');
    }

    function rowHtml(a) {
      var id = a.id !== undefined ? a.id : a._id;
      var status = String(a.status || 'draft').toLowerCase();
      return '<tr data-id="' + UI.esc(id) + '">' +
        '<td><div class="cell-main truncate" style="max-width:240px">' + UI.esc(a.title || a.name || 'Untitled') + '</div>' +
          (a.scheduled_at ? '<div class="cell-sub">Scheduled: ' + UI.esc(UI.fmt.dateTime(a.scheduled_at)) + '</div>' : '') + '</td>' +
        '<td><span class="badge badge-purple">' + UI.esc(typeLabel(a.type)) + '</span></td>' +
        '<td>' + UI.statusBadge(a.status) + '</td>' +
        '<td class="cell-num">' + UI.fmt.number(a.recipients_count || a.recipient_count || (a.stats && a.stats.recipients)) + '</td>' +
        '<td class="cell-muted nowrap">' + UI.esc(UI.fmt.date(a.created_at)) + '</td>' +
        '<td class="td-actions"><div class="row-actions">' +
          '<button class="icon-btn" data-act="menu" aria-label="Announcement actions" style="width:34px;height:34px"><i data-lucide="more-horizontal"></i></button>' +
        '</div></td></tr>';
    }

    function wireRows(items) {
      var tbody = document.querySelector('#ann-table tbody');
      tbody.querySelectorAll('tr').forEach(function (tr) {
        var id = tr.getAttribute('data-id');
        var a = items.find(function (x) { return String(x.id !== undefined ? x.id : x._id) === String(id); });
        if (!a) return;
        tr.querySelector('[data-act="menu"]').addEventListener('click', function (e) {
          e.stopPropagation();
          openRowMenu(tr, a);
        });
      });
      document.addEventListener('click', function () {
        document.querySelectorAll('.row-menu').forEach(function (m) { m.remove(); });
      });
    }

    function openRowMenu(tr, a) {
      document.querySelectorAll('.row-menu').forEach(function (m) { m.remove(); });
      var id = a.id !== undefined ? a.id : a._id;
      var status = String(a.status || 'draft').toLowerCase();
      var menu = document.createElement('div');
      menu.className = 'row-menu';
      menu.innerHTML =
        '<button type="button" class="menu-item" data-mact="view"><i data-lucide="eye"></i><span>Preview</span></button>' +
        '<button type="button" class="menu-item" data-mact="edit"><i data-lucide="pencil"></i><span>Edit</span></button>' +
        (status === 'draft' || status === 'cancelled' || status === 'failed'
          ? '<button type="button" class="menu-item" data-mact="publish"><i data-lucide="send"></i><span>Publish now…</span></button>' +
            '<button type="button" class="menu-item" data-mact="schedule"><i data-lucide="calendar-clock"></i><span>Schedule…</span></button>' : '') +
        (status === 'scheduled'
          ? '<button type="button" class="menu-item danger" data-mact="cancel"><i data-lucide="x-circle"></i><span>Cancel schedule</span></button>' : '') +
        '<button type="button" class="menu-item danger" data-mact="delete"><i data-lucide="trash-2"></i><span>Delete</span></button>';

      tr.querySelector('.td-actions .row-actions').style.position = 'relative';
      tr.querySelector('.td-actions .row-actions').appendChild(menu);
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });

      menu.addEventListener('click', function (e) { e.stopPropagation(); });
      menu.querySelectorAll('[data-mact]').forEach(function (b) {
        b.addEventListener('click', function () {
          menu.remove();
          var act = b.getAttribute('data-mact');
          if (act === 'view') previewAnnouncement(a);
          else if (act === 'edit') openEditor(a);
          else if (act === 'publish') publish(a);
          else if (act === 'schedule') schedule(a);
          else if (act === 'cancel') cancel(a);
          else if (act === 'delete') del(a);
        });
      });
    }

    /* ---------------------------------------------------------------- */
    function previewAnnouncement(a) {
      UI.modal({
        title: a.title || 'Announcement',
        sub: typeLabel(a.type),
        size: 'lg',
        body: '<div class="preview-meta"><div><b>Title:</b> ' + UI.esc(a.title || '') + '</div>' +
              '<div><b>Status:</b> ' + UI.statusBadge(a.status) + '</div></div>',
        onOpen: function (box) {
          box.querySelector('.modal-body').appendChild(UI.previewIframe(a.html || a.content || a.body || ''));
        }
      });
    }

    function publish(a) {
      estimateRecipients().then(function (count) {
        UI.confirm({
          title: 'Publish this announcement?',
          message:
            '<strong>' + UI.esc(a.title || 'Untitled') + '</strong> will be sent immediately.<br/><br/>' +
            'Estimated recipients: <strong>' + (count === null ? 'unknown (estimate unavailable)' : UI.fmt.number(count)) + '</strong><br/>' +
            'Suppressed and unsubscribed addresses are skipped by the backend.',
          confirmLabel: 'Publish now', danger: true
        }).then(function (ok) {
          if (!ok) return;
          var id = a.id !== undefined ? a.id : a._id;
          API.post(EP.publish.replace(':id', id))
            .then(function () { UI.toast('success', 'Announcement published', 'The backend started sending.'); load(); })
            .catch(function (err) { UI.toast('error', 'Publish failed', err.message); });
        });
      });
    }

    function schedule(a) {
      var id = a.id !== undefined ? a.id : a._id;
      UI.modal({
        title: 'Schedule announcement',
        body: '<div class="form-group"><label class="form-label">Date &amp; time *</label>' +
              '<input type="datetime-local" class="form-input" id="ann-sched-at"/></div>',
        foot: '<button class="btn btn-secondary" data-close>Cancel</button>' +
              '<button class="btn btn-primary" id="ann-sched-save">Schedule</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          box.querySelector('#ann-sched-save').addEventListener('click', function () {
            var v = box.querySelector('#ann-sched-at').value;
            if (!v) { UI.toast('warning', 'Pick a date', 'Choose a future date and time.'); return; }
            var when = new Date(v);
            if (when.getTime() <= Date.now()) { UI.toast('warning', 'Invalid time', 'The scheduled time must be in the future.'); return; }
            API.post(EP.schedule.replace(':id', id), { scheduled_at: when.toISOString() })
              .then(function () { close(); UI.toast('success', 'Announcement scheduled', 'For ' + UI.fmt.dateTime(when.toISOString())); load(); })
              .catch(function (err) { UI.toast('error', 'Scheduling failed', err.message); });
          });
        }
      });
    }

    function cancel(a) {
      var id = a.id !== undefined ? a.id : a._id;
      UI.confirm({ title: 'Cancel scheduled announcement?', message: '<strong>' + UI.esc(a.title || 'Announcement') + '</strong> will not be sent.', confirmLabel: 'Cancel announcement' })
        .then(function (ok) {
          if (!ok) return;
          API.post(EP.cancel.replace(':id', id))
            .then(function () { UI.toast('success', 'Schedule cancelled', ''); load(); })
            .catch(function (err) {
              if (err.kind === 'NOT_FOUND') UI.toast('warning', 'Not supported', 'The cancel endpoint is not implemented on the backend.');
              else UI.toast('error', 'Could not cancel', err.message);
            });
        });
    }

    function del(a) {
      var id = a.id !== undefined ? a.id : a._id;
      UI.confirm({
        title: 'Delete announcement?',
        message: 'Permanently deletes <strong>' + UI.esc(a.title || 'this announcement') + '</strong>.',
        confirmLabel: 'Delete', danger: true, requireText: 'DELETE'
      }).then(function (ok) {
        if (!ok) return;
        API.del(EP.delete.replace(':id', id))
          .then(function () { UI.toast('success', 'Announcement deleted', ''); load(); })
          .catch(function (err) { UI.toast('error', 'Delete failed', err.message); });
      });
    }

    function estimateRecipients() {
      // Backend exposes POST /campaigns/estimate and reads segment from req.query.
      return API.post(CFG.ENDPOINTS.campaigns.recipients, {}, { query: { segment: 'active' } })
        .then(function (r) {
          var v = typeof r === 'number' ? r : (r && (r.count || r.total || r.recipients));
          if (v === undefined || v === null) throw new Error('no count');
          return v;
        })
        .catch(function () {
          return API.get(CFG.ENDPOINTS.dashboard.stats)
            .then(function (s) { return (s.active_subscribers !== undefined ? s.active_subscribers : null); })
            .catch(function () { return null; });
        });
    }

    /* ---------------------------------------------------------------- */
    function openEditor(existing) {
      var isEdit = !!existing;
      UI.modal({
        title: isEdit ? 'Edit announcement' : 'New announcement',
        sub: isEdit ? 'Saved changes are not sent automatically — publish separately.' : 'Created as a draft. Publish or schedule it from the action menu.',
        size: 'lg',
        body:
          '<div class="form-group"><label class="form-label">Title *</label>' +
          '<input type="text" class="form-input" id="ann-title" maxlength="150" placeholder="e.g. New VPN inventory available"/></div>' +
          '<div class="form-grid-2">' +
            '<div class="form-group"><label class="form-label">Type</label>' +
            '<select class="form-input" id="ann-type">' +
              TYPES.map(function (t) { return '<option value="' + UI.esc(t.value) + '">' + UI.esc(t.label) + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="form-group"><label class="form-label">Audience segment</label>' +
            '<select class="form-input" id="ann-segment">' +
              CFG.SEGMENTS.map(function (s) { return '<option value="' + UI.esc(s.value) + '">' + UI.esc(s.label) + '</option>'; }).join('') +
            '</select></div>' +
          '</div>' +
          '<div class="form-group"><label class="form-label">Message (HTML) *</label>' +
          '<div id="ann-editor"></div></div>',
        foot:
          '<button class="btn btn-secondary" data-close>Cancel</button>' +
          '<button class="btn btn-primary" id="ann-save"><span class="btn-spinner hidden"></span><i data-lucide="save" class="btn-icon"></i><span>' + (isEdit ? 'Save changes' : 'Create draft') + '</span></button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          var editorEl = box.querySelector('#ann-editor');
          var localQuill = null;

          if (typeof Quill !== 'undefined') {
            localQuill = new Quill(editorEl, {
              theme: 'snow',
              placeholder: 'Write the announcement…',
              modules: { toolbar: [[{ header: [1, 2, 3, false] }], ['bold', 'italic', 'underline', 'link'], [{ list: 'ordered' }, { list: 'bullet' }], ['clean']] }
            });
            editorEl.style.minHeight = '180px';
          } else {
            editorEl.innerHTML = '<textarea class="form-input code-editor" id="ann-editor-fallback" rows="10"></textarea>';
          }

          if (isEdit) {
            box.querySelector('#ann-title').value = existing.title || existing.name || '';
            box.querySelector('#ann-type').value = existing.type || 'other';
            box.querySelector('#ann-segment').value = existing.segment || 'all';
            var html = existing.html || existing.content || existing.body || '';
            if (localQuill) localQuill.root.innerHTML = html;
            else box.querySelector('#ann-editor-fallback').value = html;
          }

          box.querySelector('#ann-save').addEventListener('click', function () {
            var title = box.querySelector('#ann-title').value.trim();
            if (!title) { box.querySelector('#ann-title').classList.add('input-invalid'); UI.toast('warning', 'Title required', ''); return; }
            var html = localQuill ? localQuill.root.innerHTML : (box.querySelector('#ann-editor-fallback') || {}).value || '';

            var payload = {
              title: title,
              type: box.querySelector('#ann-type').value,
              segment: box.querySelector('#ann-segment').value,
              html: html,
              status: 'draft'
            };

            var btn = this;
            btn.disabled = true;
            btn.querySelector('.btn-spinner').classList.remove('hidden');

            var req = isEdit
              ? API.put(EP.update.replace(':id', existing.id !== undefined ? existing.id : existing._id), payload)
              : API.post(EP.create, payload);

            req.then(function () {
              close();
              UI.toast('success', isEdit ? 'Announcement updated' : 'Announcement created', 'Use the action menu to publish or schedule.');
              load();
            }).catch(function (err) {
              btn.disabled = false;
              btn.querySelector('.btn-spinner').classList.add('hidden');
              UI.toast('error', isEdit ? 'Update failed' : 'Creation failed', err.message);
            });
          });
        }
      });
    }
  });
})();
