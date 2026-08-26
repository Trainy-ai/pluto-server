/**
 * The HTML for the authenticated Swagger UI at /api/docs.
 *
 * Split out of routes/docs.ts so the route handlers (session gate, key
 * minting, spec serving) stay readable next to each other, and the page —
 * which is mostly a client-side bootstrap script embedded in a template
 * literal — lives on its own. Behaviour is pinned by tests/docs-page.test.ts.
 */
import { SwaggerUI } from "@hono/swagger-ui";

import { env } from "../lib/env";

/** The two specs the page can drive. Both are read same-origin. */
const REST_SPEC_URL = "/api/openapi.json";
const TRPC_SPEC_URL = "/api/docs/openapi-trpc.json";

/**
 * Client bootstrap. Kept free of template literals so it survives being
 * embedded in one, and free of server-injected values so nothing user-supplied
 * is ever interpolated into the page.
 */
const BOOTSTRAP_SCRIPT = String.raw`
(function () {
  var SPECS = {
    rest: { url: "__REST_SPEC_URL__", label: "REST API (API key)" },
    trpc: { url: "__TRPC_SPEC_URL__", label: "tRPC (session)" },
  };
  var DOCS_HEADERS = { "Content-Type": "application/json", "x-mlop-docs": "1" };
  var state = {
    key: null, orgs: [], orgId: null, expiresAt: null, spec: "rest", identity: null,
  };
  var ui = null;

  function byId(id) { return document.getElementById(id); }

  function setStatus(text, kind) {
    var node = byId("mlop-status");
    node.textContent = text;
    node.className = "mlop-status " + (kind || "");
  }

  function post(path, body) {
    return fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: DOCS_HEADERS,
      body: JSON.stringify(body || {}),
    });
  }

  // Hand the key to Swagger UI the same way the Authorize dialog does, so the
  // lock icons flip and the generated curl carries the header. Older builds
  // only expose preauthorizeApiKey, hence the fallback.
  function authorize(key) {
    if (!ui) { return; }
    var schema = { type: "http", scheme: "bearer", bearerFormat: "API Key" };
    try {
      ui.authActions.authorize({
        bearerAuth: { name: "bearerAuth", schema: schema, value: key },
      });
      return;
    } catch (err) { /* fall through */ }
    try {
      ui.preauthorizeApiKey("bearerAuth", key);
    } catch (err) { /* the request interceptor still carries the header */ }
  }

  function deauthorize() {
    if (!ui) { return; }
    try { ui.authActions.logout(["bearerAuth"]); } catch (err) { /* noop */ }
  }

  function renderKey() {
    var box = byId("mlop-key");
    if (!state.key) {
      box.textContent = "not authorized";
      return;
    }
    var expires = state.expiresAt ? new Date(state.expiresAt) : null;
    box.textContent =
      state.key.slice(0, 9) + "…" + state.key.slice(-4) +
      (expires ? "  · expires " + expires.toLocaleTimeString() : "");
  }

  function mint() {
    setStatus("Requesting a temporary key…", "");
    return post("/api/docs/key", { organizationId: state.orgId })
      .then(function (res) {
        return res.json().then(function (body) { return { res: res, body: body }; });
      })
      .then(function (out) {
        if (!out.res.ok) {
          state.key = null;
          renderKey();
          setStatus(out.body.message || out.body.error || "Could not mint a key", "error");
          return;
        }
        state.key = out.body.apiKey;
        state.expiresAt = out.body.expiresAt;
        state.orgId = out.body.organization.id;
        authorize(state.key);
        renderKey();
        state.identity = {
          email: out.body.user.email,
          org: out.body.organization.slug,
        };
        renderStatus();
      })
      .catch(function () {
        setStatus("Could not reach /api/docs/key", "error");
      });
  }

  function revoke() {
    return post("/api/docs/key/revoke", { organizationId: state.orgId })
      .then(function () {
        state.key = null;
        state.expiresAt = null;
        deauthorize();
        renderKey();
        setStatus("Temporary key revoked. Reload the page to get a new one.", "");
      });
  }

  function copyKey() {
    if (!state.key || !navigator.clipboard) { return; }
    navigator.clipboard.writeText(state.key).then(function () {
      setStatus("Key copied to clipboard.", "ok");
    });
  }

  function specNote() {
    if (state.spec === "trpc") {
      return " — Try it out uses your signed-in session; to replay the curl in " +
        "a terminal add your session cookie.";
    }
    return ui
      ? " — Try it out now sends this key, and the curl it prints works as-is."
      : " — Swagger UI assets are unavailable; copy the key and use it as a bearer token.";
  }

  // One status line, rebuilt from state, so switching surfaces never leaves a
  // message describing the other one behind.
  function renderStatus() {
    if (!state.identity) { return; }
    setStatus(
      "Authorized as " + state.identity.email + " on " + state.identity.org + specNote(),
      "ok"
    );
  }

  function selectSpec(which) {
    state.spec = which;
    var buttons = document.querySelectorAll("[data-spec]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].className = buttons[i].getAttribute("data-spec") === which ? "mlop-active" : "";
    }
    if (!ui) { return; }
    ui.specActions.updateUrl(SPECS[which].url);
    ui.specActions.download(SPECS[which].url);
    if (state.key) { authorize(state.key); }
    renderStatus();
  }

  function renderOrgs() {
    var select = byId("mlop-org");
    if (state.orgs.length < 2) {
      select.style.display = "none";
      return;
    }
    select.innerHTML = "";
    state.orgs.forEach(function (org) {
      var option = document.createElement("option");
      option.value = org.id;
      option.textContent = org.slug;
      if (org.id === state.orgId) { option.selected = true; }
      select.appendChild(option);
    });
    select.addEventListener("change", function () {
      state.orgId = select.value;
      mint();
    });
  }

  function startSwaggerUI() {
    if (typeof SwaggerUIBundle === "undefined") {
      // The Swagger assets are served from a CDN. On an air-gapped or
      // egress-filtered network they simply will not arrive — say so, and
      // carry on: the temporary key below still works with curl.
      return null;
    }
    return SwaggerUIBundle({
      dom_id: "#swagger-ui",
      url: SPECS.rest.url,
      deepLinking: true,
      tryItOutEnabled: true,
      displayRequestDuration: true,
      // persistAuthorization stays off on purpose: the key is short-lived and
      // stays in page memory rather than in browser storage.
      persistAuthorization: false,
      presets: [SwaggerUIBundle.presets.apis],
      // Send cookies, so "Try it out" on a /trpc/* operation carries the
      // better-auth session — the only credential that surface accepts.
      withCredentials: true,
      requestInterceptor: function (req) {
        // The bearer key belongs to the REST surface only. tRPC rejects it,
        // and attaching it there would print a curl that cannot work.
        var isTrpc = (req.url || "").indexOf("/trpc/") !== -1;
        if (!isTrpc && state.key && req.headers && !req.headers.Authorization) {
          req.headers.Authorization = "Bearer " + state.key;
        }
        return req;
      },
    });
  }

  function boot() {
    ui = startSwaggerUI();
    window.ui = ui;
    if (!ui) {
      byId("swagger-ui").innerHTML =
        "<p style=\"padding:16px;font-family:sans-serif\">Swagger UI could not be " +
        "loaded from the CDN. The temporary key above still works — copy it and " +
        "call the API directly, or read the spec at " +
        "<a href=\"/api/openapi.json\">/api/openapi.json</a>.</p>";
    }

    var specButtons = document.querySelectorAll("[data-spec]");
    for (var i = 0; i < specButtons.length; i++) {
      specButtons[i].addEventListener("click", function (event) {
        selectSpec(event.currentTarget.getAttribute("data-spec"));
      });
    }

    byId("mlop-refresh").addEventListener("click", mint);
    byId("mlop-revoke").addEventListener("click", revoke);
    byId("mlop-copy").addEventListener("click", copyKey);

    fetch("/api/docs/session", { credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (session) {
        if (!session) {
          setStatus("Your session expired. Sign in again and reload.", "error");
          return;
        }
        state.orgs = session.organizations || [];
        state.orgId = session.activeOrganizationId ||
          (state.orgs[0] ? state.orgs[0].id : null);
        renderOrgs();
        if (!session.tempKeysEnabled) {
          setStatus(
            "Temporary keys are disabled here — use Authorize and paste an API key.",
            ""
          );
          return;
        }
        mint();
      });
  }

  window.addEventListener("load", boot);
})();
`;

const BANNER_STYLES = `
  body { margin: 0; }
  .mlop-bar {
    font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    padding: 10px 16px; background: #1b1b1f; color: #f4f4f5;
  }
  .mlop-bar strong { font-weight: 600; }
  .mlop-bar button, .mlop-bar select {
    font: inherit; padding: 4px 10px; border-radius: 6px;
    border: 1px solid #3f3f46; background: #27272a; color: #f4f4f5; cursor: pointer;
  }
  .mlop-bar button:hover { background: #3f3f46; }
  .mlop-specs { display: inline-flex; gap: 4px; }
  .mlop-bar button.mlop-active { background: #2563eb; border-color: #2563eb; }
  .mlop-key {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #27272a; padding: 4px 8px; border-radius: 6px;
  }
  .mlop-status { flex: 1 1 100%; color: #a1a1aa; }
  .mlop-status.ok { color: #86efac; }
  .mlop-status.error { color: #fca5a5; }
  .mlop-signin {
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 34rem; margin: 12vh auto; padding: 0 24px; color: #18181b;
  }
  .mlop-signin a { color: #2563eb; }
  .mlop-signin code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #f4f4f5; padding: 2px 5px; border-radius: 4px;
  }
`;

export function renderDocsPage(): string {
  const body = SwaggerUI({
    // Ignored — manuallySwaggerUIHtml takes over the rendering — but the
    // helper's types require one of url/urls.
    url: REST_SPEC_URL,
    manuallySwaggerUIHtml: (asset) => `
      <div class="mlop-bar">
        <strong>mlop API</strong>
        <span class="mlop-specs">
          <button type="button" data-spec="rest" class="mlop-active">REST (API key)</button>
          <button type="button" data-spec="trpc">tRPC (session)</button>
        </span>
        <span>temporary key:</span>
        <span class="mlop-key" id="mlop-key">not authorized</span>
        <button type="button" id="mlop-copy">Copy key</button>
        <button type="button" id="mlop-refresh">New key</button>
        <button type="button" id="mlop-revoke">Revoke</button>
        <select id="mlop-org" aria-label="Organization"></select>
        <span class="mlop-status" id="mlop-status">Loading…</span>
      </div>
      <div id="swagger-ui"></div>
      ${asset.css.map((url) => `<link rel="stylesheet" href="${url}" />`).join("")}
      ${asset.js
        .map((url) => `<script src="${url}" crossorigin="anonymous"></script>`)
        .join("")}
      <script>${BOOTSTRAP_SCRIPT.replace("__REST_SPEC_URL__", REST_SPEC_URL).replace("__TRPC_SPEC_URL__", TRPC_SPEC_URL)}</script>
    `,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>mlop API docs</title>
    <style>${BANNER_STYLES}</style>
  </head>
  <body>${body}</body>
</html>`;
}

export function renderSignInPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Sign in &middot; mlop API docs</title>
    <style>${BANNER_STYLES}</style>
  </head>
  <body>
    <div class="mlop-signin">
      <h1>Sign in to view the API docs</h1>
      <p>
        The interactive docs mint a temporary API key from your own account, so
        they are only available to a signed-in user.
      </p>
      <p>
        <a href="${env.BETTER_AUTH_URL}/auth/sign-in">Sign in to mlop</a>, then
        reload <code>${env.PUBLIC_URL}/api/docs</code>.
      </p>
      <p>
        The raw specification is available without signing in at
        <code>${env.PUBLIC_URL}/api/openapi.json</code>.
      </p>
    </div>
  </body>
</html>`;
}
