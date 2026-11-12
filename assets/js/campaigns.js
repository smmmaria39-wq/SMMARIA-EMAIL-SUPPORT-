/* ============================================================================
 * SMMARIA Email Manager — campaigns.js
 * ----------------------------------------------------------------------------
 * Backend endpoints used:
 *   GET    /api/admin/campaigns              list (+filters/pagination)
 *   POST   /api/admin/campaigns              create (never auto-sends)
 *   GET    /api/admin/campaigns/:id          detail
 *   PUT    /api/admin/campaigns/:id          update
 *   DELETE /api/admin/campaigns/:id          delete (confirm + type-to-delete)
 *   POST   /api/admin/campaigns/:id/duplicate
 *   POST   /api/admin/campaigns/:id/send     (confirm dialog first)
 *   POST   /api/admin/campaigns/:id/schedule { scheduled_at }
 *   POST   /api/admin/campaigns/:id/cancel
 *   GET    /api/admin/campaigns/recipients-estimate (optional — fallback: dashboard stats)
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG, UI = window.SMMUI, API = window.SMMApi;
  var EP = CFG.ENDPOINTS.campaigns;

  var state = { page: 1, limit: CFG.DEFAULT_PAGE_SIZE, search: '', status: '', from: '', to: '', total: 0 };
  var editingId = null; // null = create mode

  document.addEventListener('DOMContentLoaded', function () {
    var tbody = document.querySelector('#campaigns-table tbody');
    var stateBox = document.getElementById('campaigns-state');
    var searchEl = document.getElementById('campaigns-search');
    var statusEl = document.getElementById('campaigns-status');
    var fromEl = document.getElementById('campaigns-from');
    var toEl = document.getElementById('campaigns-to');

    // Deep link: dashboard "Create campaign" action.
    if (new URLSearchParams(location.search).get('action') === 'create') {
      setTimeout(openEditor, 150);
    }

    document.getElementById('campaigns-create').addEventListener('click', function () { openEditor(null); });
    document.getElementById('campaigns-refresh').addEventListener('click', function () { load(); UI.toast('info', 'Refreshed', 'Campaign list reloaded.'); });

    searchEl.addEventListener('input', UI.debounce(function () {
      state.search = searchEl.value.trim(); state.page = 1; load();
    }, 350));
    statusEl.addEventListener('change', function () { state.status = statusEl.value; state.page = 1; load(); });
    fromEl.addEventListener('change', function () { state.from = fromEl.value; state.page = 1; load(); });
    toEl.addEventListener('change', function () { state.to = toEl.value; state.page = 1; load(); });
    document.getElementById('campaigns-clear').addEventListener('click', function () {
      state = { page: 1, limit: state.limit, search: '', status: '', from: '', to: '', total: 0 };
      searchEl.value = ''; statusEl.value = ''; fromEl.value = ''; toEl.value = '';
      load();
    });

    load();

    /* ---------------------------------------------------------------- */
    /* List                                                              */
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
        state.total = UI.extractTotal(payload, items.length);
        var totalPages = UI.extractTotalPages(payload, state.total, state.limit);
        UI.renderState(stateBox, { type: 'clear' });
        if (!items.length) {
          tbody.innerHTML = '';
          UI.renderState(stateBox, {
            type: 'empty',
            icon: 'megaphone',
            title: 'No campaigns found',
            text: state.search || state.status || state.from ? 'No campaigns match the current filters.' : 'Create your first campaign to reach your subscribers.',
            action: '<button class="btn btn-primary btn-sm" id="empty-create-campaign"><i data-lucide="plus" class="btn-icon"></i><span>New campaign</span></button>'
          });
          var b = document.getElementById('empty-create-campaign');
          b && b.addEventListener('click', function () { openEditor(null); });
          document.getElementById('campaigns-info').textContent = '';
          UI.pagination(document.getElementById('campaigns-pagination'), { page: 1, totalPages: 1, total: 0 });
          return;
        }
        tbody.innerHTML = items.map(rowHtml).join('');
        wireRowActions(items);
        document.getElementById('campaigns-info').textContent =
          'Showing ' + ((state.page - 1) * state.limit + 1) + '–' + Math.min(state.page * state.limit, state.total) + ' of ' + UI.fmt.number(state.total) + ' campaigns';
        UI.pagination(document.getElementById('campaigns-pagination'), {
          page: state.page, totalPages: totalPages, total: state.total,
          onPage: function (p) { state.page = p; load(); }
        });
        if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
      }).catch(function (err) {
        tbody.innerHTML = '';
        UI.renderState(stateBox, { type: 'error', title: 'Could not load campaigns', error: err, retry: load });
      });
    }

    function rowHtml(c) {
      var id = c.id !== undefined ? c.id : c._id;
      var status = String(c.status || 'draft').toLowerCase();
      var canSend = status === 'draft' || status === 'cancelled' || status === 'failed';
      var canCancel = status === 'scheduled' || status === 'processing';
      return '<tr data-id="' + UI.esc(id) + '">' +
        '<td><div class="cell-main truncate" style="max-width:240px">' + UI.esc(c.name || 'Untitled campaign') + '</div>' +
        '<div class="cell-sub truncate" style="max-width:240px">' + UI.esc(c.subject || '') + '</div></td>' +
        '<td>' + UI.statusBadge(c.status) +
          (c.scheduled_at ? '<div class="cell-sub">' + UI.esc(UI.fmt.dateTime(c.scheduled_at)) + '</div>' : '') + '</td>' +
        '<td class="cell-num">' + UI.fmt.number(c.recipients_count || c.total_recipients || (c.stats && c.stats.recipients)) + '</td>' +
        '<td class="cell-num">' + UI.fmt.number(c.sent_count || (c.stats && c.stats.sent)) + '</td>' +
        '<td class="cell-num">' + UI.fmt.number(c.failed_count || (c.stats && c.stats.failed)) + '</td>' +
        '<td class="cell-muted nowrap">' + UI.esc(UI.fmt.date(c.created_at || c.createdAt)) + '</td>' +
        '<td class="td-actions">' +
          '<div class="row-actions">' +
            '<button class="icon-btn" data-act="menu" aria-label="Campaign actions" style="width:34px;height:34px"><i data-lucide="more-horizontal"></i></button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }

    function wireRowActions(items) {
      var tbody = document.querySelector('#campaigns-table tbody');
      tbody.querySelectorAll('tr').forEach(function (tr) {
        var id = tr.getAttribute('data-id');
        var campaign = items.find(function (c) { return String(c.id !== undefined ? c.id : c._id) === String(id); });
        if (!campaign) return;
        tr.querySelector('[data-act="menu"]').addEventListener('click', function (e) {
          e.stopPropagation();
          openRowMenu(tr, campaign);
        });
      });
      document.addEventListener('click', closeAllRowMenus);
    }

    function closeAllRowMenus() {
      document.querySelectorAll('.row-menu').forEach(function (m) { m.remove(); });
    }

    function openRowMenu(tr, c) {
      closeAllRowMenus();
      var id = c.id !== undefined ? c.id : c._id;
      var status = String(c.status || 'draft').toLowerCase();
      var canSend = status === 'draft' || status === 'cancelled' || status === 'failed';
      var canCancel = status === 'scheduled' || status === 'processing';

      var menu = document.createElement('div');
      menu.className = 'row-menu';
      menu.innerHTML =
        menuItem('view', 'eye', 'View details') +
        menuItem('edit', 'pencil', 'Edit') +
        menuItem('duplicate', 'copy', 'Duplicate') +
        (canSend ? menuItem('send', 'send', 'Send now…', 'menu-send') : '') +
        (canSend ? menuItem('schedule', 'calendar-clock', 'Schedule…') : '') +
        (canCancel ? menuItem('cancel', 'x-circle', 'Cancel campaign', 'danger-text') : '') +
        menuItem('preview', 'external-link', 'Preview') +
        menuItem('delete', 'trash-2', 'Delete', 'danger-text');

      tr.querySelector('.td-actions .row-actions').appendChild(menu);
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });

      menu.addEventListener('click', function (e) { e.stopPropagation(); });
      menu.querySelectorAll('[data-mact]').forEach(function (b) {
        b.addEventListener('click', function () {
          closeAllRowMenus();
          var act = b.getAttribute('data-mact');
          if (act === 'view') viewCampaign(c);
          else if (act === 'edit') openEditor(c);
          else if (act === 'duplicate') duplicateCampaign(c);
          else if (act === 'send') sendCampaign(c);
          else if (act === 'schedule') scheduleCampaign(c);
          else if (act === 'cancel') cancelCampaign(c);
          else if (act === 'preview') previewCampaign(c);
          else if (act === 'delete') deleteCampaign(c);
        });
      });

      function menuItem(act, icon, label, extra) {
        return '<button type="button" class="menu-item' + (extra ? ' ' + extra : '') + '" data-mact="' + act + '">' +
          '<i data-lucide="' + icon + '"></i><span>' + UI.esc(label) + '</span></button>';
      }
    }

    /* ---------------------------------------------------------------- */
    /* Actions                                                           */
    /* ---------------------------------------------------------------- */
    function viewCampaign(c) {
      // Fetch fresh detail (falls back to row data when the detail endpoint 404s).
      API.get(EP.get, null, { repl: { id: c.id !== undefined ? c.id : c._id } })
        .then(function (full) { showDetail(full || c); })
        .catch(function (err) {
          if (err.kind === 'NOT_FOUND') showDetail(c);
          else UI.toast('error', 'Could not load campaign', err.message);
        });
    }

    function showDetail(c) {
      var id = c.id !== undefined ? c.id : c._id;
      var stats = c.stats || {};
      UI.modal({
        title: c.name || 'Campaign',
        sub: 'Campaign details',
        body:
          '<dl class="detail-grid">' +
          '<dt>Campaign ID</dt><dd class="mono">' + UI.esc(id) + '</dd>' +
          '<dt>Status</dt><dd>' + UI.statusBadge(c.status) + '</dd>' +
          '<dt>Subject</dt><dd>' + UI.esc(c.subject || '—') + '</dd>' +
          '<dt>Sender</dt><dd>' + UI.esc((c.sender_name || '') + (c.sender_name && c.sender_email ? ' ' : '') + (c.sender_email ? '<' + c.sender_email + '>' : '') || '—') + '</dd>' +
          '<dt>Recipients</dt><dd>' + UI.esc(UI.fmt.number(c.recipients_count || c.total_recipients || stats.recipients)) + '</dd>' +
          '<dt>Sent</dt><dd>' + UI.esc(UI.fmt.number(c.sent_count || stats.sent)) + '</dd>' +
          '<dt>Failed</dt><dd>' + UI.esc(UI.fmt.number(c.failed_count || stats.failed)) + '</dd>' +
          '<dt>Scheduled for</dt><dd>' + UI.esc(c.scheduled_at ? UI.fmt.dateTime(c.scheduled_at) : '—') + '</dd>' +
          '<dt>Created</dt><dd>' + UI.esc(UI.fmt.dateTime(c.created_at || c.createdAt)) + '</dd>' +
          '</dl>' +
          '<div class="detail-section-title">Content preview</div>' +
          '<div id="campaign-detail-preview"></div>',
        size: 'lg',
        onOpen: function (box) {
          var prev = box.querySelector('#campaign-detail-preview');
          if (c.html || c.content || c.body_html) {
            prev.appendChild(UI.previewIframe(c.html || c.content || c.body_html));
          } else {
            prev.innerHTML = '<p class="mini-empty">No HTML content available for preview.</p>';
          }
        }
      });
    }

    function duplicateCampaign(c) {
      API.post(EP.duplicate.replace(':id', c.id !== undefined ? c.id : c._id))
        .then(function () { UI.toast('success', 'Campaign duplicated', 'A copy has been created as a draft.'); load(); })
        .catch(function (err) {
          if (err.kind === 'NOT_FOUND') UI.toast('warning', 'Not supported by backend', 'The duplicate endpoint is not implemented on the backend. Duplicate by creating a new campaign with the same content (see README).');
          else UI.toast('error', 'Duplicate failed', err.message);
        });
    }

    /** Confirmation BEFORE any bulk send: shows recipient count + details. */
    function sendCampaign(c) {
      fetchRecipientEstimate(c).then(function (count) {
        var id = c.id !== undefined ? c.id : c._id;
        return UI.confirm({
          title: 'Send campaign now?',
          message:
            '<strong>' + UI.esc(c.name || 'Untitled campaign') + '</strong> will be sent immediately.<br/><br/>' +
            'Subject: ' + UI.esc(c.subject || '(no subject)') + '<br/>' +
            'Estimated recipients: <strong>' + UI.esc(UI.fmt.number(count)) + '</strong><br/><br/>' +
            'Suppressed and unsubscribed addresses are always skipped by the backend. This action cannot be undone once processing starts.',
          confirmLabel: 'Send to ' + UI.fmt.number(count) + ' recipients',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          var btnToast = UI.toast('info', 'Sending…', 'The backend is starting the campaign.');
          API.post(EP.send.replace(':id', id))
            .then(function () {
              UI.toast('success', 'Campaign started', 'The backend accepted the send request. Track progress on this page.');
              load();
            })
            .catch(function (err) {
              UI.toast('error', 'Send failed', err.message);
              load();
            });
        });
      });
    }

    function scheduleCampaign(c) {
      var id = c.id !== undefined ? c.id : c._id;
      var m = UI.modal({
        title: 'Schedule campaign',
        sub: 'The backend will start sending at the chosen time.',
        body:
          '<div class="form-group"><label class="form-label" for="sched-at">Date &amp; time *</label>' +
          '<input type="datetime-local" class="form-input" id="sched-at"/>' +
          '<p class="form-hint">Must be in the future. Stored and executed by the backend.</p></div>',
        foot:
          '<button class="btn btn-secondary" data-close>Cancel</button>' +
          '<button class="btn btn-primary" id="sched-save">Schedule</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          box.querySelector('#sched-save').addEventListener('click', function () {
            var v = box.querySelector('#sched-at').value;
            if (!v) { UI.toast('warning', 'Pick a date', 'Choose a future date and time first.'); return; }
            var when = new Date(v);
            if (when.getTime() <= Date.now()) { UI.toast('warning', 'Invalid time', 'The scheduled time must be in the future.'); return; }
            API.post(EP.schedule.replace(':id', id), { scheduled_at: when.toISOString() })
              .then(function () { close(); UI.toast('success', 'Campaign scheduled', 'For ' + UI.fmt.dateTime(when.toISOString())); load(); })
              .catch(function (err) { UI.toast('error', 'Scheduling failed', err.message); });
          });
        }
      });
      return m;
    }

    function cancelCampaign(c) {
      var id = c.id !== undefined ? c.id : c._id;
      UI.confirm({
        title: 'Cancel campaign?',
        message: '<strong>' + UI.esc(c.name || 'Campaign') + '</strong> will stop sending. Emails already dispatched cannot be recalled.',
        confirmLabel: 'Cancel campaign', danger: false
      }).then(function (ok) {
        if (!ok) return;
        API.post(EP.cancel.replace(':id', id))
          .then(function () { UI.toast('success', 'Campaign cancelled', ''); load(); })
          .catch(function (err) { UI.toast('error', 'Could not cancel', err.message); });
      });
    }

    function deleteCampaign(c) {
      var id = c.id !== undefined ? c.id : c._id;
      var name = c.name || 'this campaign';
      UI.confirm({
        title: 'Delete campaign?',
        message: 'This permanently deletes <strong>' + UI.esc(name) + '</strong> and its statistics. This action cannot be undone.',
        confirmLabel: 'Delete permanently', danger: true, requireText: 'DELETE'
      }).then(function (ok) {
        if (!ok) return;
        API.del(EP.delete.replace(':id', id))
          .then(function () { UI.toast('success', 'Campaign deleted', ''); load(); })
          .catch(function (err) { UI.toast('error', 'Delete failed', err.message); });
      });
    }

    function previewCampaign(c) {
      var html = c.html || c.content || c.body_html || '';
      UI.modal({
        title: 'Preview: ' + (c.name || 'Campaign'),
        body:
          '<div class="preview-meta">' +
          '<div><b>Subject:</b> ' + UI.esc(c.subject || '(no subject)') + '</div>' +
          '<div><b>Sender:</b> ' + UI.esc((c.sender_name || '') + (c.sender_email ? ' <' + c.sender_email + '>' : '')) + '</div>' +
          '</div>',
        size: 'lg',
        onOpen: function (box) {
          box.querySelector('.modal-body').appendChild(UI.previewIframe(html));
        }
      });
    }

    /** Estimate recipients: optional endpoint → dashboard stats fallback. */
    function fetchRecipientEstimate(c) {
      var seg = c.segment || 'all';
      return API.get(EP.recipients, { segment: seg })
        .then(function (r) {
          var v = typeof r === 'number' ? r : (r && (r.count || r.total || r.recipients));
          if (v === undefined || v === null) throw new Error('no count');
          return v;
        })
        .catch(function () {
          return API.get(CFG.ENDPOINTS.dashboard.stats).then(function (s) {
            return (seg === 'active' ? (s.active_subscribers || s.subscribers_active) : (s.active_subscribers || s.total_subscribers || 0)) || 0;
          }).catch(function () { return null; });
        });
    }

    /* ---------------------------------------------------------------- */
    /* Create / Edit modal                                               */
    /* ---------------------------------------------------------------- */
    function openEditor(existing) {
      editingId = existing ? (existing.id !== undefined ? existing.id : existing._id) : null;
      var isEdit = !!existing;

      var body =
        '<div class="form-group"><label class="form-label">Campaign name *</label>' +
        '<input type="text" class="form-input" id="cmp-name" maxlength="120" placeholder="e.g. November promo announcement"/></div>' +

        '<div class="form-group"><label class="form-label">Email subject *</label>' +
        '<input type="text" class="form-input" id="cmp-subject" maxlength="200" placeholder="What subscribers will see in their inbox"/></div>' +

        '<div class="form-grid-2">' +
          '<div class="form-group"><label class="form-label">Sender name</label>' +
          '<input type="text" class="form-input" id="cmp-from-name" placeholder="SMMARIA"/></div>' +
          '<div class="form-group"><label class="form-label">Sender email</label>' +
          '<input type="email" class="form-input" id="cmp-from-email" placeholder="no-reply@smmaria.com"/></div>' +
        '</div>' +

        '<div class="form-group"><label class="form-label">Recipients *</label>' +
        '<select class="form-input" id="cmp-segment">' +
          CFG.SEGMENTS.map(function (s) { return '<option value="' + UI.esc(s.value) + '">' + UI.esc(s.label) + '</option>'; }).join('') +
        '</select>' +
        '<p class="form-hint">Unsubscribed, bounced and suppressed addresses are excluded by the backend regardless of the segment.</p></div>' +

        '<div class="form-group"><label class="form-label">Email content (HTML) *</label>' +
        '<div id="cmp-editor"></div>' +
        '<p class="form-hint">Basic rich text. Full HTML source editing is available in Templates or Compose.</p></div>';

      var m = UI.modal({
        title: isEdit ? 'Edit campaign' : 'New campaign',
        sub: isEdit ? 'Changes are saved to the backend. Nothing is sent automatically.' : 'Campaigns are always created as drafts. Sending is a separate, confirmed action.',
        size: 'lg',
        body: body,
        foot:
          '<button class="btn btn-secondary" data-close>Cancel</button>' +
          '<button class="btn btn-primary" id="cmp-save"><span class="btn-spinner hidden"></span><i data-lucide="save" class="btn-icon"></i><span>' + (isEdit ? 'Save changes' : 'Create draft campaign') + '</span></button>',
        onClose: function () { if (quill) { quill = null; } },
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          var quill = null;
          var editorEl = box.querySelector('#cmp-editor');

          if (typeof Quill !== 'undefined') {
            quill = new Quill(editorEl, {
              theme: 'snow',
              placeholder: 'Write the campaign email…',
              modules: {
                toolbar: [
                  [{ header: [1, 2, 3, false] }], ['bold', 'italic', 'underline', 'link'],
                  [{ list: 'ordered' }, { list: 'bullet' }], ['blockquote'], ['clean']
                ]
              }
            });
            editorEl.style.minHeight = '200px';
          } else {
            editorEl.innerHTML = '<textarea class="form-input" id="cmp-editor-fallback" rows="10" placeholder="HTML content…"></textarea>';
          }

          if (isEdit) {
            box.querySelector('#cmp-name').value = existing.name || '';
            box.querySelector('#cmp-subject').value = existing.subject || '';
            box.querySelector('#cmp-from-name').value = existing.sender_name || '';
            box.querySelector('#cmp-from-email').value = existing.sender_email || '';
            box.querySelector('#cmp-segment').value = existing.segment || 'all';
            var html = existing.html || existing.content || existing.body_html || '';
            if (quill) quill.root.innerHTML = html;
            else box.querySelector('#cmp-editor-fallback').value = html;
          }

          box.querySelector('#cmp-save').addEventListener('click', function () {
            var btn = this;
            var name = box.querySelector('#cmp-name').value.trim();
            var subject = box.querySelector('#cmp-subject').value.trim();
            var valid = true;
            [[box.querySelector('#cmp-name'), !!name], [box.querySelector('#cmp-subject'), !!subject]].forEach(function (pair) {
              pair[0].classList.toggle('input-invalid', !pair[1]);
              if (!pair[1]) valid = false;
            });
            if (!valid) { UI.toast('warning', 'Missing fields', 'Campaign name and subject are required.'); return; }

            var html = quill ? quill.root.innerHTML : (box.querySelector('#cmp-editor-fallback') || {}).value || '';
            var payload = {
              name: name,
              subject: subject,
              sender_name: box.querySelector('#cmp-from-name').value.trim() || undefined,
              sender_email: box.querySelector('#cmp-from-email').value.trim() || undefined,
              segment: box.querySelector('#cmp-segment').value,
              html: html
            };

            btn.disabled = true;
            btn.querySelector('.btn-spinner').classList.remove('hidden');

            var req = isEdit
              ? API.put(EP.update.replace(':id', editingId), payload)
              : API.post(EP.create, payload);

            req.then(function () {
              close();
              UI.toast('success', isEdit ? 'Campaign updated' : 'Campaign created', isEdit ? 'Changes saved as draft data.' : 'Created as a draft. Use the action menu to send or schedule.');
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
