/* ============================================================================
 * SMMARIA Email Manager — auth.js
 * ----------------------------------------------------------------------------
 * Authentication against the SMMARIA Email Backend (POST /api/auth/login).
 *
 * Token storage model:
 *   - "Remember me" checked  → token in localStorage  (REMEMBER_DAYS horizon
 *     is enforced server-side; the frontend merely persists it).
 *   - "Remember me" unchecked→ token in sessionStorage (cleared when the tab
 *     closes).
 * The token NEVER touches a cookie and is only ever sent to the configured
 * backend origin via the Authorization header.
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG;
  var K = CFG.STORAGE;

  /* ------------------------------------------------------------------ */
  /* Low-level storage                                                   */
  /* ------------------------------------------------------------------ */

  function safeGet(store, key) {
    try { return store.getItem(key); } catch (e) { return null; }
  }
  function safeSet(store, key, value) {
    try { store.setItem(key, value); } catch (e) { /* private mode etc. */ }
  }
  function safeRemove(store, key) {
    try { store.removeItem(key); } catch (e) { /* ignore */ }
  }

  function readAdmin() {
    var raw = safeGet(localStorage, K.ADMIN);
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { /* fall through */ }
    }
    raw = safeGet(sessionStorage, K.ADMIN);
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { return null; }
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* SMMAuth                                                             */
  /* ------------------------------------------------------------------ */

  var SMMAuth = {

    /** Raw bearer token for api.js, or null. */
    getToken: function () {
      var t = safeGet(localStorage, K.TOKEN_LOCAL);
      if (t) return t;
      return safeGet(sessionStorage, K.TOKEN_SESSION);
    },

    /** Current admin object cached from the login response / GET /me. */
    getAdmin: function () {
      return readAdmin();
    },

    /** True when a token exists locally (presence check only). */
    hasSession: function () {
      return !!SMMAuth.getToken();
    },

    /**
     * Authenticate against the backend.
     * @returns {Promise<object>} The admin object from the backend.
     */
    login: function (email, password, remember) {
      return window.SMMApi.request(CFG.ENDPOINTS.auth.login, {
        method: 'POST',
        auth: false,
        body: { email: email, password: password }
      }).then(function (payload) {
        var token = payload && (payload.token || (payload.data && payload.data.token));
        if (!token) {
          throw window.SMMApi.ApiError('PARSE',
            'The backend login response did not include a session token. Check the backend /api/auth/login response shape (expected: { token, admin }).',
            200, payload);
        }
        var admin = (payload && (payload.admin || (payload.data && payload.data.admin))) || null;
        // Fall back to any user-ish object the backend returned.
        if (!admin && payload && typeof payload === 'object') {
          admin = payload.user || payload.administrator || null;
        }
        SMMAuth.storeSession(token, admin, remember);
        return admin;
      });
    },

    /** Persist token + admin to the chosen storage. */
    storeSession: function (token, admin, remember) {
      // Clear both stores first so switching modes never leaves stale copies.
      safeRemove(localStorage, K.TOKEN_LOCAL);
      safeRemove(sessionStorage, K.TOKEN_SESSION);
      safeRemove(localStorage, K.ADMIN);
      safeRemove(sessionStorage, K.ADMIN);
      safeRemove(localStorage, K.REMEMBER);

      if (remember) {
        safeSet(localStorage, K.TOKEN_LOCAL, token);
        if (admin) safeSet(localStorage, K.ADMIN, JSON.stringify(admin));
        safeSet(localStorage, K.REMEMBER, '1');
      } else {
        safeSet(sessionStorage, K.TOKEN_SESSION, token);
        if (admin) safeSet(sessionStorage, K.ADMIN, JSON.stringify(admin));
      }
    },

    /**
     * Validate the current token against the backend (GET /api/auth/me).
     * Resolves { admin } on success; rejects with ApiError otherwise.
     */
    validateSession: function () {
      if (!SMMAuth.getToken()) {
        return Promise.reject(window.SMMApi.ApiError('UNAUTHORIZED', 'No active session.', 0));
      }
      return window.SMMApi.request(CFG.ENDPOINTS.auth.me, { method: 'GET' })
        .then(function (payload) {
          var admin = (payload && (payload.admin || payload.user)) || payload || null;
          if (admin && typeof admin === 'object') {
            // Refresh cached profile, preserving the storage mode in use.
            var remembered = safeGet(localStorage, K.REMEMBER) === '1';
            SMMAuth.storeSession(SMMAuth.getToken(), admin, remembered);
          }
          return { admin: admin };
        });
    },

    /**
     * Log out. Always clears local state; the backend revoke call is
     * best-effort (a dead backend must never trap the user in a session).
     * @returns {Promise<void>}
     */
    logout: function () {
      var revoke = window.SMMApi.request(CFG.ENDPOINTS.auth.logout, { method: 'POST' })
        .catch(function () { /* best-effort */ });
      return revoke.then(function () {
        SMMAuth.clearSession();
      });
    },

    /** Wipe every local auth trace. */
    clearSession: function () {
      safeRemove(localStorage, K.TOKEN_LOCAL);
      safeRemove(localStorage, K.ADMIN);
      safeRemove(localStorage, K.REMEMBER);
      safeRemove(sessionStorage, K.TOKEN_SESSION);
      safeRemove(sessionStorage, K.ADMIN);
    },

    /**
     * Guard for protected pages. Redirects to login when no local session.
     * @param {boolean} [validateRemotely=false] also verify via GET /me.
     * @returns {boolean} true when the page may continue rendering.
     */
    requireAuth: function (validateRemotely) {
      if (!SMMAuth.hasSession()) {
        SMMAuth.redirectToLogin('Please sign in to continue.');
        return false;
      }
      if (validateRemotely) {
        SMMAuth.validateSession().catch(function (err) {
          if (err && (err.kind === 'UNAUTHORIZED' || err.kind === 'CONFIG')) {
            SMMAuth.handle401();
          }
          // NETWORK/TIMEOUT: keep the page usable; individual requests will
          // surface their own errors. A dead backend ≠ expired session.
        });
      }
      return true;
    },

    /**
     * Called by api.js on any 401. Clears the session and redirects.
     */
    handle401: function () {
      SMMAuth.clearSession();
      SMMAuth.redirectToLogin('Your session has expired. Please sign in again.');
    },

    redirectToLogin: function (reason) {
      try {
        if (reason) sessionStorage.setItem('smm_login_notice', reason);
      } catch (e) { /* ignore */ }
      var root = document.body && document.body.dataset && document.body.dataset.root ? document.body.dataset.root : '';
      window.location.replace(root + 'login.html');
    },

    /** Consume a pending login notice (used by login page). */
    popNotice: function () {
      try {
        var n = sessionStorage.getItem('smm_login_notice');
        if (n) sessionStorage.removeItem('smm_login_notice');
        return n;
      } catch (e) { return null; }
    }
  };

  window.SMMAuth = SMMAuth;
})();
