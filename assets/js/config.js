/* ============================================================================
 * SMMARIA Email Manager — config.js
 * ----------------------------------------------------------------------------
 * THE SINGLE SOURCE OF CONFIGURATION FOR THE WHOLE FRONTEND.
 *
 * 1. Set API_BASE_URL to the origin of your SMMARIA Email Backend, e.g.
 *      API_BASE_URL: "https://email-api.smmaria.com"
 *    (no trailing slash). Every API request is built from this URL.
 *
 * 2. All backend endpoint paths live in ENDPOINTS below. If your backend
 *    uses different paths, change them HERE ONLY — no other file contains
 *    a URL or endpoint path.
 *
 * 3. ENDPOINTS marked "OPTIONAL" in README.md degrade gracefully: the UI
 *    hides/disables the related feature and explains why. Nothing is faked.
 * ========================================================================== */

var EMAIL_SYSTEM_CONFIG = {

  /* ------------------------------------------------------------------
   * Backend connection
   * ------------------------------------------------------------------ */
  /** Origin of the SMMARIA Email Backend. No trailing slash. */
  API_BASE_URL: 'https://smmaria-email-backend-production.up.railway.app',

  /** Request timeout in milliseconds. */
  REQUEST_TIMEOUT: 30000,

  /** Default page size for list endpoints. */
  DEFAULT_PAGE_SIZE: 20,

  /** Maximum page size the UI will ever request. */
  MAX_PAGE_SIZE: 100,

  /** How long a remembered ("Remember me") session lasts, in days. */
  REMEMBER_DAYS: 14,

  /* ------------------------------------------------------------------
   * Application identity
   * ------------------------------------------------------------------ */
  APP_NAME: 'SMMARIA Email Manager',
  VERSION: '1.0.0',

  /* ------------------------------------------------------------------
   * Locale / formatting
   * ------------------------------------------------------------------ */
  LOCALE: 'en-US',
  CURRENCY: 'USD',

  /* ------------------------------------------------------------------
   * Local storage keys
   * ------------------------------------------------------------------ */
  STORAGE: {
    TOKEN_LOCAL:  'smm_email_token',      // used when "Remember me" is checked
    TOKEN_SESSION:'smm_email_token_sess', // used for session-only login
    ADMIN:        'smm_email_admin',
    REMEMBER:     'smm_email_remember',
    SIDEBAR:      'smm_sidebar_collapsed',
    DRAFT:        'smm_compose_draft'
  },

  /* ------------------------------------------------------------------
   * API endpoint map
   * ----------------------------------------------------------------------------
   * Every path is appended to API_BASE_URL.
   * ":id" segments are replaced at runtime by api.js helpers.
   *
   * Full request/response contract for every endpoint: see README.md
   * ("API Endpoint Mapping"). Required = page breaks without it;
   * Optional = feature degrades gracefully with a clear notice.
   * ------------------------------------------------------------------ */
  ENDPOINTS: {

    /* ---- Authentication (required) ---------------------------------- */
    auth: {
      login:   '/api/auth/login',    // POST  { email, password } -> { token, admin }
      logout:  '/api/auth/logout',   // POST  (invalidates token server-side)
      me:      '/api/auth/me'        // GET   -> { admin } (session validation)
    },

    /* ---- Dashboard (required) --------------------------------------- */
    dashboard: {
      stats:    '/api/admin/dashboard/stats',  // GET -> aggregate counters
      activity: '/api/admin/dashboard/activity' // GET ?days=14 -> time series
    },

    /* ---- Campaigns (required) --------------------------------------- */
    campaigns: {
      list:      '/api/admin/campaigns',                 // GET  ?page&limit&search&status&from&to
      get:       '/api/admin/campaigns/:id',             // GET
      create:    '/api/admin/campaigns',                 // POST
      update:    '/api/admin/campaigns/:id',             // PUT
      delete:    '/api/admin/campaigns/:id',             // DELETE
      duplicate: '/api/admin/campaigns/:id/duplicate',   // POST  (optional)
      send:      '/api/admin/campaigns/:id/send',        // POST  (starts immediate send)
      schedule:  '/api/admin/campaigns/:id/schedule',    // POST  { scheduled_at }
      cancel:    '/api/admin/campaigns/:id/cancel',      // POST
      preview:   '/api/admin/campaigns/:id/preview',     // GET   (optional — fallback: client render)
      recipients:'/api/admin/campaigns/recipients-estimate' // GET ?segment=all (optional)
    },

    /* ---- Transactional compose (required) --------------------------- */
    compose: {
      send:   '/api/admin/emails/send',  // POST { to[], subject, html, text?, sender_name?, sender_email?, type? }
      test:   '/api/admin/emails/test',  // POST { to, subject, html }  (optional)
      upload: '/api/admin/upload'        // POST multipart (file) -> { url } (optional — inline base64 fallback)
    },

    /* ---- Subscribers (required) ------------------------------------- */
    subscribers: {
      list:   '/api/admin/subscribers',        // GET  ?page&limit&search&status&from&to
      get:    '/api/admin/subscribers/:id',    // GET
      create: '/api/admin/subscribers',        // POST
      update: '/api/admin/subscribers/:id',    // PUT
      delete: '/api/admin/subscribers/:id',    // DELETE
      export: '/api/admin/subscribers/export', // GET  (optional)
      import: '/api/admin/subscribers/import', // POST multipart CSV (optional)
      bulk:   '/api/admin/subscribers/bulk'    // POST { action, ids[] } (optional)
    },

    /* ---- Email history (required) ----------------------------------- */
    emails: {
      list:  '/api/admin/emails',       // GET ?page&limit&search&status&type&from&to
      get:   '/api/admin/emails/:id',   // GET  (includes attempts + provider response)
      retry: '/api/admin/emails/:id/retry' // POST (optional)
    },

    /* ---- Templates (required) --------------------------------------- */
    templates: {
      list:      '/api/admin/templates',             // GET ?page&limit&search&category
      get:       '/api/admin/templates/:id',         // GET
      create:    '/api/admin/templates',             // POST
      update:    '/api/admin/templates/:id',         // PUT
      delete:    '/api/admin/templates/:id',         // DELETE
      duplicate: '/api/admin/templates/:id/duplicate' // POST (optional)
    },

    /* ---- Automations (required) ------------------------------------- */
    automations: {
      list:    '/api/admin/automations',           // GET
      update:  '/api/admin/automations/:id',       // PUT { enabled, template_id?, delay_minutes? }
      history: '/api/admin/automations/:id/history' // GET ?page&limit (optional)
    },

    /* ---- Announcements (required) ----------------------------------- */
    announcements: {
      list:     '/api/admin/announcements',            // GET ?page&limit&search&status
      create:   '/api/admin/announcements',            // POST
      update:   '/api/admin/announcements/:id',        // PUT
      delete:   '/api/admin/announcements/:id',        // DELETE
      publish:  '/api/admin/announcements/:id/publish', // POST
      schedule: '/api/admin/announcements/:id/schedule', // POST { scheduled_at }
      cancel:   '/api/admin/announcements/:id/cancel'    // POST (optional)
    },

    /* ---- Invoices (required) ---------------------------------------- */
    invoices: {
      list:   '/api/admin/invoices',           // GET ?page&limit&search&status&email_status&from&to
      get:    '/api/admin/invoices/:id',       // GET  (includes email history)
      send:   '/api/admin/invoices/:id/send',  // POST
      resend: '/api/admin/invoices/:id/resend',// POST
      pdf:    '/api/admin/invoices/:id/pdf'    // GET  -> application/pdf (optional)
    },

    /* ---- Analytics (required) --------------------------------------- */
    analytics: {
      overview:  '/api/admin/analytics',           // GET ?from&to  -> rates + totals
      timeseries:'/api/admin/analytics/timeseries', // GET ?from&to&period=day|week|month
      campaigns: '/api/admin/analytics/campaigns'   // GET ?from&to
    },

    /* ---- Queue (required) ------------------------------------------- */
    queue: {
      list:   '/api/admin/queue',           // GET ?page&limit&search&status
      stats:  '/api/admin/queue/stats',     // GET
      retry:  '/api/admin/queue/:id/retry', // POST
      cancel: '/api/admin/queue/:id/cancel' // POST
    },

    /* ---- Suppressions (required) ------------------------------------ */
    suppressions: {
      list:   '/api/admin/suppressions',          // GET ?page&limit&search&reason
      create: '/api/admin/suppressions',          // POST { email, reason, note? }
      remove: '/api/admin/suppressions/:id'       // DELETE
    },

    /* ---- Settings & health (required) ------------------------------- */
    settings: {
      get:    '/api/admin/settings', // GET  -> current settings (omit secrets!)
      update: '/api/admin/settings', // PUT  { ...changed fields }
      health: '/api/admin/health'    // GET  -> backend / provider / queue health
    },

    /* ---- Notifications (optional) ----------------------------------- */
    notifications: {
      list: '/api/admin/notifications' // GET ?limit=10 — fallback: recent failed emails
    }
  },

  /* ------------------------------------------------------------------
   * Template variables the backend template engine actually supports.
   * Rendered as suggestions in the template editor. Keep in sync with
   * the backend engine; anything listed here that the backend does not
   * know will be left as literal text by the backend.
   * ------------------------------------------------------------------ */
  TEMPLATE_VARIABLES: [
    '{{name}}', '{{email}}', '{{order_id}}', '{{amount}}',
    '{{service_name}}', '{{invoice_url}}'
  ],

  /* ------------------------------------------------------------------
   * Campaign recipient segments. The backend must accept these values
   * in campaign create/update payloads (field: "segment").
   * ------------------------------------------------------------------ */
  SEGMENTS: [
    { value: 'all',    label: 'All eligible subscribers' },
    { value: 'active', label: 'Active subscribers only' }
  ]
};

/* Freeze to prevent accidental runtime mutation of the contract. */
if (Object.freeze) {
  Object.freeze(EMAIL_SYSTEM_CONFIG.STORAGE);
}
