/* ============================================================================
 * SMMARIA Email Manager — ui.js
 * ----------------------------------------------------------------------------
 * Shared layout + component layer used by every protected page.
 *
 * NOTE: This file is an addition to the original ZIP skeleton. It is
 * necessary because all 13 pages share the same sidebar / topbar / toasts /
 * modals / formatters; without a shared module that markup would be
 * duplicated ( unmaintainable ) across every HTML file. See README.md.
 *
 * Exposes:
 *   SMMUI.escapeHtml / esc
 *   SMMUI.fmt.date / dateTime / timeAgo / number / percent / currency
 *   SMMUI.debounce
 *   SMMUI.toast(type, title, msg)
 *   SMMUI.confirm({title, message, confirmLabel, danger, icon}) → Promise<bool>
 *   SMMUI.modal({title, sub, body, foot, size, onOpen}) → { el, close }
 *   SMMUI.statusBadge(status)
 *   SMMUI.skeletonRows(tbody, cols, rows)
 *   SMMUI.renderState(container, {type:'empty'|'error'|'loading', ...})
 *   SMMUI.pagination(container, {page, totalPages, total, onPage})
 *   SMMUI.safeIframeDoc(html)  — XSS-safe HTML email preview document
 *   SMMUI.pageIcon(name)       — lucide icon fallback helper
 *
 * Auto-initialization (on DOMContentLoaded):
 *   - auth guard (body.pre-auth → SMMAuth.requireAuth)
 *   - sidebar + topbar rendering from body[data-page]
 *   - notifications + profile dropdowns
 *   - drawer / collapse behavior
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG;

  /* ==================================================================== */
  /* A. Utilities                                                          */
  /* ==================================================================== */

  var ENTITY_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;' };
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"'`/]/g, function (ch) { return ENTITY_MAP[ch]; });
  }
  var esc = escapeHtml;

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(ctx, args); }, wait || 350);
    };
  }

  var fmt = {
    date: function (v) {
      var d = toDate(v);
      if (!d) return '—';
      return new Intl.DateTimeFormat(CFG.LOCALE, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
    },
    dateTime: function (v) {
      var d = toDate(v);
      if (!d) return '—';
      return new Intl.DateTimeFormat(CFG.LOCALE, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
    },
    time: function (v) {
      var d = toDate(v);
      if (!d) return '—';
      return new Intl.DateTimeFormat(CFG.LOCALE, { hour: '2-digit', minute: '2-digit' }).format(d);
    },
    timeAgo: function (v) {
      var d = toDate(v);
      if (!d) return '—';
      var diff = Date.now() - d.getTime();
      var future = diff < 0;
      diff = Math.abs(diff);
      var s = Math.round(diff / 1000);
      var out;
      if (s < 45) out = 'just now';
      else if (s < 2700) out = Math.round(s / 60) + ' min';
      else if (s < 86400 * 1.5) out = Math.round(s / 3600) + ' h';
      else if (s < 86400 * 60) out = Math.round(s / 86400) + ' d';
      else out = fmt.date(d);
      if (out === 'just now') return out;
      return future ? 'in ' + out : out + ' ago';
    },
    number: function (v) {
      if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—';
      return new Intl.NumberFormat(CFG.LOCALE).format(Number(v));
    },
    percent: function (v, digits) {
      if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—';
      var n = Number(v);
      if (n <= 1 && n > 0 && String(v).indexOf('%') === -1) n = n * 100; // accept 0.97 or 97
      return n.toFixed(digits === undefined ? 1 : digits) + '%';
    },
    currency: function (v) {
      if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—';
      try {
        return new Intl.NumberFormat(CFG.LOCALE, { style: 'currency', currency: CFG.CURRENCY }).format(Number(v));
      } catch (e) { return String(v); }
    }
  };

  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  /* ==================================================================== */
  /* B. Status badges                                                     */
  /* ==================================================================== */

  var STATUS_MAP = {
    /* campaigns / announcements */
    draft:      ['badge-neutral', 'draft'],
    scheduled:  ['badge-indigo',  'scheduled'],
    processing: ['badge-info',    'processing'],
    sending:    ['badge-info',    'sending'],
    sent:       ['badge-success', 'sent'],
    completed:  ['badge-success', 'completed'],
    published:  ['badge-success', 'published'],
    failed:     ['badge-danger',  'failed'],
    cancelled:  ['badge-neutral', 'cancelled'],
    /* email delivery lifecycle */
    queued:     ['badge-neutral', 'queued'],
    accepted:   ['badge-info',    'accepted'],
    delivered:  ['badge-success', 'delivered'],
    bounced:    ['badge-danger',  'bounced'],
    /* subscribers */
    active:     ['badge-success', 'active'],
    unsubscribed:['badge-warning','unsubscribed'],
    complained: ['badge-danger',  'spam complaint'],
    /* invoices */
    paid:       ['badge-success', 'paid'],
    unpaid:     ['badge-warning', 'unpaid'],
    pending:    ['badge-warning', 'pending'],
    overdue:    ['badge-danger',  'overdue'],
    /* queue jobs */
    not_sent:   ['badge-neutral', 'not sent'],
    /* suppressions */
    hard_bounce:['badge-danger',  'hard bounce'],
    spam_complaint: ['badge-danger', 'spam complaint'],
    invalid:    ['badge-warning', 'invalid'],
    admin_blocked: ['badge-purple', 'admin blocked'],
    /* fallback */
    true:       ['badge-success', 'enabled'],
    false:      ['badge-neutral', 'disabled']
  };

  function statusBadge(status) {
    if (status === null || status === undefined || status === '') {
      return '<span class="badge badge-neutral">—</span>';
    }
    var key = String(status).toLowerCase().trim().replace(/[\s-]+/g, '_');
    var conf = STATUS_MAP[key] || ['badge-neutral', String(status)];
    return '<span class="badge ' + conf[0] + '">' + esc(conf[1]) + '</span>';
  }

  /* ==================================================================== */
  /* C. Toasts                                                            */
  /* ==================================================================== */

  var toastIcons = {
    success: 'check-circle', error: 'x-circle', warning: 'alert-triangle', info: 'info'
  };

  function ensureToastContainer() {
    var el = document.getElementById('toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-container';
      el.className = 'toast-container';
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(type, title, msg, timeoutMs) {
    var cont = ensureToastContainer();
    var el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML =
      '<i data-lucide="' + (toastIcons[type] || 'info') + '" class="toast-icon"></i>' +
      '<div class="toast-body">' +
        '<div class="toast-title">' + esc(title) + '</div>' +
        (msg ? '<div class="toast-msg">' + esc(msg) + '</div>' : '') +
      '</div>' +
      '<button class="toast-close" aria-label="Dismiss">' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      '</button>';
    cont.appendChild(el);
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });

    var close = function () {
      if (!el.parentNode) return;
      el.classList.add('leaving');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 190);
    };
    el.querySelector('.toast-close').addEventListener('click', close);
    setTimeout(close, timeoutMs || (type === 'error' ? 7000 : 4200));
    return el;
  }

  /* ==================================================================== */
  /* D. Modals & confirm                                                  */
  /* ==================================================================== */

  function ensureModalRoot() {
    var root = document.getElementById('modal-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'modal-root';
      document.body.appendChild(root);
    }
    return root;
  }

  /**
   * Open a modal.
   * @param {Object} o {title, sub, body, foot, size:'sm'|'md'|'lg', onClose, onOpen}
   *   body/foot: HTML strings or DOM nodes.
   * @returns {{el: HTMLElement, close: Function, body: HTMLElement}}
   */
  function modal(o) {
    var root = ensureModalRoot();
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    var box = document.createElement('div');
    box.className = 'modal' + (o.size === 'lg' ? ' modal-lg' : o.size === 'sm' ? ' modal-sm' : '');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    var bodyHtml = typeof o.body === 'string' ? o.body : '';
    var footHtml = typeof o.foot === 'string' ? o.foot : '';

    box.innerHTML =
      '<div class="modal-head">' +
        '<div><h3 class="modal-title">' + esc(o.title || '') + '</h3>' +
        (o.sub ? '<p class="modal-sub">' + esc(o.sub) + '</p>' : '') + '</div>' +
        '<button class="modal-close" aria-label="Close dialog">' +
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="modal-body"></div>' +
      (o.foot ? '<div class="modal-foot"></div>' : '');

    var bodyEl = box.querySelector('.modal-body');
    if (o.body instanceof Node) bodyEl.appendChild(o.body);
    else bodyEl.innerHTML = bodyHtml;

    if (o.foot) {
      var footEl = box.querySelector('.modal-foot');
      if (o.foot instanceof Node) footEl.appendChild(o.foot);
      else footEl.innerHTML = footHtml;
    }

    overlay.appendChild(box);
    root.appendChild(overlay);

    var prevFocus = document.activeElement;
    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function close() {
      if (!overlay.parentNode) return;
      overlay.parentNode.removeChild(overlay);
      document.body.style.overflow = prevOverflow;
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      document.removeEventListener('keydown', onKey);
      if (typeof o.onClose === 'function') o.onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    box.querySelector('.modal-close').addEventListener('click', close);

    // Focus first focusable element inside the modal.
    var focusable = box.querySelector('input, select, textarea, button:not(.modal-close), [href]');
    if (focusable) setTimeout(function () { focusable.focus(); }, 40);

    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
    if (typeof o.onOpen === 'function') o.onOpen(box, close);

    return { el: box, overlay: overlay, close: close, body: bodyEl };
  }

  /**
   * Promise-based confirmation dialog.
   * @param {Object} o {title, message, confirmLabel, cancelLabel, danger, warning, requireText}
   *   requireText: user must type this exact string to enable confirm (destructive ops).
   */
  function confirm(o) {
    return new Promise(function (resolve) {
      var iconClass = o.danger ? 'danger' : 'warning';
      var iconName = o.danger ? 'alert-octagon' : 'help-circle';
      var bodyHtml =
        '<div class="confirm-icon ' + iconClass + '"><i data-lucide="' + iconName + '"></i></div>' +
        '<p style="font-size:14px;color:var(--c-text-2);line-height:1.6">' + o.message + '</p>'; // message may contain trusted markup
      if (o.requireText) {
        bodyHtml +=
          '<div class="form-group" style="margin-top:14px">' +
          '<label class="form-label">Type <code>' + esc(o.requireText) + '</code> to confirm</label>' +
          '<input type="text" class="form-input" id="confirm-challenge" autocomplete="off" spellcheck="false"/>' +
          '</div>';
      }

      var m = modal({
        title: o.title || 'Are you sure?',
        size: 'sm',
        body: bodyHtml,
        foot:
          '<button class="btn btn-secondary" data-act="cancel">Cancel</button>' +
          '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok"' + (o.requireText ? ' disabled' : '') + '>' +
            esc(o.confirmLabel || 'Confirm') + '</button>',
        onOpen: function (box, close) {
          var done = false;
          function settle(val) { if (done) return; done = true; close(); resolve(val); }
          box.querySelector('[data-act="cancel"]').addEventListener('click', function () { settle(false); });
          box.querySelector('[data-act="ok"]').addEventListener('click', function () { settle(true); });
          var challenge = box.querySelector('#confirm-challenge');
          if (challenge) {
            var okBtn = box.querySelector('[data-act="ok"]');
            challenge.addEventListener('input', function () {
              okBtn.disabled = challenge.value.trim() !== o.requireText;
            });
          }
        }
      });
      // Escape resolves as "cancel".
      m.el && document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') { resolve(false); document.removeEventListener('keydown', escHandler); }
      });
    });
  }

  /* ==================================================================== */
  /* E. State boxes: loading / empty / error                              */
  /* ==================================================================== */

  var stateIcons = { empty: 'inbox', error: 'cloud-off', loading: 'loader-2' };

  function renderState(container, o) {
    if (!container) return;
    o = o || {};
    if (o.type === 'clear') { container.innerHTML = ''; return; }

    if (o.type === 'loading') {
      container.innerHTML = '<div class="state-loading"><div class="entry-spinner" style="margin:0"></div><p class="se-text">Loading…</p></div>';
      return;
    }

    if (o.type === 'empty') {
      container.innerHTML =
        '<div class="state-empty">' +
          '<div class="se-icon"><i data-lucide="' + (o.icon || stateIcons.empty) + '"></i></div>' +
          '<p class="se-title">' + esc(o.title || 'Nothing here yet') + '</p>' +
          (o.text ? '<p class="se-text">' + esc(o.text) + '</p>' : '') +
          (o.action ? '<div class="se-action">' + o.action + '</div>' : '') +
        '</div>';
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
      return;
    }

    if (o.type === 'error') {
      var err = o.error || {};
      container.innerHTML =
        '<div class="state-error">' +
          '<div class="se-icon"><i data-lucide="' + stateIcons.error + '"></i></div>' +
          '<p class="se-title">' + esc(o.title || 'Could not load data') + '</p>' +
          '<p class="se-text">' + esc(err.message || 'An unexpected error occurred.') + '</p>' +
          (err.status ? '<p class="se-code">HTTP status: ' + esc(err.status) + (err.kind ? ' · ' + esc(err.kind) : '') + '</p>' : '') +
          (o.retry ?
            '<div class="se-action"><button class="btn btn-secondary btn-sm" data-retry>' +
            '<i data-lucide="rotate-cw" class="btn-icon"></i><span>Try again</span></button></div>' : '') +
        '</div>';
      if (o.retry) {
        container.querySelector('[data-retry]').addEventListener('click', o.retry);
      }
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
      return;
    }
  }

  /** Shimmering skeleton rows for a table body. */
  function skeletonRows(tbody, cols, rows) {
    if (!tbody) return;
    cols = cols || 5; rows = rows || 6;
    var html = '';
    for (var r = 0; r < rows; r++) {
      html += '<tr>';
      for (var c = 0; c < cols; c++) {
        var w = c === 0 ? '42%' : (18 + ((r + c) % 3) * 9) + '%';
        html += '<td><div class="skeleton-block" style="width:' + w + '"></div></td>';
      }
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

  /* ==================================================================== */
  /* F. Pagination                                                        */
  /* ==================================================================== */

  /**
   * Render pagination controls.
   * @param {HTMLElement} container
   * @param {Object} o {page, totalPages, total, onPage(fn), limit}
   */
  function pagination(container, o) {
    if (!container) return;
    var page = Math.max(1, Number(o.page) || 1);
    var total = Math.max(0, Number(o.totalPages) || 0);
    if (total <= 1) {
      container.innerHTML = o.total !== undefined
        ? '<span class="table-info">' + fmt.number(o.total) + ' ' + (Number(o.total) === 1 ? 'record' : 'records') + '</span>'
        : '';
      return;
    }

    function btn(label, target, opts) {
      opts = opts || {};
      return '<button class="page-btn' + (opts.active ? ' active' : '') + '" data-page="' + target + '"' +
        (opts.disabled ? ' disabled' : '') + '>' + label + '</button>';
    }

    var html = btn('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>', page - 1, { disabled: page <= 1 });
    html += '<span class="page-ellipsis">Page ' + page + ' of ' + total + '</span>';
    html += btn('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>', page + 1, { disabled: page >= total });
    container.innerHTML = html;

    container.querySelectorAll('.page-btn:not(:disabled)').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = Number(b.getAttribute('data-page'));
        if (t >= 1 && t <= total && typeof o.onPage === 'function') o.onPage(t);
      });
    });
  }

  /* ==================================================================== */
  /* G. Safe HTML email preview                                           */
  /* ==================================================================== */

  /**
   * Build a fully sandboxed srcdoc document for untrusted HTML email bodies.
   * sandbox="" blocks scripts, forms, navigation and same-origin access.
   */
  function safeIframeDoc(html) {
    var doc =
      '<!DOCTYPE html><html><head><meta charset="utf-8"/>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
      '<base target="_blank">' +
      '<style>body{margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;color:#222;background:#fff;word-break:break-word}img{max-width:100%}table{max-width:100%}a{color:#4F46E5}</style>' +
      '</head><body>' + (html || '<p style="color:#999">(empty body)</p>') + '</body></html>';
    return doc;
  }

  /** Create the sandboxed preview iframe element. */
  function previewIframe(html) {
    var iframe = document.createElement('iframe');
    iframe.className = 'preview-frame';
    iframe.setAttribute('sandbox', '');           // no scripts, no same-origin
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.srcdoc = safeIframeDoc(html);
    return iframe;
  }

  /* ==================================================================== */
  /* H. Shell rendering (sidebar + topbar)                                */
  /* ==================================================================== */

  var NAV = [
    { group: 'Main' },
    { id: 'dashboard',      label: 'Dashboard',      icon: 'layout-dashboard', href: 'dashboard.html',            root: true },
    { id: 'compose',        label: 'Compose Email',  icon: 'pen-line',         href: 'pages/compose.html' },
    { id: 'campaigns',      label: 'Campaigns',      icon: 'megaphone',        href: 'pages/campaigns.html' },
    { id: 'subscribers',    label: 'Subscribers',    icon: 'users',            href: 'pages/subscribers.html' },
    { id: 'email-history',  label: 'Email History',  icon: 'inbox',            href: 'pages/email-history.html' },
    { group: 'Content' },
    { id: 'templates',      label: 'Templates',      icon: 'layout-template',  href: 'pages/templates.html' },
    { id: 'automations',    label: 'Automations',    icon: 'zap',              href: 'pages/automations.html' },
    { id: 'announcements',  label: 'Announcements',  icon: 'bell-ring',        href: 'pages/announcements.html' },
    { group: 'Finance' },
    { id: 'invoices',       label: 'Invoices',       icon: 'receipt',          href: 'pages/invoices.html' },
    { group: 'Insights' },
    { id: 'analytics',      label: 'Analytics',      icon: 'bar-chart-3',      href: 'pages/analytics.html' },
    { group: 'Operations' },
    { id: 'queue',          label: 'Email Queue',    icon: 'list-checks',      href: 'pages/queue.html' },
    { id: 'suppressions',   label: 'Suppressions',   icon: 'shield-off',       href: 'pages/suppressions.html' },
    { group: 'System' },
    { id: 'settings',       label: 'Settings',       icon: 'settings',         href: 'pages/settings.html' }
  ];

  var LOGO_SVG =
    '<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">' +
    '<rect width="32" height="32" rx="8" fill="#4F46E5"/>' +
    '<path d="M8 11l8 6 8-6v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V11z" fill="#fff" opacity=".9"/>' +
    '<path d="M8 10a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1l-8 6-8-6z" fill="#fff"/></svg>';

  function renderSidebar(pageId, root) {
    var aside = document.getElementById('sidebar');
    if (!aside) return;

    var html =
      '<div class="sidebar-brand">' +
        '<span class="brand-mark">' + LOGO_SVG + '</span>' +
        '<span class="brand-text"><span class="brand-name">SMMARIA</span><br/>' +
        '<span class="brand-tag">Email Manager</span></span>' +
      '</div>' +
      '<nav class="sidebar-nav">';

    NAV.forEach(function (item) {
      if (item.group) {
        html += '<div class="nav-group-label"><span>' + esc(item.group) + '</span></div>';
        return;
      }
      var href = root + item.href;
      var active = item.id === pageId ? ' active' : '';
      var ariaCurrent = item.id === pageId ? ' aria-current="page"' : '';
      html +=
        '<a class="nav-item' + active + '" href="' + href + '"' + ariaCurrent + ' data-nav="' + item.id + '">' +
          '<i data-lucide="' + item.icon + '"></i>' +
          '<span class="nav-label">' + esc(item.label) + '</span>' +
        '</a>';
    });
    html += '</nav>';

    html +=
      '<div class="sidebar-foot">' +
        '<button type="button" class="sidebar-collapse-btn" id="sidebar-collapse" aria-label="Collapse sidebar">' +
          '<i data-lucide="chevrons-left"></i><span class="nav-label">Collapse</span>' +
        '</button>' +
      '</div>';

    aside.innerHTML = html;
  }

  function renderTopbar(page) {
    var bar = document.getElementById('topbar');
    if (!bar) return;
    var admin = window.SMMAuth ? window.SMMAuth.getAdmin() : null;
    var name = (admin && (admin.name || admin.displayName || admin.email || 'Administrator')) || 'Administrator';
    var email = (admin && admin.email) || '';
    var role = (admin && (admin.role || admin.role_name)) || 'Administrator';
    var initials = String(name).trim().split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('');

    bar.innerHTML =
      '<button class="icon-btn mobile-toggle" id="drawer-toggle" aria-label="Open navigation menu" aria-expanded="false">' +
        '<i data-lucide="menu"></i>' +
      '</button>' +
      '<div class="topbar-title-wrap">' +
        '<div class="topbar-title">' + esc(page.title) + '</div>' +
        '<nav class="topbar-crumb" aria-label="Breadcrumb">' +
          '<span>' + esc(CFG.APP_NAME) + '</span>' +
          (page.crumb ? '<span class="crumb-sep">/</span>' : '') +
          (page.crumb ? '<span class="crumb-current">' + esc(page.crumb) + '</span>' : '') +
        '</nav>' +
      '</div>' +
      '<div class="topbar-spacer"></div>' +
      '<div class="topbar-actions">' +
        '<div class="row-menu-wrap" id="notif-wrap">' +
          '<button class="icon-btn" id="notif-btn" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">' +
            '<i data-lucide="bell"></i><span class="dot hidden" id="notif-dot"></span>' +
          '</button>' +
        '</div>' +
        '<div class="row-menu-wrap" id="profile-wrap">' +
          '<button class="profile-btn" id="profile-btn" aria-haspopup="true" aria-expanded="false">' +
            '<span class="avatar">' + esc(initials || 'A') + '</span>' +
            '<span class="profile-meta"><span class="profile-name">' + esc(name) + '</span><br/>' +
            '<span class="profile-role">' + esc(role) + '</span></span>' +
            '<i data-lucide="chevron-down" class="profile-chevron"></i>' +
          '</button>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- Notifications dropdown ---------------- */
  function wireNotifications(root) {
    var wrap = document.getElementById('notif-wrap');
    var btn = document.getElementById('notif-btn');
    if (!wrap || !btn) return;
    var dot = document.getElementById('notif-dot');
    var open = false;

    function close() {
      var dd = wrap.querySelector('.dropdown');
      if (dd) dd.remove();
      open = false;
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (open) { close(); return; }
      open = true;
      btn.setAttribute('aria-expanded', 'true');

      var dd = document.createElement('div');
      dd.className = 'dropdown open';
      dd.innerHTML =
        '<div class="dropdown-head"><span>Notifications</span>' +
        '<button class="link-btn" id="notif-refresh" style="font-size:12px">Reload</button></div>' +
        '<div class="dropdown-body"><div class="dropdown-empty">Loading…</div></div>';
      wrap.appendChild(dd);

      dd.querySelector('#notif-refresh').addEventListener('click', function (ev) { ev.stopPropagation(); load(dd); });
      load(dd);
      if (dot) dot.classList.add('hidden');

      function load(container) {
        var body = container.querySelector('.dropdown-body');
        // Primary source: dedicated notifications endpoint (optional).
        window.SMMApi.get(CFG.ENDPOINTS.notifications.list, { limit: 8 })
          .catch(function (err) {
            if (err.kind === 'NOT_FOUND' || err.kind === 'CONFIG') {
              // Documented fallback: recent failed emails.
              return window.SMMApi.get(CFG.ENDPOINTS.emails.list, { status: 'failed', limit: 8, page: 1 })
                .then(function (data) {
                  return { fallback: true, items: extractList(data), total: extractTotal(data) };
                });
            }
            throw err;
          })
          .then(function (payload) {
            var items = Array.isArray(payload) ? payload : (payload && (payload.items || payload.notifications || payload.data)) || [];
            if (payload && payload.fallback) items = payload.items;
            if (!items.length) {
              body.innerHTML = '<div class="dropdown-empty">You are all caught up.<br/>No notifications.</div>';
              return;
            }
            body.innerHTML = items.map(function (n) {
              var title = n.title || n.subject || 'Notification';
              var sub = n.message || n.error || n.created_at || '';
              return '<div class="dropdown-item notif-item">' +
                '<span class="di-icon" style="background:var(--c-danger-bg);color:var(--c-danger)"><i data-lucide="alert-circle"></i></span>' +
                '<div style="min-width:0"><div class="di-title">' + esc(title) + '</div>' +
                '<div class="di-sub">' + esc(String(sub).slice(0, 70)) + '</div></div></div>';
            }).join('');
            if (payload && payload.fallback) {
              body.insertAdjacentHTML('beforeend',
                '<div class="dropdown-foot"><a class="link-btn" href="' + root + 'pages/email-history.html?status=failed">View all failures</a></div>');
            }
            if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
          })
          .catch(function (err) {
            body.innerHTML = '<div class="dropdown-empty">Notifications unavailable.<br/><span style="font-size:11px">' + esc(err.message || '') + '</span></div>';
          });
      }
    });

    document.addEventListener('click', function (e) {
      if (open && !wrap.contains(e.target)) close();
    });
  }

  /* ---------------- Profile dropdown ---------------- */
  function wireProfile(root) {
    var wrap = document.getElementById('profile-wrap');
    var btn = document.getElementById('profile-btn');
    if (!wrap || !btn) return;
    var admin = window.SMMAuth ? window.SMMAuth.getAdmin() : null;
    var open = false;

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (open) { wrap.querySelector('.dropdown') && wrap.querySelector('.dropdown').remove(); open = false; btn.setAttribute('aria-expanded', 'false'); return; }
      open = true;
      btn.setAttribute('aria-expanded', 'true');

      var dd = document.createElement('div');
      dd.className = 'dropdown open';
      dd.style.minWidth = '240px';
      dd.innerHTML =
        '<div class="menu-head">' +
          '<div class="menu-name">' + esc((admin && (admin.name || admin.email)) || 'Administrator') + '</div>' +
          '<div class="menu-email">' + esc((admin && admin.email) || '') + '</div>' +
        '</div>' +
        '<div class="menu-sep"></div>' +
        '<div class="menu-list">' +
          '<a class="menu-item" href="' + root + 'pages/settings.html"><i data-lucide="settings"></i><span>System settings</span></a>' +
          '<button type="button" class="menu-item" id="profile-logout"><i data-lucide="log-out"></i><span>Sign out</span></button>' +
        '</div>';
      wrap.appendChild(dd);
      if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });

      dd.querySelector('#profile-logout').addEventListener('click', function () { doLogout(root); });
    });

    document.addEventListener('click', function (e) {
      if (open && !wrap.contains(e.target)) {
        var dd = wrap.querySelector('.dropdown');
        if (dd) dd.remove();
        open = false;
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  var loggingOut = false;
  function doLogout(root) {
    if (loggingOut) return;
    loggingOut = true;
    toast('info', 'Signing out…', 'Revoking your session.');
    window.SMMAuth.logout().then(function () {
      window.location.replace((root || '') + 'login.html');
    });
  }
  // expose for potential reuse
  window.SMMLogout = doLogout;

  /* ---------------- Drawer & collapse ---------------- */
  function wireShell(shell) {
    var overlay = document.getElementById('sidebar-overlay');
    var toggle = document.getElementById('drawer-toggle');

    function closeDrawer() {
      shell.classList.remove('drawer-open');
      overlay && overlay.classList.remove('visible');
      toggle && toggle.setAttribute('aria-expanded', 'false');
    }
    toggle && toggle.addEventListener('click', function () {
      var open = shell.classList.toggle('drawer-open');
      overlay && overlay.classList.toggle('visible', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
    overlay && overlay.addEventListener('click', closeDrawer);

    // Close drawer when navigating (mobile)
    document.querySelectorAll('.sidebar .nav-item').forEach(function (a) {
      a.addEventListener('click', closeDrawer);
    });

    // Desktop collapse (persisted)
    var collapseBtn = document.getElementById('sidebar-collapse');
    collapseBtn && collapseBtn.addEventListener('click', function () {
      var collapsed = shell.classList.toggle('collapsed');
      try { localStorage.setItem(CFG.STORAGE.SIDEBAR, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
      setTimeout(function () {
        window.dispatchEvent(new CustomEvent('smm:layoutchange'));
      }, 220);
    });
    try {
      if (localStorage.getItem(CFG.STORAGE.SIDEBAR) === '1' && window.innerWidth > 900) {
        shell.classList.add('collapsed');
      }
    } catch (e) { /* ignore */ }

    // Escape closes the drawer
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });
  }

  /* ==================================================================== */
  /* I. List payload extraction helpers                                   */
  /* ==================================================================== */

  /** Pull an array out of common list response shapes. */
  function extractList(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    return payload.items || payload.data || payload.results || payload.rows ||
           payload.list || payload.records ||
           (payload[Object.keys(payload)[0]] && Array.isArray(payload[Object.keys(payload)[0]]) ? payload[Object.keys(payload)[0]] : []) ||
           [];
  }

  /** Pull a total count out of common list response shapes. */
  function extractTotal(payload, fallbackLen) {
    if (Array.isArray(payload)) return fallbackLen !== undefined ? fallbackLen : payload.length;
    if (!payload || typeof payload !== 'object') return fallbackLen || 0;
    var t = payload.total !== undefined ? payload.total :
            payload.totalCount !== undefined ? payload.totalCount :
            payload.count !== undefined ? payload.count :
            payload.meta && payload.meta.total !== undefined ? payload.meta.total :
            payload.pagination && payload.pagination.total !== undefined ? payload.pagination.total : undefined;
    if (t === undefined) return fallbackLen !== undefined ? fallbackLen : 0;
    return Number(t) || 0;
  }

  /** Pull total pages similarly. */
  function extractTotalPages(payload, total, limit) {
    if (payload && typeof payload === 'object') {
      var tp = payload.totalPages || payload.total_pages ||
               (payload.meta && payload.meta.totalPages) ||
               (payload.pagination && payload.pagination.totalPages);
      if (tp) return Math.max(1, Number(tp));
      if (payload.lastPage) return Math.max(1, Number(payload.lastPage));
    }
    if (limit && total) return Math.max(1, Math.ceil(total / limit));
    return 1;
  }

  /* ==================================================================== */
  /* J. Auto-initialization                                               */
  /* ==================================================================== */

  function initShell() {
    var body = document.body;
    var pageId = body.dataset.page;
    var root = body.dataset.root || '';

    // Protected pages: run the auth guard before anything renders.
    if (body.classList.contains('pre-auth')) {
      if (!window.SMMAuth.requireAuth(false)) return; // redirects to login when unauthenticated
      body.classList.remove('pre-auth');
      body.classList.add('authed');
    }

    var shell = document.querySelector('.app-shell');
    if (!shell) return;

    renderSidebar(pageId, root);
    renderTopbar({ title: body.dataset.title || '', crumb: body.dataset.crumb || '' });
    wireShell(shell);
    wireNotifications(root);
    wireProfile(root);
    ensureToastContainer();

    // Backend configuration notice: fires once per session when unconfigured.
    if (!window.SMMApi.isConfigured()) {
      toast('warning', 'Backend not configured',
        'Set API_BASE_URL in assets/js/config.js to your SMMARIA Email Backend URL.', 9000);
    }

    // Remote session validation (non-blocking; 401 → login).
    window.SMMAuth.validateSession().catch(function (err) {
      if (err && (err.kind === 'UNAUTHORIZED')) window.SMMAuth.handle401();
    });

    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
  }

  /* Login notice consumed on the login page only. */
  function popLoginNotice() {
    var n = window.SMMAuth ? window.SMMAuth.popNotice() : null;
    if (n && window.SMMUI) toast('warning', 'Session notice', n, 6500);
  }

  /* ==================================================================== */
  /* K. Expose                                                            */
  /* ==================================================================== */

  window.SMMUI = {
    esc: esc,
    escapeHtml: escapeHtml,
    debounce: debounce,
    fmt: fmt,
    toDate: toDate,
    statusBadge: statusBadge,
    toast: toast,
    modal: modal,
    confirm: confirm,
    renderState: renderState,
    skeletonRows: skeletonRows,
    pagination: pagination,
    safeIframeDoc: safeIframeDoc,
    previewIframe: previewIframe,
    extractList: extractList,
    extractTotal: extractTotal,
    extractTotalPages: extractTotalPages,
    icons: toastIcons
  };
  window.SMMPopLoginNotice = popLoginNotice;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (document.body.classList.contains('pre-auth')) initShell();
      else if (document.body.classList.contains('auth-body')) { /* login page: handled inline */ }
    });
  } else {
    if (document.body.classList.contains('pre-auth')) initShell();
  }
})();
