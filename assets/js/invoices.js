/* ============================================================================
 * SMMARIA Email Manager — invoices.js
 * ----------------------------------------------------------------------------
 * Backend endpoints used:
 *   GET    /api/admin/invoices           list (+search/status/date/pagination)
 *   GET    /api/admin/invoices/:id       detail (+ invoice email history)
 *   POST   /api/admin/invoices/:id/send    first send
 *   POST   /api/admin/invoices/:id/resend  resend
 *   GET    /api/admin/invoices/:id/pdf     PDF download (optional)
 *
 * Invoice data comes exclusively from the backend — nothing is generated
 * client-side. Records the backend does not return are simply not shown.
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG, UI = window.SMMUI, API = window.SMMApi;
  var EP = CFG.ENDPOINTS.invoices;

  var state = { page: 1, limit: CFG.DEFAULT_PAGE_SIZE, search: '', status: '', email: '', from: '', to: '' };

  document.addEventListener('DOMContentLoaded', function () {
    var tbody = document.querySelector('#inv-table tbody');
    var stateBox = document.getElementById('inv-state');
    var searchEl = document.getElementById('inv-search');
    var statusEl = document.getElementById('inv-status');
    var emailEl = document.getElementById('inv-email');
    var fromEl = document.getElementById('inv-from');
    var toEl = document.getElementById('inv-to');

    document.getElementById('inv-refresh').addEventListener('click', function () { load(); UI.toast('info', 'Refreshed', 'Invoice list reloaded.'); });
    searchEl.addEventListener('input', UI.debounce(function () { state.search = searchEl.value.trim(); state.page = 1; load(); }, 350));
    statusEl.addEventListener('change', function () { state.status = statusEl.value; state.page = 1; load(); });
    emailEl.addEventListener('change', function () { state.email = emailEl.value; state.page = 1; load(); });
    fromEl.addEventListener('change', function () { state.from = fromEl.value; state.page = 1; load(); });
    toEl.addEventListener('change', function () { state.to = toEl.value; state.page = 1; load(); });
    document.getElementById('inv-clear').addEventListener('click', function () {
      state = { page: 1, limit: state.limit, search: '', status: '', email: '', from: '', to: '' };
      searchEl.value = ''; statusEl.value = ''; emailEl.value = ''; fromEl.value = ''; toEl.value = '';
      load();
    });

    load();

    function load() {
      UI.skeletonRows(tbody, 7, 6);
      UI.renderState(stateBox, { type: 'clear' });

      API.get(EP.list, {
        page: state.page, limit: state.limit,
        search: state.search || undefined,
        status: state.status || undefined,
        email_status: state.email || undefined,
        from: state.from || undefined,
        to: state.to || undefined
      }).then(function (payload) {
        var items = UI.extractList(payload);
        var total = UI.extractTotal(payload, items.length);
        var totalPages = UI.extractTotalPages(payload, total, state.limit);
        if (!items.length) {
          tbody.innerHTML = '';
          UI.renderState(stateBox, {
            type: 'empty', icon: 'receipt', title: 'No invoices found',
            text: state.search || state.status ? 'No invoices match the current filters.' : 'Invoice records created by the main SMMARIA system will appear here.'
          });
          document.getElementById('inv-info').textContent = '';
          UI.pagination(document.getElementById('inv-pagination'), { page: 1, totalPages: 1, total: 0 });
          return;
        }
        tbody.innerHTML = items.map(rowHtml).join('');
        wireRows(items);
        document.getElementById('inv-info').textContent =
          'Showing ' + ((state.page - 1) * state.limit + 1) + '–' + Math.min(state.page * state.limit, total) + ' of ' + UI.fmt.number(total);
        UI.pagination(document.getElementById('inv-pagination'), {
          page: state.page, totalPages: totalPages, total: total,
          onPage: function (p) { state.page = p; load(); }
        });
        if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
      }).catch(function (err) {
        tbody.innerHTML = '';
        UI.renderState(stateBox, { type: 'error', title: 'Could not load invoices', error: err, retry: load });
      });
    }

    function emailStateBadge(inv) {
      if (inv.email_sent_at || inv.email_status === 'sent') return '<span class="badge badge-success">sent</span>';
      if (inv.email_status === 'failed' || inv.email_error) return '<span class="badge badge-danger">failed</span>';
      return '<span class="badge badge-neutral">not sent</span>';
    }

    function rowHtml(inv) {
      var id = inv.id !== undefined ? inv.id : inv._id;
      var number = inv.invoice_number || inv.number || inv.invoice_no || ('#' + id);
      return '<tr data-id="' + UI.esc(id) + '">' +
        '<td><div class="cell-main mono">' + UI.esc(number) + '</div></td>' +
        '<td><div class="cell-main">' + UI.esc(inv.customer_email || inv.email || '—') + '</div>' +
          (inv.customer_name ? '<div class="cell-sub">' + UI.esc(inv.customer_name) + '</div>' : '') + '</td>' +
        '<td class="cell-num">' + UI.esc(UI.fmt.currency(inv.amount !== undefined ? inv.amount : inv.total)) + '</td>' +
        '<td>' + UI.statusBadge(inv.status) + '</td>' +
        '<td>' + emailStateBadge(inv) + '</td>' +
        '<td class="cell-muted nowrap">' + UI.esc(UI.fmt.date(inv.invoice_date || inv.created_at)) + '</td>' +
        '<td class="td-actions"><div class="row-actions">' +
          '<button class="icon-btn" data-act="view" title="Details" style="width:32px;height:32px"><i data-lucide="eye"></i></button>' +
        '</div></td></tr>';
    }

    function wireRows(items) {
      var tbody = document.querySelector('#inv-table tbody');
      tbody.querySelectorAll('tr').forEach(function (tr) {
        var id = tr.getAttribute('data-id');
        var inv = items.find(function (x) { return String(x.id !== undefined ? x.id : x._id) === String(id); });
        if (!inv) return;
        tr.querySelector('[data-act="view"]').addEventListener('click', function () { viewInvoice(inv); });
      });
    }

    /* ---------------------------------------------------------------- */
    function viewInvoice(rowData) {
      var id = rowData.id !== undefined ? rowData.id : rowData._id;
      API.get(EP.get, null, { repl: { id: id } })
        .then(function (full) { showDetail(full || rowData); })
        .catch(function (err) {
          if (err.kind === 'NOT_FOUND') showDetail(rowData);
          else UI.toast('error', 'Could not load invoice', err.message);
        });
    }

    function showDetail(inv) {
      var id = inv.id !== undefined ? inv.id : inv._id;
      var number = inv.invoice_number || inv.number || inv.invoice_no || ('#' + id);
      var emailHistory = inv.email_history || inv.emails || [];

      var body =
        '<dl class="detail-grid">' +
        '<dt>Invoice #</dt><dd class="mono">' + UI.esc(number) + '</dd>' +
        '<dt>Customer</dt><dd>' + UI.esc(inv.customer_name || '—') + '<br/><span class="cell-sub">' + UI.esc(inv.customer_email || inv.email || '') + '</span></dd>' +
        '<dt>Amount</dt><dd>' + UI.esc(UI.fmt.currency(inv.amount !== undefined ? inv.amount : inv.total)) + '</dd>' +
        '<dt>Invoice status</dt><dd>' + UI.statusBadge(inv.status) + '</dd>' +
        '<dt>Email state</dt><dd>' + emailStateBadge(inv) + '</dd>' +
        '<dt>Invoice date</dt><dd>' + UI.esc(UI.fmt.dateTime(inv.invoice_date || inv.created_at)) + '</dd>' +
        (inv.due_date ? '<dt>Due date</dt><dd>' + UI.esc(UI.fmt.dateTime(inv.due_date)) + '</dd>' : '') +
        (inv.email_sent_at ? '<dt>Email sent</dt><dd>' + UI.esc(UI.fmt.dateTime(inv.email_sent_at)) + '</dd>' : '') +
        (inv.email_error ? '<dt>Email error</dt><dd style="color:var(--c-danger)">' + UI.esc(inv.email_error) + '</dd>' : '') +
        (Array.isArray(inv.items) && inv.items.length
          ? '<dt>Items</dt><dd>' + inv.items.map(function (it) {
              return UI.esc((it.name || it.description || 'Item') + ' — ' + UI.fmt.currency(it.amount !== undefined ? it.amount : it.price));
            }).join('<br/>') + '</dd>' : '') +
        '</dl>';

      if (emailHistory.length) {
        body += '<div class="detail-section-title">Invoice email history</div>' +
          '<table class="mini-table"><thead><tr><th>Time</th><th>Status</th><th>Detail</th></tr></thead><tbody>' +
          emailHistory.map(function (h) {
            return '<tr><td class="nowrap">' + UI.esc(UI.fmt.dateTime(h.created_at || h.sent_at)) + '</td>' +
              '<td>' + UI.statusBadge(h.status) + '</td>' +
              '<td>' + UI.esc(h.error || h.detail || h.message_id || '—') + '</td></tr>';
          }).join('') + '</tbody></table>';
      }

      var canSend = !(inv.email_status === 'sent' || inv.email_sent_at);
      UI.modal({
        title: 'Invoice ' + number,
        size: 'lg',
        body: body,
        foot:
          (inv.pdf_available !== false ?
            '<button class="btn btn-secondary" id="inv-pdf"><i data-lucide="file-text" class="btn-icon"></i><span>Open PDF</span></button>' : '') +
          (canSend
            ? '<button class="btn btn-primary" id="inv-send"><i data-lucide="send" class="btn-icon"></i><span>Send invoice email</span></button>'
            : '<button class="btn btn-outline-danger" id="inv-resend"><i data-lucide="rotate-cw" class="btn-icon"></i><span>Resend invoice email</span></button>') +
          '<button class="btn btn-secondary" data-close>Close</button>',
        onOpen: function (box, close) {
          box.querySelector('[data-close]').addEventListener('click', close);

          var pdfBtn = box.querySelector('#inv-pdf');
          pdfBtn && pdfBtn.addEventListener('click', function () {
            var btn = this;
            btn.disabled = true;
            API.download(EP.pdf, { id: id }, 'invoice-' + String(number).replace(/[^\w.-]+/g, '_') + '.pdf', 'application/pdf')
              .then(function () { btn.disabled = false; })
              .catch(function (err) {
                btn.disabled = false;
                if (err.kind === 'NOT_FOUND') UI.toast('warning', 'PDF not supported', 'GET /api/admin/invoices/:id/pdf is not implemented on the backend.');
                else UI.toast('error', 'Could not download PDF', err.message);
              });
          });

          var sendBtn = box.querySelector('#inv-send');
          sendBtn && sendBtn.addEventListener('click', function () {
            var email = inv.customer_email || inv.email;
            UI.confirm({
              title: 'Send invoice email?',
              message: 'Sends invoice <strong>' + UI.esc(number) + '</strong> to <strong>' + UI.esc(email || 'the customer address on file') + '</strong>.',
              confirmLabel: 'Send invoice'
            }).then(function (ok) {
              if (!ok) return;
              sendBtn.disabled = true;
              API.post(EP.send.replace(':id', id))
                .then(function () { close(); UI.toast('success', 'Invoice email sent', number); load(); })
                .catch(function (err) { sendBtn.disabled = false; UI.toast('error', 'Send failed', err.message); });
            });
          });

          var resendBtn = box.querySelector('#inv-resend');
          resendBtn && resendBtn.addEventListener('click', function () {
            var email = inv.customer_email || inv.email;
            UI.confirm({
              title: 'Resend invoice email?',
              message: 'The invoice email for <strong>' + UI.esc(number) + '</strong> will be sent again to <strong>' + UI.esc(email || 'the customer address on file') + '</strong>.',
              confirmLabel: 'Resend'
            }).then(function (ok) {
              if (!ok) return;
              resendBtn.disabled = true;
              API.post(EP.resend.replace(':id', id))
                .then(function () { close(); UI.toast('success', 'Invoice email resent', number); load(); })
                .catch(function (err) { resendBtn.disabled = false; UI.toast('error', 'Resend failed', err.message); });
            });
          });
        }
      });
    }
  });
})();
