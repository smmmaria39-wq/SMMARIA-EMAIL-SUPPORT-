# SMMARIA Email Manager

A **standalone** email administration frontend for SMMARIA. Pure HTML5 + CSS3 + vanilla JavaScript (ES6). It talks to the separately developed **SMMARIA Email Backend** over HTTP/HTTPS using a single configurable API URL — it has **no** dependency on the SMMARIA main website, the SMMARIA admin panel, the SMMARIA backend codebase, Firebase, or EmailJS, and it contains **no** credentials of any kind.

---

## 1. Project overview

| | |
|---|---|
| Type | Static frontend (hostable on any web server / CDN) |
| Stack | HTML5, CSS3, Vanilla JS (ES6+), Fetch API, Chart.js 4, Lucide icons, Quill 2 (rich text) |
| Authentication | Bearer token from the email backend (`POST /api/auth/login`) |
| Data | 100% from the backend API — the frontend never fakes statistics, never invents endpoints, and shows honest empty/error states |

---

## 2. Folder structure

```
SMMARIA-EMAIL-ADMIN/
├── index.html                 Entry point → routes to login or dashboard
├── login.html                 Standalone administrator login
├── dashboard.html             Main dashboard (stats, charts, activity)
├── pages/
│   ├── campaigns.html         Bulk campaign management
│   ├── compose.html           Transactional email composer
│   ├── subscribers.html       Audience management (+ CSV import/export)
│   ├── email-history.html     Every email, delivery status, retries
│   ├── templates.html         Reusable template library
│   ├── automations.html       Event-triggered email rules
│   ├── announcements.html     Broadcast announcements
│   ├── invoices.html          Invoice email records
│   ├── analytics.html         Delivery analytics + charts
│   ├── queue.html             Live queue monitoring
│   ├── suppressions.html      Blocked addresses
│   └── settings.html          System settings + health
└── assets/
    ├── css/
    │   ├── style.css          Design system: tokens, shell, components
    │   ├── dashboard.css      Page layouts: KPIs, composer, settings…
    │   └── responsive.css     Breakpoints: 1280 / 1024 / 900 / 768 / 560 / 380 px
    └── js/
        ├── config.js          ★ SINGLE SOURCE OF CONFIGURATION (API URL + endpoints)
        ├── api.js             Central API client (all fetch() calls live here)
        ├── auth.js            Login / logout / session guard / 401 handling
        ├── ui.js              ★ Shared shell: sidebar, topbar, toasts, modals,
        │                        pagination, formatters, state boxes
        ├── dashboard.js       dashboard.html logic
        ├── campaigns.js       campaigns.html logic
        ├── compose.js         compose.html logic
        ├── subscribers.js     subscribers.html logic
        ├── email-history.js   email-history.html logic
        ├── templates.js       templates.html logic
        ├── automations.js     automations.html logic
        ├── announcements.js   announcements.html logic
        ├── invoices.js        invoices.html logic
        ├── analytics.js       analytics.html logic
        ├── queue.js           queue.html logic
        ├── suppressions.js    suppressions.html logic
        └── settings.js        settings.html logic
```

★ `ui.js` is an **addition** to the original skeleton (which contained no shared-UI file). It exists so the sidebar, topbar, toasts, modals and helpers are defined once instead of duplicated across 13 HTML files. `config.js` and `api.js` keep their original responsibilities.

---

## 3. Backend URL configuration

Edit **one file** — `assets/js/config.js`:

```javascript
var EMAIL_SYSTEM_CONFIG = {
  API_BASE_URL: 'https://your-email-backend.example.com',  // ← set this
  REQUEST_TIMEOUT: 30000,
  DEFAULT_PAGE_SIZE: 20,
  ...
};
```

- No trailing slash. Every request is `API_BASE_URL + endpoint path`.
- **All endpoint paths** live in `EMAIL_SYSTEM_CONFIG.ENDPOINTS` in the same file. If your backend uses different paths, change them there — no other file contains a URL.
- Until configured, the app shows a visible warning banner on login and a toast on every protected page; requests fail with a clear "backend not configured" message instead of silently hanging.

---

## 4. Authentication flow

1. `index.html` checks local session presence → routes to `login.html` or `dashboard.html`. No protected content exists in static HTML.
2. `login.html` posts credentials to `POST /api/auth/login` → expects `{ token, admin }` (also accepts `{ success, data: { token, admin } }`).
3. The token is stored in `localStorage` ("Remember me") or `sessionStorage` (default). It is attached as `Authorization: Bearer <token>` to every API request by `api.js`.
4. Every protected page runs `SMMAuth.requireAuth()` **before rendering** (body stays invisible until the guard passes) and revalidates the session against `GET /api/auth/me` in the background.
5. Any 401 from any endpoint → `SMMAuth.handle401()` → session cleared → redirect to login with a notice.
6. Logout: best-effort `POST /api/auth/logout`, then local state is always wiped (a dead backend can never trap the user in a session).

**Never place** Firebase credentials, EmailJS keys, provider API keys, or any secret in these files. The backend must enforce all authorization; the frontend guards are UX only.

---

## 5. API endpoint mapping (the contract this frontend expects)

The backend source was **not provided** with the ZIP, so paths below are the contract implemented by this frontend. They are centralized in `config.js → ENDPOINTS` — adjust them there if your backend differs. **Required** endpoints break their page when missing (clear error state); **Optional** endpoints degrade gracefully (feature hidden with an explanatory notice).

### Conventions

- Base URL: `API_BASE_URL`.
- List endpoints accept `page`, `limit` and return either a raw array or `{ data|items, total, page, totalPages }` — `api.js` normalizes both.
- Write endpoints accept JSON. All endpoints may wrap payloads in `{ success, data }` — handled automatically.
- Errors: non-2xx with `{ message }` (or `{ error }`) is shown to the administrator; 401 logs out; 404 on `/api/admin/...` is reported as "endpoint not implemented on the backend".

### 5.1 Authentication — REQUIRED

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` | `{ token: string, admin: { id, name, email, role } }` |
| POST | `/api/auth/logout` | — | 2xx |
| GET | `/api/auth/me` | — | `{ admin: {…} }` or admin object |

### 5.2 Dashboard — REQUIRED

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/api/admin/dashboard/stats` | — | Any subset of: `total_emails_sent, successful_emails, failed_emails, pending_emails, total_subscribers, active_subscribers, unsubscribed_subscribers, total_campaigns, scheduled_campaigns, emails_sent_today, delivery_rate, bounce_rate, open_rate, click_rate`. Missing fields render as "—". |
| GET | `/api/admin/dashboard/activity` | `days=14` | `{ series: [{ date, sent, failed }, …] }` |

### 5.3 Campaigns — REQUIRED

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/campaigns` | Query: `page, limit, search, status, from, to`. Item: `{ id, name, subject, status, recipients_count, sent_count, failed_count, scheduled_at, created_at, segment, sender_name, sender_email, html }` |
| POST | `/api/admin/campaigns` | `{ name*, subject*, sender_name?, sender_email?, segment?, html }` → **never auto-sends** |
| GET | `/api/admin/campaigns/:id` | Campaign detail |
| PUT | `/api/admin/campaigns/:id` | Same fields as create |
| DELETE | `/api/admin/campaigns/:id` | Frontend asks for confirmation + "DELETE" typed |
| POST | `/api/admin/campaigns/:id/duplicate` | **Optional** (fallback documented in UI) |
| POST | `/api/admin/campaigns/:id/send` | Starts immediate send — frontend shows recipient count + details first |
| POST | `/api/admin/campaigns/:id/schedule` | `{ scheduled_at: ISO-8601 }` |
| POST | `/api/admin/campaigns/:id/cancel` | For scheduled/processing |
| GET | `/api/admin/campaigns/:id/preview` | **Optional** — frontend previews from stored `html` |
| GET | `/api/admin/campaigns/recipients-estimate` | **Optional** — `?segment=all|active` → `{ count }`; fallback: dashboard stats |

Statuses understood: `draft, scheduled, processing, sent, completed, failed, cancelled`.

### 5.4 Transactional compose — REQUIRED

| Method | Path | Request |
|---|---|---|
| POST | `/api/admin/emails/send` | `{ to: string[], subject, html, text?, sender_name?, sender_email?, type? }` |
| POST | `/api/admin/emails/test` | **Optional** — `{ to, subject, html }` |
| POST | `/api/admin/upload` | **Optional** — multipart `file` → `{ url }` (fallback: inline base64) |

### 5.5 Subscribers — REQUIRED

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/subscribers` | Query: `page, limit, search, status, from, to`. Item: `{ id, email, name, status, subscribed_at, last_email_at, tags?, suppressed? }` |
| POST | `/api/admin/subscribers` | `{ email, name?, status? }` |
| GET / PUT / DELETE | `/api/admin/subscribers/:id` | Detail / update / delete |
| GET | `/api/admin/subscribers/export` | **Optional** — CSV download (auth header, not a cookie) |
| POST | `/api/admin/subscribers/import` | **Optional** — multipart `file` CSV → `{ created, updated, skipped }` |
| POST | `/api/admin/subscribers/bulk` | **Optional** — `{ action: 'delete'|'unsubscribe'|'resubscribe', ids: [] }` |

Statuses: `active, unsubscribed, bounced, complained`. Unsubscribed/bounced/complained/suppressed addresses are displayed as "cannot receive marketing email" — and the **backend must skip them regardless of selection**.

### 5.6 Email history — REQUIRED

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/emails` | Query: `page, limit, search, status, type, from, to`. Item: `{ id, recipient, subject, type, status, created_at, sent_at?, campaign_name?, error_message? }` |
| GET | `/api/admin/emails/:id` | Detail incl. `attempts[]` and `provider_response` |
| POST | `/api/admin/emails/:id/retry` | **Optional** — offered on failed rows only |

Statuses: `queued, processing, accepted, sent, delivered, failed, bounced`. The UI deliberately labels `accepted` as *"provider accepted — delivery not confirmed"*.

### 5.7 Templates — REQUIRED

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/templates` | Query: `page, limit, search, category`. Item: `{ id, name, subject, category, html, text?, variables?, updated_at }` |
| POST | `/api/admin/templates` | `{ name*, subject*, category?, html, text? }` |
| GET / PUT / DELETE | `/api/admin/templates/:id` | CRUD |
| POST | `/api/admin/templates/:id/duplicate` | **Optional** (fallback: create-copy) |

### 5.8 Automations — REQUIRED

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/automations` | Array of rules **as the backend defines them**: `{ id, name, event, description?, enabled, template_id?, template_name?, delay_minutes?, last_run_at?, failure_count? }`. Zero rules → honest empty state (no fake rule list). |
| PUT | `/api/admin/automations/:id` | `{ enabled?, template_id?, delay_minutes? }` — only fields sent that exist are changed |
| GET | `/api/admin/automations/:id/history` | **Optional** — `{ items: [{ created_at, recipient, status, error? }] }` |

Known event keys rendered with icons (any other key still renders): `user_registered, order_created, order_completed, payment_successful, payment_failed, account_purchased, invoice_created, wallet_low_balance, support_reply`.

### 5.9 Announcements — REQUIRED

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/announcements` | Query: `page, limit, search, status` |
| POST | `/api/admin/announcements` | `{ title*, type, segment, html, status: 'draft' }` |
| PUT / DELETE | `/api/admin/announcements/:id` | Update / delete |
| POST | `/api/admin/announcements/:id/publish` | Send now (confirm + recipient estimate first) |
| POST | `/api/admin/announcements/:id/schedule` | `{ scheduled_at }` |
| POST | `/api/admin/announcements/:id/cancel` | **Optional** |

Types: `new_service, new_inventory, price_change, platform_update, offer, maintenance, other`.

### 5.10 Invoices — REQUIRED

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/invoices` | Query: `page, limit, search, status, email_status, from, to`. Item: `{ id, invoice_number, customer_name, customer_email, amount, status, email_status, invoice_date, email_sent_at?, email_error? }` |
| GET | `/api/admin/invoices/:id` | Detail + `email_history[]` + optional `items[]` |
| POST | `/api/admin/invoices/:id/send` / `.../resend` | Send / resend invoice email |
| GET | `/api/admin/invoices/:id/pdf` | **Optional** — `application/pdf` (frontend downloads with auth header) |

Invoices are read from the backend only — the frontend never generates invoice data.

### 5.11 Analytics — REQUIRED

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/api/admin/analytics` | `from, to` (YYYY-MM-DD) | Any of: `total_sent, delivery_rate, failure_rate, bounce_rate, open_rate, click_rate, campaigns_sent, new_subscribers`. Unreported rates render "— not supported", with an explanatory panel. |
| GET | `/api/admin/analytics/timeseries` | `from, to, period=day\|week\|month` | `{ series: [{ date, sent, failed, new_subscribers? }] }` |
| GET | `/api/admin/analytics/campaigns` | `from, to` | Campaign performance array |

### 5.12 Queue — REQUIRED

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/queue` | Query: `page, limit, search, status`. Job: `{ id, recipient, subject, status, attempts, max_attempts?, created_at, last_attempt_at?, next_retry_at?, error?, payload? }` |
| GET | `/api/admin/queue/stats` | `{ pending, processing, completed, failed, retrying }` (missing → "—") |
| POST | `/api/admin/queue/:id/retry` | Failed jobs (confirm dialog) |
| POST | `/api/admin/queue/:id/cancel` | Pending jobs (confirm dialog) |

Job statuses: `pending, processing, completed, failed, cancelled`.

### 5.13 Suppressions — REQUIRED

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/suppressions` | Query: `page, limit, search, reason`. Item: `{ id, email, reason, source, created_at, active, note? }` |
| POST | `/api/admin/suppressions` | `{ email, reason, note? }` |
| DELETE | `/api/admin/suppressions/:id` | Backend-authorized removal; 403 is surfaced as "not authorized" |

Reasons: `unsubscribed, hard_bounce, spam_complaint, invalid, admin_blocked`.

### 5.14 Settings & health — REQUIRED

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/settings` | Nested or flat object, e.g. `{ general: { system_name, default_sender_name, default_sender_email, reply_to }, delivery: { provider, daily_limit, hourly_limit, max_retries, retry_delay_minutes }, campaigns: { default_segment, include_unsubscribe_link, unsubscribe_url, track_opens, track_clicks }, security: {…}, notifications: {…} }`. **Must never include secrets.** Only returned fields become editable inputs. |
| PUT | `/api/admin/settings` | Partial object with changed fields only |
| GET | `/api/admin/health` | `{ status, version?, provider: { name, status }, queue: { status, pending }, last_successful_connection? }` |

### 5.15 Notifications — OPTIONAL

`GET /api/admin/notifications?limit=8` → `{ items|notifications: [{ title?, subject?, message?, error?, created_at }] }`. When missing, the bell falls back to recent **failed emails** and labels it as such.

---

## 6. Missing backend endpoints / verification checklist

The backend codebase was **not available** while building this frontend, so every path in `config.js → ENDPOINTS` must be verified against the real backend before go-live:

1. Compare each path in `ENDPOINTS` with your backend routes; rename in **config.js only**.
2. For every endpoint the backend does **not** implement, either implement it (preferred) or leave it — the UI already degrades honestly (Optional) or shows "endpoint missing" errors (Required). Nothing is faked.
3. Confirm response shapes against §5 (or extend the tolerant parsers in `ui.js → extractList/extractTotal` and `api.js → handleResponse`).
4. Enforce server-side: admin authorization on every `/api/admin/*` route, suppression checks at send time, and secrets excluded from `GET /settings`.

Endpoints most commonly missing (the UI detects them and tells the administrator): `campaigns/:id/duplicate`, `campaigns/recipients-estimate`, `emails/test`, `emails/:id/retry`, `subscribers/export|import|bulk`, `templates/:id/duplicate`, `automations/:id/history`, `announcements/:id/cancel`, `invoices/:id/pdf`, `notifications`.

---

## 7. Run locally

Any static file server works (no build step):

```bash
cd SMMARIA-EMAIL-ADMIN
python3 -m http.server 8080
# → http://localhost:8080
```

Opening `index.html` via `file://` also works for a quick look, but some browsers restrict features on `file://` — prefer a local server. To exercise real data, point `API_BASE_URL` at a reachable backend and enable CORS (next section).

---

## 8. Deploy

The folder is pure static content:

- **Any host:** upload the folder (keep its structure) to Nginx/Apache/cPanel.
- **Nginx:**

```nginx
server {
  listen 443 ssl;
  server_name email-admin.smmaria.com;
  root /var/www/SMMARIA-EMAIL-ADMIN;
  index index.html;

  # hash-based SPA-less routing: direct file access only
  location / { try_files $uri $uri/ =404; }
  location ~* \.(js|css|svg|png)$ { expires 7d; add_header Cache-Control "public"; }
  add_header X-Frame-Options SAMEORIGIN;
  add_header X-Content-Type-Options nosniff;
}
```

- **Netlify / Vercel / Cloudflare Pages:** drag-and-drop the folder; no build command, output directory = folder root.
- Serve over **HTTPS** — the token travels in an `Authorization` header and must not cross plain HTTP.

CDN libraries used (pinned): Chart.js 4.4.1, Lucide 0.294.0, Quill 2.0.2, Inter font. If the panel must run fully offline, download those files into `assets/vendor/` and update the `<script>`/`<link>` tags — every consumer has a graceful fallback if a library fails to load.

---

## 9. CORS configuration on the backend

The admin panel is served from a different origin than the backend, so the backend must send:

```
Access-Control-Allow-Origin: https://email-admin.smmaria.com   # explicit origin — do NOT use * with credentials
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 86400
```

Express example:

```javascript
const cors = require('cors');
app.use(cors({
  origin: 'https://email-admin.smmaria.com', // your admin panel origin
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));
app.options('*', cors()); // preflight
```

`OPTIONS` preflight requests must not require authentication.

---

## 10. Troubleshooting connection errors

| Symptom | Meaning | Fix |
|---|---|---|
| "Backend not configured" banner | `API_BASE_URL` is still the placeholder | Edit `assets/js/config.js` |
| "Could not reach the email backend" | DNS/TLS/offline, or wrong port | Open `API_BASE_URL + /api/health` (or any route) directly in a browser |
| "took too long to respond" | Backend down or slow beyond 30 s | Check backend logs; raise `REQUEST_TIMEOUT` if legitimately slow |
| CORS error in browser console | Missing/partial CORS headers | See §9 — including `Authorization` in `Access-Control-Allow-Headers` |
| "Your session has expired" loop | Backend rejects the token, or clock skew | Re-login; check server time (JWT `exp`) |
| "Endpoint not found (404): /api/admin/…" | Backend route missing or path differs | Implement it or adjust `ENDPOINTS` in config.js |
| Login returns 200 but "did not include a session token" | Response shape differs | Return `{ token, admin }` or extend `SMMAuth.login` parsing |
| Page loads but tables spin then error | Endpoint returned unexpected shape | Check the browser console → Network tab → response JSON |

---

## 11. Security considerations

1. **Backend is the authority.** All admin authorization, suppression enforcement, validation and rate limiting happen server-side. Frontend guards exist for UX only.
2. **No secrets in the frontend.** No Firebase, EmailJS, provider keys, or hardcoded passwords anywhere in these files. `GET /settings` must omit secret fields (the UI additionally hides any key matching /secret|password|api_?key|private|token|credential/i).
3. **Token handling.** Bearer token in `localStorage` (Remember me) or `sessionStorage`; never in cookies or URLs; cleared on logout and on any 401.
4. **XSS defense.** All API strings are HTML-escaped (`SMMUI.esc`) before injection; email/template HTML renders only inside `<iframe sandbox="">` previews where scripts, forms, and navigation are blocked by the browser; `referrerpolicy=no-referrer`.
5. **Destructive operations** (delete campaign/template/subscriber/suppression, bulk delete) require confirmation dialogs — bulk deletes additionally require typing the confirmation word — and the backend must still authorize them.
6. **No silent failures.** Every request resolves into content, an empty state, or a readable error; duplicate submissions are blocked by disabling the triggering button; toasts never fake success — success is shown only after a 2xx from the backend.
7. **HTTPS only** in production; add HSTS at the proxy layer.

---

## 12. Notes on shared layout (`ui.js`)

All protected pages share one shell: `body[data-page][data-root]` → `ui.js` renders the sidebar (grouped nav with Lucide icons, collapse on desktop, drawer on mobile), the topbar (title, breadcrumb, notifications, profile menu, logout), toasts, modals and helpers. Relative paths work from both root (`data-root=""`) and `pages/` (`data-root="../"`), so the panel runs unchanged under any static host and sub-path.
