/* ============================================================================
 * SMMARIA Email Manager — compose.js
 * ----------------------------------------------------------------------------
 * Backend endpoints used:
 *   POST /api/admin/emails/send    { to[], subject, html, text?, sender_name?, sender_email?, type? }
 *   POST /api/admin/emails/test    { to, subject, html }          (optional)
 *   GET  /api/admin/templates      (template picker)              (optional)
 *   GET  /api/admin/subscribers    (subscriber picker)
 *   GET  /api/admin/settings       (prefill default sender)
 *   POST /api/admin/upload         multipart image upload         (optional)
 *
 * Drafts are stored in localStorage (documented limitation until the backend
 * exposes a drafts endpoint). Unsaved-change guard is wired on navigation.
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG, UI = window.SMMUI, API = window.SMMApi;
  var EP = CFG.ENDPOINTS;

  var quill = null, usingFallbackEditor = false;
  var recipients = [];
  var dirty = false;

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('compose-form');
    var toInput = document.getElementById('compose-to');
    var subjectEl = document.getElementById('compose-subject');

    initEditor();
    loadSenderDefaults();
    restoreDraft();
    bindRecipients(toInput);
    bindActions();

    // Unsaved changes guard.
    window.addEventListener('beforeunload', function (e) {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '';
      return '';
    });
    // Intercept in-app nav links too.
    document.querySelectorAll('.nav-item, .link-btn[href], .quick-action').forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (!isDirty()) return;
        if (!window.confirm('You have an unsaved email. Leave this page?')) {
          e.preventDefault();
        }
      });
    });

    ['input', 'change'].forEach(function (evt) {
      form.addEventListener(evt, function () { markDirty(); updateSummary(); });
    });

    // Mode toggle: rich text ↔ HTML source
    document.getElementById('mode-rich').addEventListener('click', function () { setMode('rich'); });
    document.getElementById('mode-html').addEventListener('click', function () { setMode('html'); });

    function isDirty() {
      if (dirty) return true;
      return recipients.length > 0 || getSubject() || getHtml().replace(/<(.|\n)*?>/g, '').trim() !== '';
    }
    function markDirty() { dirty = true; }

    /* ---------------------------------------------------------------- */
    /* Editor                                                            */
    /* ---------------------------------------------------------------- */
    function initEditor() {
      var container = document.getElementById('compose-editor');
      if (typeof Quill !== 'undefined') {
        quill = new Quill(container, {
          theme: 'snow',
          placeholder: 'Write your email…',
          modules: {
            toolbar: {
              container: [
                [{ header: [1, 2, 3, false] }],
                ['bold', 'italic', 'underline', 'strike'],
                ['link', 'image'],
                [{ list: 'ordered' }, { list: 'bullet' }],
                ['blockquote', 'code-block'],
                ['clean']
              ],
              handlers: { image: imageHandler }
            }
          }
        });
        quill.on('text-change', function () { markDirty(); updateSummary(); });
      } else {
        usingFallbackEditor = true;
        container.innerHTML = '<textarea id="compose-editor-fallback" class="form-input code-editor" rows="14" ' +
          'placeholder="Quill failed to load from CDN — write raw HTML here instead." style="min-height:280px"></textarea>';
        document.getElementById('compose-editor-fallback').addEventListener('input', function () { markDirty(); updateSummary(); });
        document.getElementById('mode-rich').disabled = true;
        setMode('html');
      }

      function imageHandler() {
        var fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/png,image/jpeg,image/gif,image/webp';
        fileInput.addEventListener('change', function () {
          var file = fileInput.files[0];
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) {
            UI.toast('warning', 'Image too large', 'Images must be under 2 MB.');
            return;
          }
          // Try backend upload first; fall back to inline base64.
          var fd = new FormData();
          fd.append('file', file);
          API.upload(EP.compose.upload, fd)
            .then(function (res) {
              var url = res && (res.url || (res.data && res.data.url));
              if (!url) throw new Error('no url in response');
              insertImage(url);
            })
            .catch(function (err) {
              if (err.kind === 'NOT_FOUND' || err.kind === 'CONFIG') {
                var reader = new FileReader();
                reader.onload = function () { insertImage(reader.result); };
                reader.readAsDataURL(file);
                UI.toast('info', 'Embedded inline', 'Upload endpoint not available — image embedded as base64.');
              } else {
                UI.toast('error', 'Upload failed', err.message);
              }
            });
        });
        fileInput.click();
      }

      function insertImage(url) {
        if (quill) {
          var range = quill.getSelection(true);
          quill.insertEmbed(range.index, 'image', url, 'user');
        } else {
          var ta = document.getElementById('compose-editor-fallback');
          ta.value += '<img src="' + url + '" alt=""/>';
        }
      }
    }

    function setMode(mode) {
      var richBtn = document.getElementById('mode-rich');
      var htmlBtn = document.getElementById('mode-html');
      var richWrap = document.getElementById('compose-editor-container');
      var htmlWrap = document.getElementById('compose-editor-html-wrap');
      var ta = document.getElementById('compose-editor-html');

      if (mode === 'html') {
        ta.value = getHtml();
        richWrap.classList.add('hidden');
        htmlWrap.classList.remove('hidden');
        richBtn.classList.remove('active'); htmlBtn.classList.add('active');
        htmlBtn.setAttribute('aria-selected', 'true'); richBtn.setAttribute('aria-selected', 'false');
        document.getElementById('sum-editor').textContent = 'HTML source';
      } else {
        if (!usingFallbackEditor) setHtml(ta.value);
        htmlWrap.classList.add('hidden');
        richWrap.classList.remove('hidden');
        htmlBtn.classList.remove('active'); richBtn.classList.add('active');
        richBtn.setAttribute('aria-selected', 'true'); htmlBtn.setAttribute('aria-selected', 'false');
        document.getElementById('sum-editor').textContent = usingFallbackEditor ? 'Plain editor' : 'Rich text';
      }
    }

    function getHtml() {
      if (usingFallbackEditor) return (document.getElementById('compose-editor-fallback') || {}).value || '';
      var fromSource = document.getElementById('compose-editor-html-wrap');
      if (!fromSource.classList.contains('hidden')) return document.getElementById('compose-editor-html').value;
      return quill ? quill.root.innerHTML : '';
    }

    function setHtml(html) {
      if (usingFallbackEditor) return;
      if (quill) quill.root.innerHTML = html || '';
    }

    /* ---------------------------------------------------------------- */
    /* Recipients                                                        */
    /* ---------------------------------------------------------------- */
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    function bindRecipients(input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          addRecipient(input.value);
          input.value = '';
        } else if (e.key === 'Backspace' && !input.value && recipients.length) {
          removeRecipient(recipients.length - 1);
        }
      });
      input.addEventListener('blur', function () {
        if (input.value.trim()) { addRecipient(input.value); input.value = ''; }
      });

      document.getElementById('compose-pick-subscribers').addEventListener('click', openSubscriberPicker);
    }

    function addRecipient(raw) {
      var email = String(raw || '').trim().replace(/[,;]$/, '').toLowerCase();
      if (!email) return;
      if (!EMAIL_RE.test(email)) {
        showFieldError('compose-to-error', '"' + email + '" is not a valid email address.');
        return;
      }
      if (recipients.indexOf(email) !== -1) {
        showFieldError('compose-to-error', '"' + email + '" is already in the recipient list.');
        return;
      }
      showFieldError('compose-to-error', '');
      recipients.push(email);
      renderChips();
      markDirty(); updateSummary();
    }

    function removeRecipient(idx) {
      recipients.splice(idx, 1);
      renderChips();
      updateSummary();
    }

    function renderChips() {
      var box = document.getElementById('compose-chips');
      box.innerHTML = recipients.map(function (email, i) {
        return '<span class="recipient-chip"><span class="rc-email">' + UI.esc(email) + '</span>' +
          '<button type="button" data-idx="' + i + '" aria-label="Remove ' + UI.esc(email) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
          '</button></span>';
      }).join('');
      box.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () { removeRecipient(Number(b.getAttribute('data-idx'))); });
      });
    }

    function showFieldError(id, msg) {
      var el = document.getElementById(id);
      el.textContent = msg;
      el.classList.toggle('hidden', !msg);
    }

    function openSubscriberPicker() {
      var m = UI.modal({
        title: 'Pick subscribers',
        sub: 'Search and select subscriber addresses. Unsubscribed and suppressed addresses are always skipped by the backend at send time.',
        size: 'lg',
        body:
          '<div class="input-wrap" style="margin-bottom:12px"><i data-lucide="search" class="input-icon"></i>' +
          '<input type="search" class="form-input has-icon" id="pick-search" placeholder="Search by email or name…"/></div>' +
          '<div class="table-wrap" style="max-height:320px;overflow-y:auto;border:1px solid var(--c-border);border-radius:10px">' +
          '<table class="data-table" style="min-width:0"><thead><tr>' +
          '<th style="width:36px"></th><th>Email</th><th>Name</th><th>Status</th></tr></thead>' +
          '<tbody id="pick-tbody"></tbody></table></div>' +
          '<div class="state-box" id="pick-state"></div>' +
          '<div class="table-footer" style="border-top:0"><div class="table-info" id="pick-info"></div>' +
          '<nav class="pagination" id="pick-pagination"></nav></div>',
        foot:
          '<button class="btn btn-secondary" data-close>Cancel</button>' +
          '<button class="btn btn-primary" id="pick-add">Add selected</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          var page = 1, search = '';
          var pickerSelected = [];

          var debounced = UI.debounce(function () {
            search = box.querySelector('#pick-search').value.trim();
            page = 1;
            load();
          }, 350);
          box.querySelector('#pick-search').addEventListener('input', debounced);

          function load() {
            var tbody = box.querySelector('#pick-tbody');
            UI.skeletonRows(tbody, 4, 5);
            API.get(EP.subscribers.list, { page: page, limit: 10, search: search || undefined })
              .then(function (payload) {
                var items = UI.extractList(payload);
                var total = UI.extractTotal(payload, items.length);
                var totalPages = UI.extractTotalPages(payload, total, 10);
                if (!items.length) {
                  tbody.innerHTML = '';
                  UI.renderState(box.querySelector('#pick-state'), { type: 'empty', title: 'No subscribers found', text: search ? 'No match for "' + search + '".' : 'The backend returned no subscribers.' });
                  return;
                }
                UI.renderState(box.querySelector('#pick-state'), { type: 'clear' });
                tbody.innerHTML = items.map(function (s) {
                  var email = s.email || s.address || '';
                  var status = String(s.status || 'active').toLowerCase();
                  var disabled = status === 'unsubscribed' || status === 'complained' || status === 'bounced' || s.suppressed === true;
                  return '<tr>' +
                    '<td><input type="checkbox" data-email="' + UI.esc(email) + '"' + (disabled ? ' disabled title="Cannot receive email (status: ' + UI.esc(status) + ')"' : '') + '/></td>' +
                    '<td><div class="cell-main">' + UI.esc(email) + '</div></td>' +
                    '<td>' + UI.esc(s.name || s.full_name || '—') + '</td>' +
                    '<td>' + UI.statusBadge(s.status) + (disabled ? ' <span class="cell-sub">skipped by backend</span>' : '') + '</td>' +
                  '</tr>';
                }).join('');

                tbody.querySelectorAll('input[type="checkbox"]:not([disabled])').forEach(function (cb) {
                  cb.addEventListener('change', function () {
                    var email = cb.getAttribute('data-email');
                    if (cb.checked) { if (pickerSelected.indexOf(email) === -1) pickerSelected.push(email); }
                    else pickerSelected = pickerSelected.filter(function (e2) { return e2 !== email; });
                  });
                });

                box.querySelector('#pick-info').textContent = UI.fmt.number(total) + ' subscribers';
                UI.pagination(box.querySelector('#pick-pagination'), {
                  page: page, totalPages: totalPages, total: total,
                  onPage: function (p) { page = p; load(); }
                });
              })
              .catch(function (err) {
                tbody.innerHTML = '';
                UI.renderState(box.querySelector('#pick-state'), { type: 'error', title: 'Could not load subscribers', error: err, retry: load });
              });
          }

          box.querySelector('#pick-add').addEventListener('click', function () {
            var added = 0;
            pickerSelected.forEach(function (email) {
              if (recipients.indexOf(email) === -1) { recipients.push(email); added++; }
            });
            renderChips(); updateSummary();
            close();
            UI.toast(added ? 'success' : 'info', added ? added + ' recipients added' : 'Nothing added', added ? '' : 'Selected addresses were already in the list.');
          });

          load();
        }
      });
    }

    /* ---------------------------------------------------------------- */
    /* Actions                                                           */
    /* ---------------------------------------------------------------- */
    function bindActions() {
      document.getElementById('compose-load-template').addEventListener('click', openTemplatePicker);
      document.getElementById('compose-preview').addEventListener('click', openPreview);
      document.getElementById('compose-test').addEventListener('click', sendTest);
      document.getElementById('compose-save-draft').addEventListener('click', saveDraft);
      document.getElementById('compose-clear-draft').addEventListener('click', clearDraft);
      document.getElementById('compose-send').addEventListener('click', sendEmail);
    }

    function validate() {
      var ok = true;
      if (!recipients.length) { showFieldError('compose-to-error', 'Add at least one recipient.'); ok = false; }
      else showFieldError('compose-to-error', '');
      if (!getSubject().trim()) { showFieldError('compose-subject-error', 'Subject is required.'); ok = false; }
      else showFieldError('compose-subject-error', '');
      var text = getHtml().replace(/<(.|\n)*?>/g, '').trim();
      if (!text && !/<img/i.test(getHtml())) { showFieldError('compose-content-error', 'Write the email body before sending.'); ok = false; }
      else showFieldError('compose-content-error', '');
      return ok;
    }

    function buildPayload() {
      return {
        to: recipients.slice(),
        subject: getSubject().trim(),
        html: getHtml(),
        text: htmlToText(getHtml()),
        sender_name: val('compose-from-name') || undefined,
        sender_email: val('compose-from-email') || undefined,
        type: val('compose-email-type') || 'manual',
        note: val('compose-notes') || undefined
      };
    }

    function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
    function getSubject() { return (document.getElementById('compose-subject') || {}).value || ''; }

    function htmlToText(html) {
      var d = document.createElement('div');
      d.innerHTML = html;
      return (d.textContent || '').replace(/\s+\n/g, '\n').trim();
    }

    function withBusy(btn, on, labelBusy) {
      var label = btn.querySelector('span');
      var spinner = btn.querySelector('.btn-spinner');
      if (on) { btn.dataset.label = label.textContent; btn.disabled = true; if (!spinner) { spinner = document.createElement('span'); spinner.className = 'btn-spinner'; btn.prepend(spinner); } spinner.classList.remove('hidden'); if (label && labelBusy) label.textContent = labelBusy; }
      else { btn.disabled = false; if (spinner) spinner.classList.add('hidden'); if (label && btn.dataset.label) label.textContent = btn.dataset.label; }
    }

    function sendEmail() {
      if (!validate()) { UI.toast('warning', 'Check the form', 'Some required fields are missing or invalid.'); return; }
      var payload = buildPayload();
      UI.confirm({
        title: 'Send this email?',
        message:
          'To: <strong>' + UI.esc(payload.to.join(', ')) + '</strong><br/>' +
          'Subject: <strong>' + UI.esc(payload.subject) + '</strong><br/><br/>' +
          'The backend enforces suppression rules at send time.',
        confirmLabel: 'Send now', danger: false
      }).then(function (ok) {
        if (!ok) return;
        var btn = document.getElementById('compose-send');
        withBusy(btn, true, 'Sending…');
        API.post(EP.compose.send, payload)
          .then(function (res) {
            withBusy(btn, false);
            dirty = false;
            UI.toast('success', 'Email sent', 'The backend accepted the message' + (res && res.message_id ? ' (ID ' + res.message_id + ')' : '') + '.');
            clearDraft(true);
            resetComposer();
          })
          .catch(function (err) { withBusy(btn, false); UI.toast('error', 'Send failed', err.message); });
      });
    }

    function sendTest() {
      if (!getSubject().trim()) { UI.toast('warning', 'Subject required', 'Add a subject before sending a test.'); return; }
      if (!getHtml().trim()) { UI.toast('warning', 'Empty body', 'Write the email before sending a test.'); return; }
      UI.modal({
        title: 'Send test email',
        sub: 'Uses POST /api/admin/emails/test. Nothing is stored in history unless the backend does so.',
        size: 'sm',
        body: '<div class="form-group"><label class="form-label">Test recipient *</label>' +
              '<input type="email" class="form-input" id="test-to" placeholder="you@company.com"/></div>',
        foot: '<button class="btn btn-secondary" data-close>Cancel</button>' +
              '<button class="btn btn-primary" id="test-go">Send test</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          box.querySelector('#test-go').addEventListener('click', function () {
            var to = box.querySelector('#test-to').value.trim();
            if (!EMAIL_RE.test(to)) { UI.toast('warning', 'Invalid address', 'Enter a valid test email address.'); return; }
            var btn = this;
            btn.disabled = true;
            API.post(EP.compose.test, { to: to, subject: '[TEST] ' + getSubject().trim(), html: getHtml() })
              .then(function () { close(); UI.toast('success', 'Test sent', 'Sent to ' + to + '.'); })
              .catch(function (err) {
                btn.disabled = false;
                if (err.kind === 'NOT_FOUND') UI.toast('warning', 'Not supported', 'The test endpoint is not implemented on the backend. You can send normally instead.');
                else UI.toast('error', 'Test failed', err.message);
              });
          });
        }
      });
    }

    function saveDraft() {
      var draft = {
        to: recipients,
        subject: getSubject(),
        html: getHtml(),
        sender_name: val('compose-from-name'),
        sender_email: val('compose-from-email'),
        type: val('compose-email-type'),
        notes: val('compose-notes'),
        saved_at: new Date().toISOString()
      };
      try {
        localStorage.setItem(CFG.STORAGE.DRAFT, JSON.stringify(draft));
      } catch (e) {
        UI.toast('error', 'Could not save draft', 'Browser storage is unavailable.');
        return;
      }
      dirty = false;
      updateSummary();
      document.getElementById('sum-draft').textContent = UI.fmt.time(draft.saved_at);
      document.getElementById('compose-draft-info').innerHTML =
        '<div class="summary-row"><span>Saved</span><strong>' + UI.esc(UI.fmt.dateTime(draft.saved_at)) + '</strong></div>' +
        '<div class="summary-row"><span>Subject</span><strong>' + UI.esc(draft.subject || '—') + '</strong></div>';
      UI.toast('success', 'Draft saved', 'Stored locally on this device.');
    }

    function restoreDraft() {
      var raw;
      try { raw = localStorage.getItem(CFG.STORAGE.DRAFT); } catch (e) { return; }
      if (!raw) return;
      var d;
      try { d = JSON.parse(raw); } catch (e) { return; }
      recipients = (d.to || []).slice();
      renderChips();
      document.getElementById('compose-subject').value = d.subject || '';
      document.getElementById('compose-from-name').value = d.sender_name || '';
      document.getElementById('compose-from-email').value = d.sender_email || '';
      document.getElementById('compose-email-type').value = d.type || 'manual';
      document.getElementById('compose-notes').value = d.notes || '';
      setHtml(d.html || '');
      if (d.saved_at) {
        document.getElementById('sum-draft').textContent = UI.fmt.time(d.saved_at);
        document.getElementById('compose-draft-info').innerHTML =
          '<div class="summary-row"><span>Restored</span><strong>' + UI.esc(UI.fmt.dateTime(d.saved_at)) + '</strong></div>' +
          '<div class="summary-row"><span>Subject</span><strong>' + UI.esc(d.subject || '—') + '</strong></div>';
        UI.toast('info', 'Draft restored', 'A locally saved draft from ' + UI.fmt.dateTime(d.saved_at) + ' was loaded.');
      }
      updateSummary();
    }

    function clearDraft(silent) {
      try { localStorage.removeItem(CFG.STORAGE.DRAFT); } catch (e) { /* ignore */ }
      document.getElementById('sum-draft').textContent = 'No';
      document.getElementById('compose-draft-info').innerHTML = '';
      if (!silent) UI.toast('info', 'Draft cleared', '');
    }

    function resetComposer() {
      recipients = [];
      renderChips();
      document.getElementById('compose-subject').value = '';
      document.getElementById('compose-notes').value = '';
      setHtml('');
      document.getElementById('compose-editor-html').value = '';
      updateSummary();
    }

    /* ---------------------------------------------------------------- */
    /* Preview + template picker + sender defaults                       */
    /* ---------------------------------------------------------------- */
    function openPreview() {
      UI.modal({
        title: 'Email preview',
        sub: 'Rendered in a fully sandboxed frame — scripts and external navigation are blocked.',
        size: 'lg',
        body:
          '<div class="preview-meta">' +
          '<div><b>From:</b> ' + UI.esc((val('compose-from-name') || 'SMMARIA default sender')) +
          (val('compose-from-email') ? ' &lt;' + UI.esc(val('compose-from-email')) + '&gt;' : '') + '</div>' +
          '<div><b>Subject:</b> ' + UI.esc(getSubject() || '(no subject)') + '</div>' +
          '<div><b>To:</b> ' + UI.esc(recipients.join(', ') || '(no recipients)') + '</div>' +
          '</div>',
        onOpen: function (box) {
          box.querySelector('.modal-body').appendChild(UI.previewIframe(getHtml()));
        }
      });
    }

    function openTemplatePicker() {
      var m = UI.modal({
        title: 'Load a template',
        sub: 'Templates come from the backend. Loading one overwrites the current body and subject.',
        size: 'lg',
        body:
          '<div class="input-wrap" style="margin-bottom:12px"><i data-lucide="search" class="input-icon"></i>' +
          '<input type="search" class="form-input has-icon" id="tplpick-search" placeholder="Search templates…"/></div>' +
          '<div id="tplpick-list" style="max-height:340px;overflow-y:auto;display:grid;gap:10px"></div>',
        foot: '<button class="btn btn-secondary" data-close>Cancel</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          var debounced = UI.debounce(load, 300);
          box.querySelector('#tplpick-search').addEventListener('input', debounced);
          load();

          function load() {
            var list = box.querySelector('#tplpick-list');
            list.innerHTML = '<div class="state-loading"><div class="entry-spinner" style="margin:0"></div></div>';
            API.get(EP.templates.list, { limit: 30, search: box.querySelector('#tplpick-search').value.trim() || undefined })
              .then(function (payload) {
                var items = UI.extractList(payload);
                if (!items.length) {
                  list.innerHTML = '<div class="mini-empty">No templates found on the backend.<br/>Create templates in the Templates page first.</div>';
                  return;
                }
                list.innerHTML = items.map(function (t) {
                  var id = t.id !== undefined ? t.id : t._id;
                  return '<button type="button" class="quick-action" data-tpl="' + UI.esc(id) + '" style="text-align:left">' +
                    '<span class="qa-label">' + UI.esc(t.name || 'Untitled template') + '</span>' +
                    '<span class="qa-sub">' + UI.esc(t.subject || '(no subject)') + '</span>' +
                    (t.category ? '<span class="badge badge-indigo" style="align-self:flex-start;margin-top:4px">' + UI.esc(t.category) + '</span>' : '') +
                  '</button>';
                }).join('');
                list.querySelectorAll('[data-tpl]').forEach(function (b) {
                  b.addEventListener('click', function () { applyTemplate(b.getAttribute('data-tpl'), close); });
                });
              })
              .catch(function (err) {
                list.innerHTML = '<div class="mini-empty">Could not load templates.<br/>' + UI.esc(err.message) + '</div>';
              });
          }

          function applyTemplate(id, close) {
            API.get(EP.templates.get, null, { repl: { id: id } })
              .then(function (t) {
                close();
                if (t.subject) document.getElementById('compose-subject').value = t.subject;
                setHtml(t.html || t.body || t.body_html || '');
                document.getElementById('compose-editor-html').value = getHtml();
                markDirty(); updateSummary();
                UI.toast('success', 'Template loaded', (t.name || 'Template') + ' applied to the composer.');
              })
              .catch(function (err) {
                if (err.kind === 'NOT_FOUND') UI.toast('warning', 'Endpoint missing', 'GET /api/admin/templates/:id is not implemented on the backend.');
                else UI.toast('error', 'Could not load template', err.message);
              });
          }
        }
      });
    }

    function loadSenderDefaults() {
      API.get(EP.settings.get)
        .then(function (s) {
          if (!s || typeof s !== 'object') return;
          var gen = s.general || s;
          if (gen.default_sender_name && !val('compose-from-name')) document.getElementById('compose-from-name').value = gen.default_sender_name;
          if (gen.default_sender_email && !val('compose-from-email')) document.getElementById('compose-from-email').value = gen.default_sender_email;
        })
        .catch(function () { /* settings unavailable — leave inputs empty */ });
    }

    function updateSummary() {
      document.getElementById('sum-recipients').textContent = String(recipients.length);
      document.getElementById('sum-subject').textContent = getSubject() || '—';
    }
  });
})();
