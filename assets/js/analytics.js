/* ============================================================================
 * SMMARIA Email Manager — analytics.js
 * ----------------------------------------------------------------------------
 * Backend endpoints used:
 *   GET /api/admin/analytics            ?from&to        → rates + totals
 *   GET /api/admin/analytics/timeseries ?from&to&period → volume + growth series
 *   GET /api/admin/analytics/campaigns  ?from&to        → campaign performance
 *
 * Honesty rule: if the backend does not report open/click/bounce tracking,
 * those KPIs render as "— not supported" with an explanatory notice —
 * never a fabricated percentage.
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG, UI = window.SMMUI, API = window.SMMApi;
  var EP = CFG.ENDPOINTS.analytics;

  var rangeDays = 7;
  var volumeChart = null, growthChart = null;
  var lastVolumeSeries = [];

  document.addEventListener('DOMContentLoaded', function () {
    var kpis = document.getElementById('anl-kpis');
    var fromEl = document.getElementById('anl-from');
    var toEl = document.getElementById('anl-to');

    document.querySelectorAll('.range-picker .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        document.querySelectorAll('.range-picker .chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        rangeDays = Number(chip.getAttribute('data-range')) || 7;
        fromEl.value = ''; toEl.value = '';
        loadAll();
      });
    });

    document.getElementById('anl-refresh').addEventListener('click', loadAll);
    document.getElementById('anl-export').addEventListener('click', exportCsv);

    loadAll();

    function currentRange() {
      var to = toEl.value ? new Date(toEl.value + 'T23:59:59') : new Date();
      var from = fromEl.value ? new Date(fromEl.value + 'T00:00:00') : new Date(to.getTime() - (rangeDays - 1) * 86400000);
      if (from > to) { var tmp = from; from = to; to = tmp; }
      return { from: from, to: to };
    }

    function isoDate(d) { return d.toISOString().slice(0, 10); }

    function loadAll() {
      var r = currentRange();
      var q = { from: isoDate(r.from), to: isoDate(r.to) };
      document.getElementById('anl-campaign-sub').textContent = 'Campaigns from ' + UI.fmt.date(q.from) + ' to ' + UI.fmt.date(q.to);

      UI.renderState(kpis, { type: 'loading' });

      Promise.allSettled([
        API.get(EP.overview, q),
        API.get(EP.timeseries, Object.assign({ period: 'day' }, q)),
        API.get(EP.campaigns, q)
      ]).then(function (res) {
        renderKpis(res[0]);
        renderVolume(res[1]);
        renderGrowth(res[1]);
        renderCampaignTable(res[2]);
        renderTrackingNote(res[0]);
      });
    }

    /* ---------------------------------------------------------------- */
    function renderKpis(result) {
      if (result.status === 'rejected') {
        UI.renderState(kpis, { type: 'error', title: 'Could not load analytics', error: result.reason, retry: loadAll });
        return;
      }
      var s = result.value || {};
      function g(keys) {
        for (var i = 0; i < keys.length; i++) { var v = s[keys[i]]; if (v !== undefined && v !== null) return v; }
        return null;
      }
      var cards = [
        { label: 'Total emails sent', value: UI.fmt.number(g(['total_sent', 'emails_sent', 'sent'])), icon: 'send', tone: 'kpi-indigo' },
        { label: 'Delivery rate', value: pct(g(['delivery_rate', 'success_rate'])), icon: 'check-circle', tone: 'kpi-green' },
        { label: 'Failure rate', value: pct(g(['failure_rate', 'fail_rate'])), icon: 'x-circle', tone: 'kpi-red' },
        { label: 'Bounce rate', value: pct(g(['bounce_rate'])), icon: 'corner-down-right', tone: 'kpi-amber', unsupportedNote: true },
        { label: 'Open rate', value: pct(g(['open_rate'])), icon: 'mail-open', tone: 'kpi-blue', unsupportedNote: true },
        { label: 'Click rate', value: pct(g(['click_rate'])), icon: 'mouse-pointer-click', tone: 'kpi-purple', unsupportedNote: true },
        { label: 'Campaigns sent', value: UI.fmt.number(g(['campaigns_sent', 'total_campaigns'])), icon: 'megaphone', tone: 'kpi-pink' },
        { label: 'New subscribers', value: UI.fmt.number(g(['new_subscribers', 'subscribers_gained'])), icon: 'user-plus', tone: 'kpi-green' }
      ];
      kpis.setAttribute('aria-busy', 'false');
      kpis.innerHTML = cards.map(function (c) {
        var sub = c.value === '—'
          ? (c.unsupportedNote ? 'not supported by backend data' : 'not reported')
          : 'reported by backend';
        return '<div class="kpi-card">' +
          '<span class="kpi-icon ' + c.tone + '"><i data-lucide="' + c.icon + '"></i></span>' +
          '<div class="kpi-body"><div class="kpi-label">' + UI.esc(c.label) + '</div>' +
          '<div class="kpi-value">' + UI.esc(c.value) + '</div>' +
          '<div class="kpi-sub">' + UI.esc(sub) + '</div></div></div>';
      }).join('');
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
    }

    function pct(v) {
      if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—';
      return UI.fmt.percent(v);
    }

    /* ---------------------------------------------------------------- */
    function seriesOf(result) {
      if (result.status === 'rejected') return null;
      var payload = result.value || {};
      var s = payload.series || payload.days || payload.data || payload;
      return Array.isArray(s) ? s : [];
    }

    function renderVolume(result) {
      var stateEl = document.getElementById('anl-volume-state');
      var box = document.querySelector('#anl-volume-chart').parentNode;
      var series = seriesOf(result);

      if (result.status === 'rejected') {
        UI.renderState(stateEl, { type: 'error', title: 'Volume chart unavailable', error: result.reason, retry: loadAll });
        return;
      }
      UI.renderState(stateEl, { type: 'clear' });
      lastVolumeSeries = series;
      if (!series.length) {
        if (volumeChart) { volumeChart.destroy(); volumeChart = null; }
        box.innerHTML = '<div class="chart-fallback">The backend returned no time-series data for this range.</div>';
        return;
      }
      if (typeof Chart === 'undefined') {
        box.innerHTML = '<div class="chart-fallback">Chart.js failed to load from the CDN.</div>';
        return;
      }

      var labels = series.map(function (d) { return labelOf(d); });
      var sent = series.map(function (d) { return num(d.sent || d.sent_count || d.total || 0); });
      var failed = series.map(function (d) { return num(d.failed || d.failed_count || 0); });

      if (volumeChart) volumeChart.destroy();
      volumeChart = new Chart(document.getElementById('anl-volume-chart'), {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Sent', data: sent, backgroundColor: '#4F46E5', borderRadius: 5, maxBarThickness: 26 },
            { label: 'Failed', data: failed, backgroundColor: '#FCA5A5', borderRadius: 5, maxBarThickness: 26 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { family: 'Inter' } } } },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } }, y: { beginAtZero: true, grid: { color: '#EEF1F6' }, ticks: { precision: 0 } } }
        }
      });
    }

    function renderGrowth(result) {
      var stateEl = document.getElementById('anl-growth-state');
      var box = document.querySelector('#anl-growth-chart').parentNode;
      var series = seriesOf(result);

      if (result.status === 'rejected') {
        UI.renderState(stateEl, { type: 'error', title: 'Growth chart unavailable', error: result.reason, retry: loadAll });
        return;
      }
      UI.renderState(stateEl, { type: 'clear' });

      var hasGrowth = series.some(function (d) {
        return d.new_subscribers !== undefined || d.subscribers !== undefined || d.new_subscriber_count !== undefined;
      });
      if (!series.length || !hasGrowth) {
        if (growthChart) { growthChart.destroy(); growthChart = null; }
        box.innerHTML = '<div class="chart-fallback">Subscriber growth data is not available for this range.<br/><span style="font-size:12px">The backend time series did not include subscriber counts.</span></div>';
        return;
      }
      if (typeof Chart === 'undefined') {
        box.innerHTML = '<div class="chart-fallback">Chart.js failed to load from the CDN.</div>';
        return;
      }

      var labels = series.map(function (d) { return labelOf(d); });
      var data = series.map(function (d) { return num(d.new_subscribers || d.new_subscriber_count || d.subscribers || 0); });

      if (growthChart) growthChart.destroy();
      growthChart = new Chart(document.getElementById('anl-growth-chart'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'New subscribers', data: data,
            borderColor: '#059669', backgroundColor: 'rgba(5,150,105,.12)',
            fill: true, tension: .35, borderWidth: 2, pointRadius: 2
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } }, y: { beginAtZero: true, grid: { color: '#EEF1F6' }, ticks: { precision: 0 } } }
        }
      });
    }

    function labelOf(d) {
      var dt = UI.toDate(d.date || d.day || d.label);
      return dt ? new Intl.DateTimeFormat(CFG.LOCALE, { month: 'short', day: 'numeric' }).format(dt) : String(d.date || d.day || d.label || '');
    }
    function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

    /* ---------------------------------------------------------------- */
    function renderCampaignTable(result) {
      var tbody = document.querySelector('#anl-campaign-table tbody');
      var stateEl = document.getElementById('anl-campaign-state');
      if (result.status === 'rejected') {
        tbody.innerHTML = '';
        UI.renderState(stateEl, { type: 'error', title: 'Could not load campaign performance', error: result.reason, retry: loadAll });
        return;
      }
      var items = UI.extractList(result.value);
      if (!items.length) {
        tbody.innerHTML = '';
        UI.renderState(stateEl, { type: 'empty', icon: 'megaphone', title: 'No campaign activity in this range', text: 'Send a campaign in the selected period to see its performance here.' });
        return;
      }
      UI.renderState(stateEl, { type: 'clear' });
      tbody.innerHTML = items.map(function (c) {
        var sent = num(c.sent_count || (c.stats && c.stats.sent));
        var rec = num(c.recipients_count || c.total_recipients || (c.stats && c.stats.recipients));
        var rate = rec ? (sent / rec) * 100 : null;
        return '<tr>' +
          '<td><div class="cell-main truncate" style="max-width:220px">' + UI.esc(c.name || 'Untitled') + '</div></td>' +
          '<td>' + UI.statusBadge(c.status) + '</td>' +
          '<td class="cell-num">' + UI.fmt.number(rec) + '</td>' +
          '<td class="cell-num">' + UI.fmt.number(sent) + '</td>' +
          '<td class="cell-num">' + UI.fmt.number(num(c.failed_count || (c.stats && c.stats.failed))) + '</td>' +
          '<td>' + (rate === null ? '—' : UI.fmt.percent(rate)) + '</td>' +
        '</tr>';
      }).join('');
    }

    /* ---------------------------------------------------------------- */
    function renderTrackingNote(result) {
      var note = document.getElementById('anl-tracking-note');
      if (result.status === 'rejected') { note.innerHTML = ''; return; }
      var s = result.value || {};
      var missing = [];
      ['open_rate', 'click_rate', 'bounce_rate'].forEach(function (k) {
        if (s[k] === undefined || s[k] === null) missing.push(k.replace('_rate', ' tracking'));
      });
      if (!missing.length) { note.innerHTML = ''; return; }
      note.innerHTML =
        '<div class="card-head" style="margin-bottom:6px"><div>' +
        '<h2 class="card-title">About the missing metrics</h2>' +
        '<p class="card-sub">Why some rates show "—"</p></div></div>' +
        '<p class="se-text" style="max-width:none">The email backend did not return ' +
        UI.esc(missing.join(', ')) +
        ' for this period. SMMARIA shows real backend data only — nothing is estimated. If your email provider supports open/click tracking, expose the corresponding fields in <code>GET /api/admin/analytics</code> and they will appear here automatically.</p>';
    }

    /* ---------------------------------------------------------------- */
    function exportCsv() {
      if (!lastVolumeSeries.length) {
        UI.toast('warning', 'Nothing to export', 'Load a period with data first.');
        return;
      }
      var rows = [['date', 'sent', 'failed']];
      lastVolumeSeries.forEach(function (d) {
        rows.push([d.date || d.day || d.label || '', d.sent || d.sent_count || d.total || 0, d.failed || d.failed_count || 0]);
      });
      var csv = rows.map(function (r) { return r.join(','); }).join('\n');
      var blob = new Blob([csv], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'smmaria-email-analytics-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
      UI.toast('success', 'Export ready', 'CSV downloaded (' + (rows.length - 1) + ' rows from backend data).');
    }
  });
})();
