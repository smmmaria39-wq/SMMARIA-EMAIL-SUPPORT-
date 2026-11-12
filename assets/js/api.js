/* ============================================================================
 * SMMARIA Email Manager — api.js
 * ----------------------------------------------------------------------------
 * Centralized API client. EVERY backend request in the app goes through
 * SMMApi — no other file is allowed to call fetch() against the backend.
 *
 * Responsibilities:
 *   - URL building from EMAIL_SYSTEM_CONFIG.API_BASE_URL + ENDPOINTS
 *   - Authorization header (Bearer token from SMMAuth storage)
 *   - JSON + multipart bodies, query strings
 *   - Request timeout (AbortController)
 *   - Consistent response envelope parsing
 *   - Typed error kinds: NETWORK / TIMEOUT / UNAUTHORIZED / FORBIDDEN /
 *     NOT_FOUND / VALIDATION / SERVER / PARSE / CONFIG
 *   - 401 handling delegated to SMMAuth.handle401()
 *   - 404 on an /api/admin/... path is reported as a MISSING ENDPOINT,
 *     never silently swallowed and never replaced with mock data.
 * ========================================================================== */

(function () {
  'use strict';

  var CFG = window.EMAIL_SYSTEM_CONFIG;

  /* ------------------------------------------------------------------ */
  /* ApiError                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * @param {string} kind     One of the error kinds above.
   * @param {string} message  Human-readable message (safe to show in UI).
   * @param {number=} status  HTTP status code when available.
   * @param {*=} detail       Raw server payload for debugging panels.
   */
  function ApiError(kind, message, status, detail) {
    var err = new Error(message);
    err.name = 'ApiError';
    err.kind = kind;
    err.status = status || 0;
    err.detail = detail === undefined ? null : detail;
    return err;
  }

  /* ------------------------------------------------------------------ */
  /* URL building                                                        */
  /* ------------------------------------------------------------------ */

  function baseURL() {
    var base = String(CFG.API_BASE_URL || '').trim().replace(/\/+$/, '');
    return base;
  }

  function isConfigured() {
    var base = baseURL();
    return !!base && base.indexOf('YOUR-EMAIL-BACKEND-URL') === -1;
  }

  /**
   * Build a full URL. `path` may contain ":id" placeholders when repl is
   * provided, e.g. build(ENDPOINTS.campaigns.get, { id: 12 }).
   * @param {string} path  Endpoint path beginning with "/".
   * @param {Object=} repl Optional {param: value} replacements for ":param".
   * @param {Object=} query Optional query params (undefined/null skipped).
   */
  function build(path, repl, query) {
    var url = baseURL() + path;
    if (repl) {
      Object.keys(repl).forEach(function (key) {
        url = url.replace(':' + key, encodeURIComponent(String(repl[key])));
      });
    }
    if (query) {
      var qs = Object.keys(query)
        .filter(function (k) {
          return query[k] !== undefined && query[k] !== null && query[k] !== '';
        })
        .map(function (k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]);
        })
        .join('&');
      if (qs) url += (url.indexOf('?') === -1 ? '?' : '&') + qs;
    }
    return url;
  }

  /* ------------------------------------------------------------------ */
  /* Core request                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Perform an API request.
   *
   * @param {string} path   Endpoint path from CFG.ENDPOINTS.
   * @param {Object=} opts
   *   method    : 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'  (default GET)
   *   body      : object sent as JSON (ignored when formData set)
   *   formData  : FormData instance (multipart)
   *   query     : query params object
   *   repl      : ":param" replacements
   *   timeout   : override CFG.REQUEST_TIMEOUT
   *   auth      : attach Authorization header (default true)
   *   raw       : return the raw Response instead of parsed JSON
   * @returns {Promise<any>} Parsed payload (envelope-unwrapped) or Response.
   */
  function request(path, opts) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();
    var timeout = opts.timeout || CFG.REQUEST_TIMEOUT;
    var withAuth = opts.auth !== false;

    if (!isConfigured()) {
      return Promise.reject(ApiError(
        'CONFIG',
        'Backend URL is not configured. Open assets/js/config.js and set API_BASE_URL to your SMMARIA Email Backend URL.',
        0,
        { baseUrl: CFG.API_BASE_URL }
      ));
    }

    var headers = { 'Accept': 'application/json' };
    if (withAuth) {
      var token = getToken();
      if (token) headers['Authorization'] = 'Bearer ' + token;
    }

    var body;
    if (opts.formData) {
      body = opts.formData; // browser sets multipart boundary automatically
    } else if (opts.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
      try {
        body = JSON.stringify(opts.body);
      } catch (e) {
        return Promise.reject(ApiError('VALIDATION', 'Request payload could not be serialized to JSON.', 0));
      }
    }

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timedOut = false;
    var timer = null;
    if (ctrl) {
      timer = setTimeout(function () {
        timedOut = true;
        ctrl.abort();
      }, timeout);
    }

    var fetchOpts = { method: method, headers: headers, body: body };
    if (ctrl) fetchOpts.signal = ctrl.signal;

    return fetch(build(path, opts.repl, opts.query), fetchOpts)
      .then(function (res) { return handleResponse(res, path, opts); })
      .catch(function (err) {
        if (timedOut || (err && err.name === 'AbortError')) {
          return Promise.reject(ApiError('TIMEOUT',
            'The email backend took too long to respond (' + Math.round(timeout / 1000) + ' s limit). It may be offline or overloaded.', 0));
        }
        if (err && err.kind) return Promise.reject(err); // already an ApiError
        return Promise.reject(ApiError('NETWORK',
          'Could not reach the email backend. Check your internet connection and the API_BASE_URL in assets/js/config.js.', 0, String(err)));
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  /* ------------------------------------------------------------------ */
  /* Response handling                                                   */
  /* ------------------------------------------------------------------ */

  function handleResponse(res, path, opts) {
    // 204 No Content
    if (res.status === 204) return Promise.resolve(null);

    var unauthorized = res.status === 401;
    var parse = res.json().catch(function () { return null; });

    return parse.then(function (payload) {
      if (unauthorized) {
        var msg401 = extractMessage(payload) || 'Your session has expired. Please sign in again.';
        if (window.SMMAuth && typeof window.SMMAuth.handle401 === 'function' && !window.SMM_IS_LOGIN_PAGE) {
          window.SMMAuth.handle401();
        }
        throw ApiError('UNAUTHORIZED', msg401, 401, payload);
      }

      if (res.status === 403) {
        throw ApiError('FORBIDDEN', extractMessage(payload) ||
          'Your administrator account is not allowed to perform this action. The backend rejected the request.', 403, payload);
      }

      if (res.status === 404) {
        throw ApiError('NOT_FOUND',
          'Endpoint not found on the email backend (' + res.status + '): ' + path +
          '. This feature requires an endpoint the backend does not expose yet. See README.md → "Missing backend endpoints".',
          404, { path: path, payload: payload });
      }

      if (res.status === 422 || res.status === 400) {
        throw ApiError('VALIDATION', extractMessage(payload) ||
          'The backend rejected the request as invalid. Check the form values and try again.', res.status, payload);
      }

      if (res.status === 429) {
        throw ApiError('SERVER', 'Too many requests — the backend is rate-limiting this action. Wait a moment and retry.', 429, payload);
      }

      if (res.status >= 500) {
        throw ApiError('SERVER', extractMessage(payload) ||
          'The email backend reported an internal error (' + res.status + '). Please try again later.', res.status, payload);
      }

      if (!res.ok) {
        throw ApiError('SERVER', extractMessage(payload) || 'Unexpected backend response (HTTP ' + res.status + ').', res.status, payload);
      }

      if (opts.raw) return res;

      /* Envelope unwrapping:
         The backend may answer { success:true, data: ... } or the raw value.
         api.js normalizes both to the inner value. */
      if (payload && typeof payload === 'object' &&
          Object.prototype.hasOwnProperty.call(payload, 'data') &&
          (payload.success === true || payload.status === 'success' || payload.ok === true) &&
          Object.keys(payload).length <= 4) {
        return payload.data;
      }
      return payload;
    });
  }

  /** Pull a readable message out of common error payload shapes. */
  function extractMessage(payload) {
    if (!payload) return '';
    if (typeof payload === 'string') return payload;
    if (typeof payload.message === 'string' && payload.message) return payload.message;
    if (typeof payload.error === 'string' && payload.error) return payload.error;
    if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
    if (typeof payload.msg === 'string' && payload.msg) return payload.msg;
    return '';
  }

  /* ------------------------------------------------------------------ */
  /* Token access (delegates to SMMAuth when present)                    */
  /* ------------------------------------------------------------------ */

  function getToken() {
    if (window.SMMAuth && typeof window.SMMAuth.getToken === 'function') {
      return window.SMMAuth.getToken();
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Public helpers                                                      */
  /* ------------------------------------------------------------------ */

  function get(path, query, opts) {
    return request(path, Object.assign({}, opts || {}, { method: 'GET', query: query, repl: (opts && opts.repl) }));
  }
  function post(path, body, opts) {
    return request(path, Object.assign({}, opts || {}, { method: 'POST', body: body }));
  }
  function put(path, body, opts) {
    return request(path, Object.assign({}, opts || {}, { method: 'PUT', body: body }));
  }
  function patch(path, body, opts) {
    return request(path, Object.assign({}, opts || {}, { method: 'PATCH', body: body }));
  }
  function del(path, opts) {
    return request(path, Object.assign({}, opts || {}, { method: 'DELETE' }));
  }
  function upload(path, formData, opts) {
    return request(path, Object.assign({}, opts || {}, { method: 'POST', formData: formData }));
  }

  /**
   * Download a binary endpoint (e.g. invoice PDF, subscriber export) with
   * the Authorization header, then hand the blob to the browser.
   * @returns {Promise<Blob>}
   */
  function download(path, repl, filename, fallbackMime) {
    return request(path, { method: 'GET', repl: repl, raw: true }).then(function (res) {
      var ct = (res.headers && res.headers.get('content-type')) || fallbackMime || 'application/octet-stream';
      if (ct.indexOf('application/json') !== -1) {
        // Backend answered JSON instead of a file → likely an error payload.
        return res.json().then(function (payload) {
          throw ApiError('SERVER', extractMessage(payload) || 'The backend returned JSON instead of a file for ' + path, res.status, payload);
        });
      }
      return res.blob().then(function (blob) {
        triggerDownload(blob, filename, ct);
        return blob;
      });
    });
  }

  function triggerDownload(blob, filename, mime) {
    var url = URL.createObjectURL(new Blob([blob], { type: mime }));
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* Expose */
  window.SMMApi = {
    ApiError: ApiError,
    request: request,
    build: build,
    isConfigured: isConfigured,
    baseURL: baseURL,
    get: get,
    post: post,
    put: put,
    patch: patch,
    del: del,
    upload: upload,
    download: download,
    extractMessage: extractMessage
  };
})();
