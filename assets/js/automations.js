/* ============================================================================
 * SMMARIA Email Manager — automations.js
 * ----------------------------------------------------------------------------
 * Backend endpoints used:
 *   GET  /api/admin/automations             list of rules AS THE BACKEND DEFINES THEM
 *   PUT  /api/admin/automations/:id         { enabled, template_id?, delay_minutes?, ... }
 *   GET  /api/admin/automations/:id/history (optional) execution log
 *
 * IMPORTANT: this page renders whatever the backend returns. No hardcoded
 * rule list is treated as truth. If the backend reports zero automations,
 * the page shows an honest empty state explaining the backend exposes none.
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG, UI = window.SMMUI, API = window.SMMApi;
  var EP = CFG.ENDPOINTS.automations;

  /* Presentation hints for known event keys. Unknown keys still render —
     with generic icon/labels derived from the backend's own fields. */
  var EVENT_HINTS = {
    user_registered:    { icon: 'user-plus',      tone: 'kpi-indigo', label: 'New user registration' },
    order_created:      { icon: 'package',        tone: 'kpi-blue',   label: 'Order created' },
    order_completed:    { icon: 'package-check',  tone: 'kpi-green',  label: 'Order completed' },
    payment_successful: { icon: 'credit-card',    tone: 'kpi-green',  label: 'Payment successful' },
    payment_failed:     { icon: 'credit-card',    tone: 'kpi-red',    label: 'Payment failed' },
    account_purchased:  { icon: 'shopping-bag',   tone: 'kpi-purple', label: 'Account purchased' },
    invoice_created:    { icon: 'receipt',        tone: 'kpi-amber',  label: 'Invoice created' },
    wallet_low_balance: { icon: 'wallet',         tone: 'kpi-amber',  label: 'Wallet low balance' },
    support_reply:      { icon: 'message-circle', tone: 'kpi-blue',   label: 'Support reply created' }
  };

  document.addEventListener('DOMContentLoaded', function () {
    var list = document.getElementById('auto-list');
    var stateBox = document.getElementById('auto-state');
    var summary = document.getElementById('auto-summary');

    document.getElementById('auto-refresh').addEventListener('click', function () { load(); UI.toast('info', 'Refreshed', 'Automations reloaded from the backend.'); });

    load();

    function load() {
      UI.renderState(list, { type: 'loading' });
      summary.setAttribute('aria-busy', 'true');
      summary.innerHTML = '<div class="card" style="margin:0"><div class="skeleton-block" style="width:40%"></div></div>'.repeat ? '' : '';
      summary.innerHTML =
        '<div class="card" style="margin:0"><div class="skeleton-block" style="width:45%"></div><div class="skeleton-block" style="width:30%;margin-top:8px"></div></div>' +
        '<div class="card" style="margin:0"><div class="skeleton-block" style="width:45%"></div><div class="skeleton-block" style="width:30%;margin-top:8px"></div></div>' +
        '<div class="card" style="margin:0"><div class="skeleton-block" style="width:45%"></div><div class="skeleton-block" style="width:30%;margin-top:8px"></div></div>';

      API.get(EP.list).then(function (payload) {
        var items = UI.extractList(payload);
        renderSummary(items);
        if (!items.length) {
          list.innerHTML = '';
          UI.renderState(list, {
            type: 'empty', icon: 'zap', title: 'No automations reported by the backend',
            text: 'The backend did not return any automation rules. Automated emails (registration, orders, payments, invoices…) must be registered on the backend side first — this panel only manages existing rules.',
            action: '<button class="btn btn-secondary btn-sm" id="auto-retry"><i data-lucide="rotate-cw" class="btn-icon"></i><span>Reload</span></button>'
          });
          var b = document.getElementById('auto-retry');
          b && b.addEventListener('click', load);
          return;
        }
        list.innerHTML = items.map(cardHtml).join('');
        wireCards(items);
        if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
      }).catch(function (err) {
        summary.innerHTML = '';
        UI.renderState(list, { type: 'error', title: 'Could not load automations', error: err, retry: load });
      });
    }

    function renderSummary(items) {
      var enabled = items.filter(function (a) { return isTruthy(a.enabled); }).length;
      var failing = items.filter(function (a) {
        var f = a.failure_count !== undefined ? a.failure_count : (a.failed_executions !== undefined ? a.failed_executions : 0);
        return Number(f) > 0;
      }).length;
      var boxes = [
        { label: 'Rules reported by backend', value: UI.fmt.number(items.length), icon: 'list', tone: 'kpi-indigo' },
        { label: 'Enabled', value: UI.fmt.number(enabled), icon: 'toggle-right', tone: 'kpi-green' },
        { label: 'Rules with recent failures', value: UI.fmt.number(failing), icon: 'alert-triangle', tone: failing ? 'kpi-red' : 'kpi-neutral' }
      ];
      summary.setAttribute('aria-busy', 'false');
      summary.innerHTML = boxes.map(function (b) {
        return '<div class="kpi-card" style="margin-bottom:0">' +
          '<span class="kpi-icon ' + b.tone + '"><i data-lucide="' + b.icon + '"></i></span>' +
          '<div class="kpi-body"><div class="kpi-label">' + UI.esc(b.label) + '</div>' +
          '<div class="kpi-value">' + UI.esc(b.value) + '</div></div></div>';
      }).join('');
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
    }

    function cardHtml(a) {
      var id = a.id !== undefined ? a.id : a._id;
      var enabled = isTruthy(a.enabled);
      var key = String(a.event || a.event_type || a.key || '').toLowerCase();
      var hint = EVENT_HINTS[key] || { icon: 'zap', tone: 'kpi-neutral', label: null };
      var title = a.name || a.title || hint.label || key.replace(/_/g, ' ') || 'Automation rule';

      var lastRun = a.last_run_at || a.last_executed_at || a.last_execution;
      var failCount = a.failure_count !== undefined ? a.failure_count
        : a.failed_executions !== undefined ? a.failed_executions : null;

      return '<div class="auto-card' + (enabled ? '' : ' disabled') + '" data-id="' + UI.esc(id) + '">' +
        '<span class="auto-icon ' + hint.tone.replace('kpi-', 'qa-') + '"><i data-lucide="' + hint.icon + '"></i></span>' +
        '<div class="auto-body">' +
          '<div class="auto-name">' + UI.esc(title) + ' ' + (enabled ? UI.statusBadge('true') : UI.statusBadge('false')) + '</div>' +
          '<div class="auto-desc">' + UI.esc(a.description || ('Trigger: ' + (key.replace(/_/g, ' ') || 'unknown event'))) + '</div>' +
          '<div class="auto-meta">' +
            (a.template_name || a.template_id ? '<span><i data-lucide="layout-template"></i>Template: ' + UI.esc(a.template_name || a.template_id) + '</span>' : '') +
            (a.delay_minutes !== undefined && a.delay_minutes !== null ? '<span><i data-lucide="clock"></i>Delay: ' + UI.esc(String(a.delay_minutes)) + ' min</span>' : '') +
            (lastRun ? '<span><i data-lucide="history"></i>Last run: ' + UI.esc(UI.fmt.timeAgo(lastRun)) + '</span>' : '<span><i data-lucide="history"></i>Never executed</span>') +
            (failCount !== null && Number(failCount) > 0 ? '<span style="color:var(--c-danger)"><i data-lucide="x-circle"></i>' + UI.fmt.number(failCount) + ' failures</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="auto-actions">' +
          '<label class="switch-label" title="' + (enabled ? 'Disable' : 'Enable') + ' this automation">' +
            '<span class="switch"><input type="checkbox" data-act="toggle"' + (enabled ? ' checked' : '') + '/><span class="slider"></span></span>' +
            '<span>' + (enabled ? 'Enabled' : 'Disabled') + '</span>' +
          '</label>' +
          '<button class="btn btn-sm btn-secondary" data-act="configure"><i data-lucide="settings-2" class="btn-icon"></i><span>Configure</span></button>' +
          '<button class="btn btn-sm btn-ghost" data-act="history"><i data-lucide="history" class="btn-icon"></i><span>History</span></button>' +
        '</div>' +
      '</div>';
    }

    function wireCards(items) {
      document.querySelectorAll('.auto-card').forEach(function (card) {
        var id = card.getAttribute('data-id');
        var a = items.find(function (x) { return String(x.id !== undefined ? x.id : x._id) === String(id); });
        if (!a) return;

        card.querySelector('[data-act="toggle"]').addEventListener('change', function (e) {
          setEnabled(a, e.target.checked, card);
        });
        card.querySelector('[data-act="configure"]').addEventListener('click', function () { configure(a, card); });
        card.querySelector('[data-act="history"]').addEventListener('click', function () { showHistory(a); });
      });
    }

    function isTruthy(v) {
      return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'enabled' || String(v).toLowerCase() === 'active';
    }

    function setEnabled(a, enabled, card) {
      var id = a.id !== undefined ? a.id : a._id;
      var label = card.querySelector('.auto-actions .switch-label span:last-child');
      API.put(EP.update.replace(':id', id), { enabled: enabled })
        .then(function () {
          card.classList.toggle('disabled', !enabled);
          if (label) label.textContent = enabled ? 'Enabled' : 'Disabled';
          UI.toast('success', enabled ? 'Automation enabled' : 'Automation disabled',
            (a.name || a.event || 'Rule') + (enabled ? ' will fire on its trigger events.' : ' will no longer fire.'));
          load(); // refresh summary counters
        })
        .catch(function (err) {
          // revert the switch
          var input = card.querySelector('[data-act="toggle"]');
          input.checked = !enabled;
          if (err.kind === 'NOT_FOUND') UI.toast('warning', 'Not supported', 'PUT /api/admin/automations/:id is not implemented on the backend.');
          else UI.toast('error', 'Could not update automation', err.message);
        });
    }

    function configure(a, card) {
      var id = a.id !== undefined ? a.id : a._id;
      API.get(CFG.ENDPOINTS.templates.list, { limit: 50 })
        .then(function (payload) { return UI.extractList(payload); })
        .catch(function () { return []; })
        .then(function (templates) {
          UI.modal({
            title: 'Configure: ' + (a.name || a.event || 'Automation'),
            sub: 'Only configuration fields the backend accepts are sent. Fields the backend does not support are ignored with a notice.',
            size: 'sm',
            body:
              '<div class="form-group"><label class="form-label">Email template</label>' +
              '<select class="form-input" id="au-template">' +
                '<option value="">— keep current —</option>' +
                templates.map(function (t) {
                  var tid = t.id !== undefined ? t.id : t._id;
                  var cur = String(a.template_id) === String(tid) ? ' selected' : '';
                  return '<option value="' + UI.esc(tid) + '"' + cur + '>' + UI.esc(t.name || 'Template') + '</option>';
                }).join('') +
              '</select></div>' +
              '<div class="form-group"><label class="form-label">Delay before sending (minutes)</label>' +
              '<input type="number" class="form-input" id="au-delay" min="0" step="1" value="' + UI.esc(a.delay_minutes !== undefined && a.delay_minutes !== null ? a.delay_minutes : 0) + '"/>' +
              '<p class="form-hint">0 = send immediately when the event fires.</p></div>',
            foot:
              '<button class="btn btn-secondary" data-close>Cancel</button>' +
              '<button class="btn btn-primary" id="au-save">Save configuration</button>',
            onOpen: function (box, close) {
              box.querySelector('[data-close]').addEventListener('click', close);
              box.querySelector('#au-save').addEventListener('click', function () {
                var payload = {};
                var tpl = box.querySelector('#au-template').value;
                var delay = box.querySelector('#au-delay').value;
                if (tpl) payload.template_id = tpl;
                if (delay !== '' && !isNaN(Number(delay))) payload.delay_minutes = Number(delay);
                if (!Object.keys(payload).length) { close(); return; }

                var btn = this;
                btn.disabled = true;
                API.put(EP.update.replace(':id', id), payload)
                  .then(function () { close(); UI.toast('success', 'Configuration saved', ''); load(); })
                  .catch(function (err) {
                    btn.disabled = false;
                    UI.toast('error', 'Save failed', err.message);
                  });
              });
            }
          });
        });
    }

    function showHistory(a) {
      var id = a.id !== undefined ? a.id : a._id;
      UI.modal({
        title: 'Execution history',
        sub: (a.name || a.event || 'Automation') + ' — from GET /api/admin/automations/:id/history',
        size: 'lg',
        body: '<div id="au-history"><div class="state-loading"><div class="entry-spinner" style="margin:0"></div><p class="se-text">Loading history…</p></div></div>',
        foot: '<button class="btn btn-secondary" data-close>Close</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);
          var wrap = box.querySelector('#au-history');
          API.get(EP.history.replace(':id', id), { page: 1, limit: 20 })
            .then(function (payload) {
              var items = UI.extractList(payload);
              if (!items.length) {
                wrap.innerHTML = '<div class="mini-empty">No executions recorded yet.<br/>This automation has never fired (or the backend keeps no history).</div>';
                return;
              }
              wrap.innerHTML = '<div class="table-wrap"><table class="mini-table"><thead><tr>' +
                '<th>Time</th><th>Recipient</th><th>Result</th><th>Detail</th></tr></thead><tbody>' +
                items.map(function (h) {
                  return '<tr>' +
                    '<td class="nowrap">' + UI.esc(UI.fmt.dateTime(h.created_at || h.executed_at || h.time)) + '</td>' +
                    '<td>' + UI.esc(h.recipient || h.email || h.to || '—') + '</td>' +
                    '<td>' + UI.statusBadge(h.status || (isTruthy(h.success) ? 'sent' : 'failed')) + '</td>' +
                    '<td>' + UI.esc(h.error || h.detail || h.message || '—') + '</td>' +
                  '</tr>';
                }).join('') + '</tbody></table></div>';
            })
            .catch(function (err) {
              if (err.kind === 'NOT_FOUND') {
                wrap.innerHTML = '<div class="mini-empty">The backend does not expose GET /api/admin/automations/:id/history.<br/>Execution history is unavailable until the backend implements it (see README).</div>';
              } else {
                wrap.innerHTML = '<div class="mini-empty">Could not load history.<br/>' + UI.esc(err.message) + '</div>';
              }
            });
        }
      });
    }
  });
})();
