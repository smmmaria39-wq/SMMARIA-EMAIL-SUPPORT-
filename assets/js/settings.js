/* ============================================================================
 * SMMARIA Email Manager — settings.js
 * ----------------------------------------------------------------------------
 * Backend endpoints used:
 *   GET /api/admin/settings   current settings (secrets must never be returned)
 *   PUT /api/admin/settings   save changed fields
 *   GET /api/admin/health     backend / email provider / queue health
 *
 * Rendering rule: the form is generated from the backend response. Sections
 * or fields the backend does not return are not displayed (no fake inputs),
 * and each tab explains what it expects. Secret-looking fields are skipped.
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG, UI = window.SMMUI, API = window.SMMApi;
  var EP = CFG.ENDPOINTS.settings;

  var original = null;   // settings as returned by the backend
  var healthData = null;

  /* Field descriptors per section. `path` is a dot-path into the settings
     object. Only fields actually present in the response are rendered. */
  var SECTIONS = {
    general: {
      title: 'General',
      expect: 'system_name, default_sender_name, default_sender_email, reply_to',
      fields: [
        { path: 'general.system_name || system_name', label: 'System name', type: 'text', placeholder: 'SMMARIA' },
        { path: 'general.default_sender_name || default_sender_name', label: 'Default sender name', type: 'text', placeholder: 'SMMARIA' },
        { path: 'general.default_sender_email || default_sender_email', label: 'Default sender email', type: 'email', placeholder: 'no-reply@smmaria.com' },
        { path: 'general.reply_to || reply_to', label: 'Reply-to address', type: 'email', placeholder: 'support@smmaria.com' }
      ]
    },
    delivery: {
      title: 'Delivery',
      expect: 'provider name/status, sending limits, retry configuration',
      fields: [
        { path: 'delivery.provider || provider', label: 'Email provider', type: 'text', readOnly: true },
        { path: 'delivery.from_email || from_email', label: 'Provider from address', type: 'email' },
        { path: 'delivery.daily_limit || daily_limit || limits.daily', label: 'Daily sending limit', type: 'number' },
        { path: 'delivery.hourly_limit || hourly_limit || limits.hourly', label: 'Hourly sending limit', type: 'number' },
        { path: 'delivery.max_retries || max_retries || retry.max_attempts', label: 'Max retry attempts', type: 'number' },
        { path: 'delivery.retry_delay_minutes || retry.delay_minutes', label: 'Retry delay (minutes)', type: 'number' }
      ]
    },
    campaigns: {
      title: 'Campaigns',
      expect: 'default campaign and unsubscribe configuration',
      fields: [
        { path: 'campaigns.default_segment || default_segment', label: 'Default recipient segment', type: 'select', options: function () { return CFG.SEGMENTS; } },
        { path: 'campaigns.include_unsubscribe_link || include_unsubscribe_link', label: 'Append unsubscribe link', type: 'toggle' },
        { path: 'campaigns.unsubscribe_url || unsubscribe_url', label: 'Unsubscribe URL', type: 'text', placeholder: 'https://smmaria.com/unsubscribe' },
        { path: 'campaigns.track_opens || track_opens', label: 'Track email opens', type: 'toggle' },
        { path: 'campaigns.track_clicks || track_clicks', label: 'Track link clicks', type: 'toggle' }
      ]
    },
    security: {
      title: 'Security',
      expect: 'session and API connection information (read-only)',
      fields: [
        { path: 'security.session_timeout_minutes || session_timeout_minutes', label: 'Session timeout (minutes)', type: 'number' },
        { path: 'security.allow_multiple_sessions || allow_multiple_sessions', label: 'Allow concurrent admin sessions', type: 'toggle' }
      ],
      renderExtra: 'security'
    },
    notifications: {
      title: 'Notifications',
      expect: 'failure, queue and system alert configuration',
      fields: [
        { path: 'notifications.alert_email || alert_email', label: 'Alert recipient email', type: 'email' },
        { path: 'notifications.on_failure || on_failure', label: 'Notify on failed emails', type: 'toggle' },
        { path: 'notifications.on_queue_backlog || on_queue_backlog', label: 'Notify on queue backlog', type: 'toggle' },
        { path: 'notifications.on_provider_down || on_provider_down', label: 'Notify when provider is down', type: 'toggle' }
      ]
    },
    system: {
      title: 'System',
      expect: 'backend / provider / queue health + last successful connection',
      fields: [],
      renderExtra: 'system'
    }
  };

  var SECRET_RE = /(secret|password|api_?key|private|token|credential)/i;

  document.addEventListener('DOMContentLoaded', function () {
    var tabs = document.getElementById('set-tabs');
    var saveBtn = document.getElementById('set-save');
    var stateBox = document.getElementById('set-state');

    tabs.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        var name = tab.getAttribute('data-tab');
        document.querySelectorAll('.set-panel').forEach(function (p) { p.classList.add('hidden'); });
        document.getElementById('set-panel-' + name).classList.remove('hidden');
      });
    });

    document.getElementById('set-reload').addEventListener('click', function () { load(); UI.toast('info', 'Reloaded', 'Settings fetched from the backend.'); });
    saveBtn.addEventListener('click', save);

    load();

    /* ---------------------------------------------------------------- */
    function load() {
      saveBtn.disabled = true;
      UI.renderState(stateBox, { type: 'loading' });
      Object.keys(SECTIONS).forEach(function (key) {
        var panel = document.getElementById('set-panel-' + key);
        panel.innerHTML = '<div class="card" style="margin:0"><div class="skeleton-block" style="width:30%"></div><div class="skeleton-block" style="width:60%;margin-top:10px"></div><div class="skeleton-block" style="width:50%;margin-top:10px"></div></div>';
      });

      Promise.allSettled([
        API.get(EP.get),
        API.get(EP.health)
      ]).then(function (res) {
        UI.renderState(stateBox, { type: 'clear' });

        if (res[0].status === 'fulfilled') {
          original = res[0].value || {};
          renderAll();
          saveBtn.disabled = false;
        } else {
          original = null;
          renderAll();
          UI.renderState(stateBox, {
            type: 'error',
            title: 'Could not load settings',
            error: res[0].reason,
            retry: load
          });
        }

        healthData = res[1].status === 'fulfilled' ? res[1].value : { __error: res[1].reason };
      });
    }

    /* ---------------------------------------------------------------- */
    function getPath(obj, expr) {
      // Supports the tiny "a.b || c" syntax used in the field descriptors.
      var alternatives = expr.split('||').map(function (s) { return s.trim(); });
      for (var i = 0; i < alternatives.length; i++) {
        var v = alternatives[i].split('.').reduce(function (o, k) {
          return o && o[k] !== undefined ? o[k] : undefined;
        }, obj);
        if (v !== undefined && v !== null) return v;
      }
      return undefined;
    }

    function setPath(obj, expr, value) {
      // Write to the FIRST path alternative so backend merges stay predictable.
      var first = expr.split('||')[0].trim().split('.');
      var cur = obj;
      for (var i = 0; i < first.length - 1; i++) {
        if (typeof cur[first[i]] !== 'object' || cur[first[i]] === null) cur[first[i]] = {};
        cur = cur[first[i]];
      }
      cur[first[first.length - 1]] = value;
    }

    function isSecretPath(expr) {
      return SECRET_RE.test(expr);
    }

    function renderAll() {
      Object.keys(SECTIONS).forEach(function (key) {
        renderSection(key);
      });
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
    }

    function renderSection(key) {
      var section = SECTIONS[key];
      var panel = document.getElementById('set-panel-' + key);
      var hasData = !!original;

      var html = '<div class="card"><div class="card-head"><div>' +
        '<h2 class="card-title">' + UI.esc(section.title) + '</h2>' +
        '<p class="card-sub">Expected from backend: <code>' + UI.esc(section.expect) + '</code></p></div></div>';

      if (!hasData) {
        html += '<p class="mini-empty">Settings could not be loaded from the backend, so nothing is shown or editable.</p>';
      } else if (!section.fields.length && !section.renderExtra) {
        html += '<p class="mini-empty">The backend returned no fields for this section.</p>';
      } else {
        section.fields.forEach(function (f) {
          if (isSecretPath(f.path)) return; // never render secret-shaped fields
          var v = getPath(original, f.path);
          if (v === undefined) return;      // only render what the backend supports
          html += settingRowHtml(f, v);
        });
        html += '<div id="section-extra-' + key + '"></div>';
        if (!html.match(/setting-row/)) {
          html += '<p class="mini-empty">The backend did not return any of the expected fields for this section. Expose them in <code>GET /api/admin/settings</code> to manage them here.</p>';
        }
      }
      html += '</div>';
      panel.innerHTML = html;

      if (section.renderExtra) {
        var extras = { security: renderSecurityExtra, system: renderSystemHealth };
        var extraBox = panel.querySelector('#section-extra-' + key);
        if (extraBox && extras[section.renderExtra]) extras[section.renderExtra](extraBox);
      }

      // Wire inputs
      panel.querySelectorAll('[data-path]').forEach(function (input) {
        input.addEventListener('change', function () { saveBtn.disabled = false; });
      });
    }

    function settingRowHtml(f, value) {
      var control;
      if (f.type === 'toggle') {
        control = '<label class="switch-label"><span class="switch">' +
          '<input type="checkbox" data-path="' + UI.esc(f.path) + '" data-type="toggle"' + (isTruthy(value) ? ' checked' : '') + '/>' +
          '<span class="slider"></span></span><span>' + (isTruthy(value) ? 'On' : 'Off') + '</span></label>';
      } else if (f.type === 'select') {
        var opts = f.options ? f.options() : [];
        control = '<select class="form-input" data-path="' + UI.esc(f.path) + '">' +
          opts.map(function (o) {
            return '<option value="' + UI.esc(o.value) + '"' + (String(value) === o.value ? ' selected' : '') + '>' + UI.esc(o.label) + '</option>';
          }).join('') + '</select>';
      } else {
        control = '<input type="' + f.type + '" class="form-input" data-path="' + UI.esc(f.path) + '" data-type="' + f.type + '" value="' + UI.esc(value) + '"' +
          (f.readOnly ? ' readonly disabled title="Managed by the backend"' : '') +
          (f.placeholder ? ' placeholder="' + UI.esc(f.placeholder) + '"' : '') + '/>';
      }
      return '<div class="setting-row">' +
        '<div><div class="sr-label">' + UI.esc(f.label) + '</div>' +
        (f.readOnly ? '<div class="sr-sub">Read-only — provided by the backend</div>' : '') + '</div>' +
        '<div class="sr-control">' + control + '</div></div>';
    }

    function isTruthy(v) {
      return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'enabled' || String(v).toLowerCase() === 'on';
    }

    /* ---------------------------------------------------------------- */
    function save() {
      if (!original) return;
      var changes = {};
      document.querySelectorAll('#set-form [data-path]').forEach(function (input) {
        var path = input.getAttribute('data-path');
        var type = input.getAttribute('data-type');
        var current = getPath(original, path);
        var newVal;
        if (type === 'toggle') newVal = input.checked;
        else if (type === 'number') newVal = input.value === '' ? undefined : Number(input.value);
        else newVal = input.value.trim() === '' ? undefined : input.value.trim();

        if (newVal === undefined) return;
        if (String(newVal) === String(current) || (typeof newVal === 'boolean' && isTruthy(current) === newVal)) return;
        setPath(changes, path, newVal);
      });

      if (!Object.keys(changes).length) {
        UI.toast('info', 'No changes', 'Nothing to save — the form matches the backend settings.');
        return;
      }

      var btn = document.getElementById('set-save');
      btn.disabled = true;
      btn.querySelector('.btn-spinner') && btn.querySelector('.btn-spinner').classList.remove('hidden');

      API.put(EP.update, changes)
        .then(function () {
          UI.toast('success', 'Settings saved', 'The backend accepted the changes.');
          load();
        })
        .catch(function (err) {
          btn.disabled = false;
          UI.toast('error', 'Save failed', err.message);
        });
    }

    /* ---------------------------------------------------------------- */
    function renderSecurityExtra(box) {
      var admin = window.SMMAuth ? window.SMMAuth.getAdmin() : null;
      var token = window.SMMAuth ? window.SMMAuth.getToken() : null;
      var remembered = false;
      try { remembered = localStorage.getItem(CFG.STORAGE.REMEMBER) === '1'; } catch (e) { /* ignore */ }

      var html = '<div class="detail-section-title">Current session</div>' +
        '<dl class="detail-grid">' +
        '<dt>Signed in as</dt><dd>' + UI.esc((admin && (admin.name || admin.email)) || 'unknown') + '</dd>' +
        '<dt>Role</dt><dd>' + UI.esc((admin && admin.role) || 'Administrator') + '</dd>' +
        '<dt>Session storage</dt><dd>' + (remembered ? 'Persistent (Remember me) — expires per backend policy' : 'Session-only — cleared when this tab closes') + '</dd>' +
        '<dt>Token present</dt><dd>' + (token ? 'Yes (kept out of page content)' : 'No') + '</dd>' +
        '</dl>' +
        '<div class="setting-row" style="border:0">' +
        '<div><div class="sr-label">End this session</div><div class="sr-sub">Revokes the token server-side when the backend supports logout.</div></div>' +
        '<div class="sr-control"><button type="button" class="btn btn-outline-danger btn-sm" id="sec-logout"><i data-lucide="log-out" class="btn-icon"></i><span>Sign out</span></button></div></div>';

      var apiHtml = '<div class="detail-section-title">API connection</div>' +
        '<dl class="detail-grid">' +
        '<dt>Backend URL</dt><dd class="mono">' + UI.esc(API.isConfigured() ? API.baseURL() : 'not configured') + '</dd>' +
        '<dt>Connection status</dt><dd id="sec-api-status">checking…</dd>' +
        '</dl>';

      box.innerHTML = html + apiHtml;

      var logoutBtn = box.querySelector('#sec-logout');
      logoutBtn && logoutBtn.addEventListener('click', function () {
        window.SMMLogout('../');
      });

      // Simple connection check against the auth endpoint.
      API.request(CFG.ENDPOINTS.auth.me, { method: 'GET' })
        .then(function () {
          box.querySelector('#sec-api-status').innerHTML = '<span class="badge badge-success">connected — token valid</span>';
        })
        .catch(function (err) {
          box.querySelector('#sec-api-status').innerHTML =
            '<span class="badge ' + (err.kind === 'UNAUTHORIZED' ? 'badge-danger' : 'badge-warning') + '">' +
            UI.esc(err.kind === 'UNAUTHORIZED' ? 'session expired' : 'unreachable') + '</span>';
        });
    }

    function renderSystemHealth(box) {
      if (!healthData) { box.innerHTML = '<p class="mini-empty">Health data not loaded.</p>'; return; }
      if (healthData.__error) {
        box.innerHTML =
          '<div class="alert alert-warning" style="margin:0"><i data-lucide="cloud-off"></i><div>' +
          '<strong>Health endpoint unavailable.</strong><p>' + UI.esc(healthData.__error.message || '') + '</p>' +
          '<p style="margin-top:4px">Expose <code>GET /api/admin/health</code> for backend, provider and queue health monitoring.</p></div></div>';
        if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
        return;
      }

      var h = healthData || {};
      var cards = [
        { name: 'Email backend', status: h.status || h.backend || h.backend_status, sub: h.version ? 'version ' + h.version : '' },
        { name: 'Email provider', status: h.provider ? (h.provider.status || (h.provider.connected ? 'ok' : 'down')) : h.provider_status, sub: h.provider && h.provider.name ? h.provider.name : '' },
        { name: 'Email queue', status: h.queue ? (h.queue.status || (h.queue.healthy ? 'ok' : 'degraded')) : h.queue_status, sub: h.queue && h.queue.pending !== undefined ? h.queue.pending + ' pending jobs' : '' }
      ];

      var html = '<div class="health-grid">' + cards.map(function (c) {
        var cls, label;
        var s = String(c.status || 'unknown').toLowerCase();
        if (s === 'ok' || s === 'healthy' || s === 'up' || s === 'connected' || s === true) { cls = 'health-ok'; label = 'Healthy'; }
        else if (s === 'down' || s === 'error' || s === 'unhealthy' || s === 'failed' || s === false) { cls = 'health-bad'; label = 'Unhealthy'; }
        else { cls = 'health-unknown'; label = c.status ? String(c.status) : 'Unknown'; }
        return '<div class="health-card ' + cls + '"><span class="health-dot"></span>' +
          '<div><div class="health-title">' + UI.esc(c.name) + '</div>' +
          '<div class="health-sub">' + UI.esc(label + (c.sub ? ' · ' + c.sub : '')) + '</div></div></div>';
      }).join('') + '</div>';

      if (h.last_successful_connection || h.last_connection) {
        html += '<p class="form-hint" style="margin-top:12px">Last successful connection: ' +
          UI.esc(UI.fmt.dateTime(h.last_successful_connection || h.last_connection)) + '</p>';
      }
      if (h.timestamp) {
        html += '<p class="form-hint">Health snapshot: ' + UI.esc(UI.fmt.dateTime(h.timestamp)) + '</p>';
      }

      html += '<div class="setting-row" style="border:0">' +
        '<div><div class="sr-label">Run a fresh health check</div><div class="sr-sub">Calls GET /api/admin/health now.</div></div>' +
        '<div class="sr-control"><button type="button" class="btn btn-secondary btn-sm" id="health-recheck"><i data-lucide="stethoscope" class="btn-icon"></i><span>Check now</span></button></div></div>';

      box.innerHTML = html;

      var re = box.querySelector('#health-recheck');
      re && re.addEventListener('click', function () {
        re.disabled = true;
        API.get(EP.health)
          .then(function (h2) { healthData = h2; renderSystemHealth(box); UI.toast('success', 'Health checked', ''); })
          .catch(function (err) { UI.toast('error', 'Health check failed', err.message); })
          .finally(function () { re.disabled = false; });
      });
    }
  });
})();
