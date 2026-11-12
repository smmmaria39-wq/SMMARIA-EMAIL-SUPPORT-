/* ============================================================================
 * SMMARIA Email Manager — dashboard.js
 * ----------------------------------------------------------------------------
 * Backend endpoints used (see config.js → ENDPOINTS):
 *   GET /api/admin/dashboard/stats        → KPI cards
 *   GET /api/admin/dashboard/activity     → 14-day email activity chart
 *   GET /api/admin/emails?limit=…         → recent activity + failures
 *   GET /api/admin/campaigns?limit=…      → recent campaigns + performance chart
 *   GET /api/admin/queue/stats            → queue status panel
 * Nothing on this page is mocked: any missing backend metric renders as "—".
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG, UI = window.SMMUI, API = window.SMMApi;
  var activityChart = null, campaignChart = null;

  document.addEventListener('DOMContentLoaded', function () {

    var kpis = document.getElementById('dash-kpis');
    var refreshBtn = document.getElementById('dash-refresh');

    var api = document.getElementById('footer-api');
    if (api) api.textContent = API.isConfigured() ? API.baseURL() : 'not configured';

    refreshBtn && refreshBtn.addEventListener('click', function () {
      loadAll(true);
    });

    loadAll(false);

    /* ---------------------------------------------------------------- */
    /* Main loader                                                       */
    /* ---------------------------------------------------------------- */
    function loadAll(isRefresh) {
      UI.renderState(kpis, { type: 'loading' });
      renderTableLoading();

      // Independent requests in parallel; each section fails independently.
      Promise.allSettled([
        API.get(CFG.ENDPOINTS.dashboard.stats),
        API.get(CFG.ENDPOINTS.dashboard.activity, { days: 14 }),
        API.get(CFG.ENDPOINTS.emails.list, { limit: 6, page: 1 }),
        API.get(CFG.ENDPOINTS.campaigns.list, { limit: 6, page: 1 }),
        API.get(CFG.ENDPOINTS.queue.stats),
        API.get(CFG.ENDPOINTS.emails.list, { limit: 6, page: 1, status: 'failed' })
      ]).then(function (results) {
        renderKpis(results[0]);
        renderActivityChart(results[1]);
        renderRecentEmails(results[2]);
        renderRecentCampaigns(results[3]);
        renderCampaignChart(results[3]);
        renderQueue(results[4]);
        renderFailures(results[5]);
        if (isRefresh) UI.toast('success', 'Dashboard refreshed', 'Latest data loaded from the backend.');
      });
    }

    /* ---------------------------------------------------------------- */
    /* KPI cards                                                         */
    /* ---------------------------------------------------------------- */
    function renderKpis(result) {
      if (result.status === 'rejected') {
        UI.renderState(kpis, {
          type: 'error',
          title: 'Could not load statistics',
          error: result.reason,
          retry: function () { loadAll(false); }
        });
        return;
      }
      var s = result.value || {};
      var g = function (keys) {
        for (var i = 0; i < keys.length; i++) {
          var v = s[keys[i]];
          if (v !== undefined && v !== null) return v;
        }
        return null;
      };

      var cards = [
        { label: 'Emails sent',        value: UI.fmt.number(g(['total_emails_sent', 'totalSent', 'emails_sent'])),          icon: 'send',             tone: 'kpi-indigo' },
        { label: 'Successful sends',   value: UI.fmt.number(g(['successful_emails', 'sent_successful', 'delivered'])),       icon: 'check-circle',     tone: 'kpi-green' },
        { label: 'Failed emails',      value: UI.fmt.number(g(['failed_emails', 'totalFailed', 'emails_failed'])),           icon: 'x-circle',         tone: 'kpi-red' },
        { label: 'Pending / queued',   value: UI.fmt.number(g(['pending_emails', 'queued_emails'])),                          icon: 'clock',            tone: 'kpi-amber' },
        { label: 'Total subscribers',  value: UI.fmt.number(g(['total_subscribers', 'subscribers_total'])),                   icon: 'users',            tone: 'kpi-blue' },
        { label: 'Active subscribers', value: UI.fmt.number(g(['active_subscribers', 'subscribers_active'])),                 icon: 'user-check',       tone: 'kpi-purple' },
        { label: 'Unsubscribed',       value: UI.fmt.number(g(['unsubscribed_subscribers', 'unsubscribed'])),                 icon: 'user-minus',       tone: 'kpi-neutral' },
        { label: 'Campaigns',          value: UI.fmt.number(g(['total_campaigns', 'campaigns_total'])),                       icon: 'megaphone',        tone: 'kpi-pink' },
        { label: 'Scheduled campaigns',value: UI.fmt.number(g(['scheduled_campaigns'])),                                      icon: 'calendar-clock',   tone: 'kpi-indigo' },
        { label: 'Sent today',         value: UI.fmt.number(g(['emails_sent_today', 'sent_today'])),                          icon: 'calendar-check',   tone: 'kpi-green' },
        { label: 'Delivery rate',      value: rateOrDash(g(['delivery_rate', 'success_rate']), s),                           icon: 'trending-up',      tone: 'kpi-green',
          sub: metricBasis(g(['delivery_rate', 'success_rate'])) },
        { label: 'Bounce rate',        value: rateOrDash(g(['bounce_rate']), s),                                              icon: 'corner-down-right',tone: 'kpi-red',
          sub: metricBasis(g(['bounce_rate'])) },
        { label: 'Open rate',          value: rateOrDash(g(['open_rate']), s),                                                icon: 'mail-open',        tone: 'kpi-blue',
          sub: metricBasis(g(['open_rate'])) },
        { label: 'Click rate',         value: rateOrDash(g(['click_rate']), s),                                               icon: 'mouse-pointer-click', tone: 'kpi-amber',
          sub: metricBasis(g(['click_rate'])) }
      ];

      kpis.setAttribute('aria-busy', 'false');
      kpis.innerHTML = cards.map(function (c) {
        return '<div class="kpi-card">' +
          '<span class="kpi-icon ' + c.tone + '"><i data-lucide="' + c.icon + '"></i></span>' +
          '<div class="kpi-body"><div class="kpi-label">' + UI.esc(c.label) + '</div>' +
          '<div class="kpi-value">' + UI.esc(c.value) + '</div>' +
          (c.sub ? '<div class="kpi-sub">' + UI.esc(c.sub) + '</div>' : '') +
          '</div></div>';
      }).join('');
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
    }

    /** Only show a % when the backend actually computed it. */
    function rateOrDash(v, statsObj) {
      if (v === null || v === undefined || v === '') return '—';
      if (statsObj && (statsObj.tracking_available === false || statsObj.track_opens === false)) {
        // Backend explicitly says tracking is off for this metric set.
      }
      return UI.fmt.percent(v);
    }
    function metricBasis(v) {
      return (v === null || v === undefined || v === '') ? 'not reported by backend' : 'reported by backend';
    }

    /* ---------------------------------------------------------------- */
    /* Charts                                                            */
    /* ---------------------------------------------------------------- */
    function chartLibAvailable() {
      return typeof window.Chart !== 'undefined';
    }

    function renderActivityChart(result) {
      var box = document.getElementById('dash-activity-chart-box');
      var srcBadge = document.getElementById('dash-activity-source');
      if (result.status === 'rejected') {
        chartFallback(box, 'Activity chart unavailable — ' + shortErr(result.reason));
        if (srcBadge) srcBadge.textContent = 'unavailable';
        return;
      }
      var payload = result.value || {};
      var series = payload.series || payload.days || payload.data || payload;
      if (!Array.isArray(series)) series = [];
      if (srcBadge) srcBadge.textContent = series.length ? 'backend time series' : 'no data returned';

      if (!series.length) {
        chartFallback(box, 'The backend returned no activity data for the last 14 days.');
        return;
      }
      if (!chartLibAvailable()) {
        chartFallback(box, 'Chart.js failed to load from the CDN. Check your connection.');
        return;
      }

      var labels = series.map(function (d) {
        var dt = UI.toDate(d.date || d.day || d.label);
        return dt ? new Intl.DateTimeFormat(CFG.LOCALE, { month: 'short', day: 'numeric' }).format(dt) : String(d.date || d.day || d.label || '');
      });
      var sent = series.map(function (d) { return num(d.sent || d.sent_count || d.total || 0); });
      var failed = series.map(function (d) { return num(d.failed || d.failed_count || 0); });

      if (activityChart) activityChart.destroy();
      activityChart = new Chart(document.getElementById('dash-activity-chart'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: 'Sent', data: sent, borderColor: '#4F46E5', backgroundColor: 'rgba(79,70,229,.12)', fill: true, tension: .35, borderWidth: 2, pointRadius: 2 },
            { label: 'Failed', data: failed, borderColor: '#DC2626', backgroundColor: 'rgba(220,38,38,.08)', fill: true, tension: .35, borderWidth: 2, pointRadius: 2 }
          ]
        },
        options: chartOpts()
      });
    }

    function renderCampaignChart(result) {
      var box = document.getElementById('dash-campaign-chart-box');
      if (result.status === 'rejected') {
        chartFallback(box, 'Campaign chart unavailable — ' + shortErr(result.reason));
        return;
      }
      var data = UI.extractList(result.value).slice(0, 8);
      if (!data.length) {
        chartFallback(box, 'No campaigns yet — create one to see performance here.');
        return;
      }
      if (!chartLibAvailable()) {
        chartFallback(box, 'Chart.js failed to load from the CDN. Check your connection.');
        return;
      }

      var labels = data.map(function (c) { return String(c.name || c.title || 'Campaign').slice(0, 22); });
      var sent = data.map(function (c) { return num(c.sent_count || c.sent || (c.stats && c.stats.sent) || 0); });
      var failed = data.map(function (c) { return num(c.failed_count || c.failed || (c.stats && c.stats.failed) || 0); });

      if (campaignChart) campaignChart.destroy();
      campaignChart = new Chart(document.getElementById('dash-campaign-chart'), {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Sent', data: sent, backgroundColor: '#4F46E5', borderRadius: 6, maxBarThickness: 26 },
            { label: 'Failed', data: failed, backgroundColor: '#FCA5A5', borderRadius: 6, maxBarThickness: 26 }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { family: 'Inter' } } } },
          scales: {
            x: { stacked: true, grid: { color: '#EEF1F6' }, ticks: { precision: 0 } },
            y: { stacked: true, grid: { display: false }, ticks: { font: { family: 'Inter', size: 11 } } }
          }
        }
      });
    }

    function chartOpts() {
      return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { family: 'Inter' } } },
          tooltip: { backgroundColor: '#0B1220', padding: 10, cornerRadius: 8 }
        },
        scales: {
          x: { grid: { color: '#EEF1F6' } },
          y: { beginAtZero: true, grid: { color: '#EEF1F6' }, ticks: { precision: 0 } }
        }
      };
    }

    function chartFallback(box, msg) {
      if (box) box.innerHTML = '<div class="chart-fallback"><i data-lucide="bar-chart-2" style="width:22px;height:22px;margin-bottom:6px"></i><span>' + UI.esc(msg) + '</span></div>';
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
    }

    function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
    function shortErr(err) { return (err && err.message ? err.message : 'unknown error').slice(0, 90); }

    /* ---------------------------------------------------------------- */
    /* Tables                                                            */
    /* ---------------------------------------------------------------- */
    function renderTableLoading() {
      UI.skeletonRows(document.querySelector('#dash-recent-emails tbody'), 4, 5);
      UI.skeletonRows(document.querySelector('#dash-recent-campaigns tbody'), 4, 4);
      UI.skeletonRows(document.querySelector('#dash-failures tbody'), 5, 4);
    }

    function renderRecentEmails(result) {
      var tbody = document.querySelector('#dash-recent-emails tbody');
      var state = document.getElementById('dash-recent-emails-state');
      if (result.status === 'rejected') {
        tbody.innerHTML = '';
        UI.renderState(state, { type: 'error', title: 'Could not load recent emails', error: result.reason, retry: function () { loadAll(false); } });
        return;
      }
      var items = UI.extractList(result.value).slice(0, 6);
      UI.renderState(state, { type: 'clear' });
      if (!items.length) {
        tbody.innerHTML = '';
        UI.renderState(state, { type: 'empty', title: 'No emails yet', text: 'Emails processed by the backend will appear here.', action: '<a class="btn btn-primary btn-sm" href="pages/compose.html">Compose the first email</a>' });
        return;
      }
      tbody.innerHTML = items.map(function (e) {
        return '<tr>' +
          '<td><div class="cell-main">' + UI.esc(e.recipient || e.to || e.email || '—') + '</div></td>' +
          '<td><div class="truncate" style="max-width:220px">' + UI.esc(e.subject || '(no subject)') + '</div></td>' +
          '<td>' + UI.statusBadge(e.status) + '</td>' +
          '<td class="cell-muted nowrap">' + UI.esc(UI.fmt.timeAgo(e.created_at || e.sent_at || e.date)) + '</td>' +
        '</tr>';
      }).join('');
    }

    function renderRecentCampaigns(result) {
      var tbody = document.querySelector('#dash-recent-campaigns tbody');
      var state = document.getElementById('dash-recent-campaigns-state');
      if (result.status === 'rejected') {
        tbody.innerHTML = '';
        UI.renderState(state, { type: 'error', title: 'Could not load campaigns', error: result.reason, retry: function () { loadAll(false); } });
        return;
      }
      var items = UI.extractList(result.value).slice(0, 6);
      UI.renderState(state, { type: 'clear' });
      if (!items.length) {
        tbody.innerHTML = '';
        UI.renderState(state, { type: 'empty', title: 'No campaigns yet', text: 'Create a campaign to reach your subscribers.', action: '<a class="btn btn-primary btn-sm" href="pages/campaigns.html?action=create">New campaign</a>' });
        return;
      }
      tbody.innerHTML = items.map(function (c) {
        return '<tr>' +
          '<td><div class="cell-main truncate" style="max-width:190px">' + UI.esc(c.name || c.title || 'Untitled') + '</div>' +
          '<div class="cell-sub truncate" style="max-width:190px">' + UI.esc(c.subject || '') + '</div></td>' +
          '<td>' + UI.statusBadge(c.status) + '</td>' +
          '<td class="cell-num">' + UI.fmt.number(c.recipients_count || c.total_recipients || (c.stats && c.stats.recipients)) + '</td>' +
          '<td class="cell-num">' + UI.fmt.number(c.sent_count || (c.stats && c.stats.sent)) + '</td>' +
        '</tr>';
      }).join('');
    }

    function renderFailures(result) {
      var tbody = document.querySelector('#dash-failures tbody');
      var state = document.getElementById('dash-failures-state');
      if (result.status === 'rejected') {
        tbody.innerHTML = '';
        UI.renderState(state, { type: 'error', title: 'Could not load failures', error: result.reason, retry: function () { loadAll(false); } });
        return;
      }
      var items = UI.extractList(result.value).slice(0, 6);
      UI.renderState(state, { type: 'clear' });
      if (!items.length) {
        tbody.innerHTML = '';
        UI.renderState(state, { type: 'empty', icon: 'shield-check', title: 'No recent failures', text: 'Nothing has bounced or errored recently. This panel lists failed emails from the backend.' });
        return;
      }
      tbody.innerHTML = items.map(function (e) {
        return '<tr>' +
          '<td><div class="cell-main">' + UI.esc(e.recipient || e.to || e.email || '—') + '</div></td>' +
          '<td><div class="truncate" style="max-width:180px">' + UI.esc(e.subject || '(no subject)') + '</div></td>' +
          '<td><div class="truncate" style="max-width:240px;color:var(--c-danger)">' + UI.esc(e.error_message || e.error || e.provider_response || '—') + '</div></td>' +
          '<td class="cell-muted nowrap">' + UI.esc(UI.fmt.timeAgo(e.created_at || e.sent_at)) + '</td>' +
          '<td class="td-actions"><a class="link-btn" href="pages/email-history.html?status=failed">Details</a></td>' +
        '</tr>';
      }).join('');
    }

    /* ---------------------------------------------------------------- */
    /* Queue panel                                                       */
    /* ---------------------------------------------------------------- */
    function renderQueue(result) {
      var box = document.getElementById('dash-queue-status');
      if (result.status === 'rejected') {
        UI.renderState(box, { type: 'error', title: 'Could not load queue status', error: result.reason, retry: function () { loadAll(false); } });
        return;
      }
      var s = result.value || {};
      var rows = [
        ['Pending',    pick(s, ['pending', 'pending_jobs', 'waiting']), 'kpi-amber', 'clock'],
        ['Processing', pick(s, ['processing', 'active', 'in_progress']), 'kpi-blue', 'loader-2'],
        ['Completed',  pick(s, ['completed', 'done']), 'kpi-green', 'check-circle'],
        ['Failed',     pick(s, ['failed', 'errors']), 'kpi-red', 'x-circle']
      ];
      box.setAttribute('aria-busy', 'false');
      box.innerHTML = '<div class="health-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + rows.map(function (r) {
        return '<div class="health-card ' + (r[1] ? '' : 'health-unknown') + '">' +
          '<span class="kpi-icon ' + r[2] + '" style="width:34px;height:34px"><i data-lucide="' + r[3] + '"></i></span>' +
          '<div><div class="health-title">' + UI.esc(r[0]) + '</div>' +
          '<div class="health-sub">' + (r[1] === null ? 'not reported' : UI.fmt.number(r[1]) + ' jobs') + '</div></div>' +
        '</div>';
      }).join('') + '</div>';
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
    }

    function pick(obj, keys) {
      for (var i = 0; i < keys.length; i++) {
        var v = obj[keys[i]];
        if (v !== undefined && v !== null) return Number(v);
      }
      return null;
    }
  });
})();
