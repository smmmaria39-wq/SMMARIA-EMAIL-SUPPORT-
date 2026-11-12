/* ============================================================================
 * SMMARIA Email Manager — templates.js
 * ----------------------------------------------------------------------------
 * Backend endpoints used:
 *   GET    /api/admin/templates                 list (+search/category)
 *   POST   /api/admin/templates                 create
 *   GET    /api/admin/templates/:id             detail
 *   PUT    /api/admin/templates/:id             update
 *   DELETE /api/admin/templates/:id             delete (confirm)
 *   POST   /api/admin/templates/:id/duplicate   (optional)
 *
 * Template variables: suggestions come from EMAIL_SYSTEM_CONFIG.TEMPLATE_
 * VARIABLES. The backend engine decides what it actually substitutes —
 * unknown variables are left as literal text by most engines, and the editor
 * labels the list as "supported by the backend engine" so nothing is faked.
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG, UI = window.SMMUI, API = window.SMMApi;
  var EP = CFG.ENDPOINTS.templates;

  var state = { page: 1, limit: 12, search: '', category: '' };
  var quill = null;

  var CATEGORIES = [
    { value: '', label: 'All' },
    { value: 'welcome', label: 'Welcome' },
    { value: 'order', label: 'Order notifications' },
    { value: 'payment', label: 'Payment' },
    { value: 'account', label: 'Account purchase' },
    { value: 'invoice', label: 'Invoice' },
    { value: 'announcement', label: 'Service announcements' },
    { value: 'marketing', label: 'Marketing' },
    { value: 'system', label: 'System / account notices' },
    { value: 'other', label: 'Other' }
  ];

  document.addEventListener('DOMContentLoaded', function () {
    var grid = document.getElementById('tpl-grid');
    var stateBox = document.getElementById('tpl-state');
    var chips = document.getElementById('tpl-category-chips');
    var searchEl = document.getElementById('tpl-search');

    // Category chips
    chips.innerHTML = CATEGORIES.map(function (c, i) {
      return '<button type="button" class="chip' + (i === 0 ? ' active' : '') + '" data-cat="' + UI.esc(c.value) + '" role="tab">' + UI.esc(c.label) + '</button>';
    }).join('');
    chips.querySelectorAll('.chip').forEach(function (b) {
      b.addEventListener('click', function () {
        chips.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        state.category = b.getAttribute('data-cat');
        state.page = 1;
        load();
      });
    });

    if (new URLSearchParams(location.search).get('action') === 'create') {
      setTimeout(function () { openEditor(null); }, 150);
    }

    document.getElementById('tpl-create').addEventListener('click', function () { openEditor(null); });
    document.getElementById('tpl-refresh').addEventListener('click', function () { load(); UI.toast('info', 'Refreshed', 'Templates reloaded.'); });
    searchEl.addEventListener('input', UI.debounce(function () {
      state.search = searchEl.value.trim(); state.page = 1; load();
    }, 350));

    load();

    /* ---------------------------------------------------------------- */
    function load() {
      grid.setAttribute('aria-busy', 'true');
      grid.innerHTML = skeletonCards(6);
      UI.renderState(stateBox, { type: 'clear' });

      API.get(EP.list, {
        page: state.page, limit: state.limit,
        search: state.search || undefined,
        category: state.category || undefined
      }).then(function (payload) {
        var items = UI.extractList(payload);
        var total = UI.extractTotal(payload, items.length);
        var totalPages = UI.extractTotalPages(payload, total, state.limit);
        grid.setAttribute('aria-busy', 'false');
        if (!items.length) {
          grid.innerHTML = '';
          UI.renderState(stateBox, {
            type: 'empty', icon: 'layout-template', title: 'No templates found',
            text: state.search || state.category ? 'No templates match the current filters.' : 'Create reusable email designs once, then reuse them everywhere.',
            action: '<button class="btn btn-primary btn-sm" id="empty-tpl-create"><i data-lucide="plus" class="btn-icon"></i><span>New template</span></button>'
          });
          var b = document.getElementById('empty-tpl-create');
          b && b.addEventListener('click', function () { openEditor(null); });
          document.getElementById('tpl-info').textContent = '';
          UI.pagination(document.getElementById('tpl-pagination'), { page: 1, totalPages: 1, total: 0 });
          return;
        }
        grid.innerHTML = items.map(cardHtml).join('');
        wireCards(items);
        document.getElementById('tpl-info').textContent =
          UI.fmt.number(total) + ' template' + (Number(total) === 1 ? '' : 's');
        UI.pagination(document.getElementById('tpl-pagination'), {
          page: state.page, totalPages: totalPages, total: total,
          onPage: function (p) { state.page = p; load(); }
        });
        if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
      }).catch(function (err) {
        grid.innerHTML = '';
        UI.renderState(stateBox, { type: 'error', title: 'Could not load templates', error: err, retry: load });
      });
    }

    function skeletonCards(n) {
      var html = '';
      for (var i = 0; i < n; i++) {
        html += '<div class="tpl-card"><div class="skeleton-block" style="width:55%;height:16px"></div>' +
          '<div class="skeleton-block" style="width:80%"></div>' +
          '<div class="skeleton-block" style="width:70%;height:60px"></div></div>';
      }
      return html;
    }

    function cardHtml(t) {
      var id = t.id !== undefined ? t.id : t._id;
      var vars = (t.variables && t.variables.length) ? t.variables : [];
      return '<div class="tpl-card" data-id="' + UI.esc(id) + '">' +
        '<div class="tpl-top">' +
          '<div style="min-width:0"><div class="tpl-name" title="' + UI.esc(t.name || '') + '">' + UI.esc(t.name || 'Untitled template') + '</div>' +
          '<div class="tpl-subject" title="' + UI.esc(t.subject || '') + '">' + UI.esc(t.subject || '(no subject)') + '</div></div>' +
          (t.category ? '<span class="badge badge-indigo">' + UI.esc(t.category) + '</span>' : '') +
        '</div>' +
        '<div class="tpl-thumb"><iframe sandbox="" loading="lazy" srcdoc="' + UI.esc(UI.safeIframeDoc(t.html || t.body || t.body_html || '<p style="color:#999;padding:12px">No preview content</p>')) + '" title="Template preview"></iframe></div>' +
        (vars.length ? '<div class="tpl-vars">' + vars.map(function (v) { return '<code>' + UI.esc(v) + '</code>'; }).join(' ') + '</div>' : '') +
        '<div class="tpl-foot">' +
          '<span class="cell-sub">' + UI.esc(UI.fmt.date(t.updated_at || t.created_at)) + '</span>' +
          '<div class="row-actions">' +
            '<button class="icon-btn" data-act="edit" title="Edit" style="width:32px;height:32px"><i data-lucide="pencil"></i></button>' +
            '<button class="icon-btn" data-act="preview" title="Preview" style="width:32px;height:32px"><i data-lucide="eye"></i></button>' +
            '<button class="icon-btn" data-act="menu" title="More" style="width:32px;height:32px"><i data-lucide="more-horizontal"></i></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    function wireCards(items) {
      document.querySelectorAll('.tpl-card').forEach(function (card) {
        var id = card.getAttribute('data-id');
        var t = items.find(function (x) { return String(x.id !== undefined ? x.id : x._id) === String(id); });
        if (!t) return;
        card.querySelector('[data-act="edit"]').addEventListener('click', function () { openEditor(t); });
        card.querySelector('[data-act="preview"]').addEventListener('click', function () { previewTemplate(t); });
        card.querySelector('[data-act="menu"]').addEventListener('click', function (e) {
          e.stopPropagation();
          openCardMenu(card, t);
        });
      });
      document.addEventListener('click', function () {
        document.querySelectorAll('.row-menu').forEach(function (m) { m.remove(); });
      });
    }

    function openCardMenu(card, t) {
      var existing = card.querySelector('.row-menu');
      if (existing) { existing.remove(); return; }
      var id = t.id !== undefined ? t.id : t._id;
      var menu = document.createElement('div');
      menu.className = 'row-menu';
      menu.innerHTML =
        '<button type="button" class="menu-item" data-mact="edit"><i data-lucide="pencil"></i><span>Edit</span></button>' +
        '<button type="button" class="menu-item" data-mact="duplicate"><i data-lucide="copy"></i><span>Duplicate</span></button>' +
        '<button type="button" class="menu-item" data-mact="compose"><i data-lucide="pen-line"></i><span>Use in composer</span></button>' +
        '<button type="button" class="menu-item danger" data-mact="delete"><i data-lucide="trash-2"></i><span>Delete</span></button>';
      card.querySelector('.tpl-foot .row-actions').style.position = 'relative';
      card.querySelector('.tpl-foot .row-actions').appendChild(menu);
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });

      menu.addEventListener('click', function (e) { e.stopPropagation(); });
      menu.querySelectorAll('[data-mact]').forEach(function (b) {
        b.addEventListener('click', function () {
          menu.remove();
          var act = b.getAttribute('data-mact');
          if (act === 'edit') openEditor(t);
          else if (act === 'duplicate') duplicate(t);
          else if (act === 'delete') del(t);
          else if (act === 'compose') {
            try { localStorage.setItem('smm_tpl_for_compose', JSON.stringify(t)); } catch (err) { /* ignore */ }
            window.location.href = '../pages/compose.html';
          }
        });
      });
    }

    /* ---------------------------------------------------------------- */
    function previewTemplate(t) {
      UI.modal({
        title: 'Preview: ' + (t.name || 'Template'),
        sub: 'Rendered in a sandboxed frame. Variables appear as literal text unless the backend substitutes them at send time.',
        size: 'lg',
        body:
          '<div class="preview-meta"><div><b>Subject:</b> ' + UI.esc(t.subject || '(no subject)') + '</div></div>',
        onOpen: function (box) {
          box.querySelector('.modal-body').appendChild(UI.previewIframe(t.html || t.body || t.body_html || ''));
        }
      });
    }

    function duplicate(t) {
      var id = t.id !== undefined ? t.id : t._id;
      API.post(EP.duplicate.replace(':id', id))
        .then(function () { UI.toast('success', 'Template duplicated', ''); load(); })
        .catch(function (err) {
          if (err.kind === 'NOT_FOUND') {
            // Graceful fallback: create a copy through the normal create endpoint.
            API.post(EP.create, {
              name: (t.name || 'Template') + ' (copy)',
              subject: t.subject || '',
              category: t.category || 'other',
              html: t.html || t.body || t.body_html || '',
              text: t.text || t.body_text || ''
            }).then(function () { UI.toast('success', 'Template duplicated', 'Copy created via create endpoint.'); load(); })
              .catch(function (err2) { UI.toast('error', 'Duplicate failed', err2.message); });
          } else {
            UI.toast('error', 'Duplicate failed', err.message);
          }
        });
    }

    function del(t) {
      var id = t.id !== undefined ? t.id : t._id;
      UI.confirm({
        title: 'Delete template?',
        message: 'Permanently deletes <strong>' + UI.esc(t.name || 'this template') + '</strong>. Automations referencing it may lose their email content.',
        confirmLabel: 'Delete template', danger: true, requireText: 'DELETE'
      }).then(function (ok) {
        if (!ok) return;
        API.del(EP.delete.replace(':id', id))
          .then(function () { UI.toast('success', 'Template deleted', ''); load(); })
          .catch(function (err) { UI.toast('error', 'Delete failed', err.message); });
      });
    }

    /* ---------------------------------------------------------------- */
    function openEditor(existing) {
      var isEdit = !!existing;
      var varPills = CFG.TEMPLATE_VARIABLES.map(function (v) {
        return '<span class="var-pill" data-var="' + UI.esc(v) + '" title="Insert into subject or body">' + UI.esc(v) + '</span>';
      }).join('');

      var body =
        '<div class="form-grid-2">' +
          '<div class="form-group"><label class="form-label">Template name *</label>' +
          '<input type="text" class="form-input" id="t-name" maxlength="120" placeholder="e.g. Order confirmation"/></div>' +
          '<div class="form-group"><label class="form-label">Category</label>' +
          '<select class="form-input" id="t-category">' +
            CATEGORIES.filter(function (c) { return c.value; }).map(function (c) {
              return '<option value="' + UI.esc(c.value) + '">' + UI.esc(c.label) + '</option>';
            }).join('') +
          '</select></div>' +
        '</div>' +
        '<div class="form-group"><label class="form-label">Email subject *</label>' +
        '<input type="text" class="form-input" id="t-subject" maxlength="200"/></div>' +
        '<div class="form-group"><label class="form-label">HTML body *</label>' +
        '<div id="t-editor"></div></div>' +
        '<div class="form-group"><label class="form-label">Plain-text alternative</label>' +
        '<textarea class="form-input" id="t-text" rows="4" placeholder="Optional plain-text version sent with the HTML part"></textarea></div>' +
        '<div class="form-group"><label class="form-label">Dynamic variables</label>' +
        '<p class="form-hint">Click to insert. Only variables supported by the backend engine are substituted; others remain as literal text.</p>' +
        '<div class="var-list">' + varPills + '</div></div>';

      UI.modal({
        title: isEdit ? 'Edit template' : 'New template',
        sub: 'Templates are stored by the backend and reusable in campaigns, automations and the composer.',
        size: 'lg',
        body: body,
        foot:
          '<button class="btn btn-secondary" data-close>Cancel</button>' +
          '<button class="btn btn-primary" id="t-save"><span class="btn-spinner hidden"></span><i data-lucide="save" class="btn-icon"></i><span>' + (isEdit ? 'Save changes' : 'Create template') + '</span></button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          var editorEl = box.querySelector('#t-editor');
          var localQuill = null;

          if (typeof Quill !== 'undefined') {
            localQuill = new Quill(editorEl, {
              theme: 'snow',
              placeholder: 'Template HTML body… Use variables like {{name}} where needed.',
              modules: { toolbar: [[{ header: [1, 2, 3, false] }], ['bold', 'italic', 'underline', 'link'], [{ list: 'ordered' }, { list: 'bullet' }], ['clean']] }
            });
            editorEl.style.minHeight = '180px';
          } else {
            editorEl.innerHTML = '<textarea class="form-input code-editor" id="t-editor-fallback" rows="10" placeholder="HTML body…"></textarea>';
          }

          if (isEdit) {
            box.querySelector('#t-name').value = existing.name || '';
            box.querySelector('#t-subject').value = existing.subject || '';
            box.querySelector('#t-category').value = existing.category || 'other';
            box.querySelector('#t-text').value = existing.text || existing.body_text || '';
            var html = existing.html || existing.body || existing.body_html || '';
            if (localQuill) localQuill.root.innerHTML = html;
            else box.querySelector('#t-editor-fallback').value = html;
          }

          // Variable insertion pills
          box.querySelectorAll('.var-pill').forEach(function (pill) {
            pill.addEventListener('click', function () {
              if (pill.classList.contains('invalid')) return;
              var v = pill.getAttribute('data-var');
              var subj = box.querySelector('#t-subject');
              if (document.activeElement === subj) {
                var pos = subj.selectionStart || subj.value.length;
                subj.value = subj.value.slice(0, pos) + v + subj.value.slice(pos);
              } else if (localQuill) {
                var range = localQuill.getSelection(true);
                localQuill.insertText(range.index, v, 'user');
              } else {
                var ta = box.querySelector('#t-editor-fallback');
                ta.value += v;
              }
            });
          });

          box.querySelector('#t-save').addEventListener('click', function () {
            var name = box.querySelector('#t-name').value.trim();
            var subject = box.querySelector('#t-subject').value.trim();
            var valid = true;
            if (!name) { box.querySelector('#t-name').classList.add('input-invalid'); valid = false; }
            if (!subject) { box.querySelector('#t-subject').classList.add('input-invalid'); valid = false; }
            if (!valid) { UI.toast('warning', 'Missing fields', 'Template name and subject are required.'); return; }

            var html = localQuill ? localQuill.root.innerHTML : (box.querySelector('#t-editor-fallback') || {}).value || '';
            var payload = {
              name: name,
              subject: subject,
              category: box.querySelector('#t-category').value,
              html: html,
              text: box.querySelector('#t-text').value.trim() || undefined
            };

            var btn = this;
            btn.disabled = true;
            btn.querySelector('.btn-spinner').classList.remove('hidden');

            var req = isEdit
              ? API.put(EP.update.replace(':id', existing.id !== undefined ? existing.id : existing._id), payload)
              : API.post(EP.create, payload);

            req.then(function () {
              close();
              UI.toast('success', isEdit ? 'Template updated' : 'Template created', name);
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
