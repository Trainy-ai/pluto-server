// Python Panels — sandbox host page logic (plain ESM, no build step).
//
// Runs inside <iframe sandbox="allow-scripts"> (opaque origin). Protocol
// mirror of src/lib/panels/panel-bridge-protocol.ts — no imports from
// the app bundle here, so shapes are validated by hand. Flow:
//
//   1. read per-instance token from the URL fragment (#t=..., set by
//      PanelSandbox), post `ready` to the parent
//   2. wait for `init { token, code, requirements, sdk, context }`
//   3. mount stlite with the vendored pyodide + wheel URLs (everything
//      resolves against this host — CSP connect-src blocks the rest)
//   4. relay `mlop:rpc` worker messages → parent `rpc`, and parent
//      `rpc-result` → worker `mlop:res`
//   5. handle `context-update` (rewrite mlop_context.json), `rerun`
//      (rewrite code + clear script cache + synthetic "r" hotkey — the
//      spike-verified recipe; kernel.reboot() orphans the frontend),
//      and `dispose`
//
// UNSTABLE-API PIN: the worker relay uses app._kernel._worker, verified
// against @stlite/browser 1.8.1 exactly (see scripts/panel-asset-pins.json
// — the fetch script refuses other versions).

const PROTOCOL_VERSION = 1;
const appOrigin = new URL(document.location.href).origin;
const token = new URLSearchParams(document.location.hash.slice(1)).get("t");

// Fixed stlite entrypoint. The USER's script is mounted as
// panel_code.py and compiled/executed by this wrapper instead of being
// the entrypoint itself: a SyntaxError in the entrypoint kills stlite's
// script runner silently (blank app, no traceback — verified against
// stlite 1.8.1), while this wrapper renders it via st.exception exactly
// like runtime errors render. Uses streamlit's internal add_magic
// (pinned by the vendored wheel) so bare-expression "magic" keeps
// working, and PyCF_ALLOW_TOP_LEVEL_AWAIT so top-level `await mlop.*`
// still runs. Reruns rewrite panel_code.py; this wrapper re-reads it
// on every script run.
const PANEL_ENTRYPOINT = `import ast

import streamlit as st

_PANEL_PATH = "panel_code.py"

with open(_PANEL_PATH) as _f:
    _panel_src = _f.read()

_panel_code = None
try:
    try:
        from streamlit.runtime.scriptrunner.magic import add_magic as _add_magic

        _panel_ast = _add_magic(_panel_src, _PANEL_PATH)
    except SyntaxError:
        raise
    except Exception:
        _panel_ast = ast.parse(_panel_src, _PANEL_PATH, "exec")
    _panel_code = compile(
        _panel_ast,
        _PANEL_PATH,
        "exec",
        flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT,
        dont_inherit=True,
    )
except SyntaxError as _e:
    st.exception(_e)

if _panel_code is not None:
    _panel_globals = {"__name__": "__main__", "__file__": _PANEL_PATH}
    _panel_result = eval(_panel_code, _panel_globals)
    if _panel_result is not None:
        await _panel_result
`;

const postToParent = (msg) => window.parent.postMessage(msg, appOrigin);
const status = (phase, detail) =>
  token &&
  postToParent({
    mlop: PROTOCOL_VERSION,
    token,
    type: "status",
    phase,
    detail: detail === undefined ? undefined : String(detail),
  });

window.addEventListener("error", (e) => status("error", e.message));
window.addEventListener("unhandledrejection", (e) =>
  status("error", e.reason && e.reason.stack ? e.reason.stack : e.reason),
);

if (!token) {
  document.body.textContent = "panel-host: missing #t=<token> fragment";
  throw new Error("panel-host: missing token");
}

// Kick off the runtime load immediately so it overlaps the ready/init
// handshake.
status("loading-runtime", "importing stlite");
const stlitePromise = import("./stlite/stlite.js");

let app = null;
let worker = null;
let currentCode = null;
// Serializes virtual-FS writes (context updates, rerun code writes)
// behind kernel boot. Ops arriving before the kernel exists are
// buffered and flushed once boot() wires the queue.
let fsQueue = null;
const pendingFsOps = [];

async function boot(init) {
  const { mount } = await stlitePromise;

  // Requirements pass through verbatim: the vendored pyodide-lock.json
  // has the supported pure wheels (seaborn, plotly, streamlit's deps)
  // injected as packages, so micropip resolves names locally. Anything
  // not vendored fails fast — the CSP blocks PyPI by design.
  const requirements = init.requirements
    .map((r) => String(r).trim())
    .filter((r) => r.length > 0);

  status("installing", `mounting kernel (${requirements.length} wheels)`);
  currentCode = init.code;
  // The app's resolved theme crosses the bridge in init.context.theme.
  // theme.base is a regular Streamlit config option (StreamlitConfig is
  // an arbitrary option map — see vendored stlite.d.ts), applied at
  // KERNEL MOUNT only: stlite has no supported way to swap the config
  // theme on a live session, so the parent (PanelSandbox) remounts the
  // sandbox when the theme changes (rare; documented choice).
  const themeBase = init.context && init.context.theme === "dark" ? "dark" : "light";
  app = mount(
    {
      entrypoint: "streamlit_app.py",
      files: {
        "streamlit_app.py": PANEL_ENTRYPOINT,
        "panel_code.py": init.code,
        "mlop.py": init.sdk,
        "mlop_context.json": JSON.stringify(init.context),
      },
      requirements,
      pyodideUrl: new URL("./pyodide/pyodide.mjs", document.location.href).href,
      streamlitConfig: {
        "client.toolbarMode": "viewer",
        "theme.base": themeBase,
      },
    },
    document.getElementById("root"),
  );

  const kernel = app._kernel;
  worker = kernel && kernel._worker;
  if (!worker || typeof worker.addEventListener !== "function") {
    throw new Error(
      "stlite internals changed (expected app._kernel._worker) — re-verify the pinned version",
    );
  }

  // Panel Python → parent. stlite's worker message switch has no default
  // case, so our foreign "mlop:rpc" messages pass through it untouched.
  worker.addEventListener("message", (ev) => {
    const d = ev.data;
    if (d && d.type === "mlop:rpc") {
      postToParent({
        mlop: PROTOCOL_VERSION,
        token,
        type: "rpc",
        id: d.id,
        method: d.method,
        params: d.params,
      });
    }
  });

  fsQueue = kernel.loaded.then(() => status("done", "kernel loaded"));
  for (const pending of pendingFsOps.splice(0)) {
    queueFsOp(pending.op, pending.label);
  }
}

function queueFsOp(op, label) {
  if (!fsQueue) {
    pendingFsOps.push({ op, label });
    return;
  }
  fsQueue = fsQueue
    .then(op)
    .catch((e) => status("error", `${label} failed: ${e}`));
}

function handleRerun() {
  queueFsOp(
    () =>
      app
        .writeFile("panel_code.py", currentCode)
        .then(() =>
          app.runPython(
            "import streamlit.runtime as _sr\n_sr.get_instance()._script_cache.clear()\n",
          ),
        )
        .then(() => {
          // Streamlit's rerun hotkey — the only rerun path that keeps the
          // frontend attached (verified in the feasibility spike).
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", { key: "r", code: "KeyR", keyCode: 82, bubbles: true }),
          );
          // "done" = rerun delivered to the kernel. Script-level errors
          // (tracebacks) render inside the Streamlit app itself, exactly
          // like they do on boot — status never reports them.
          status("done", "rerun dispatched");
        }),
    "rerun",
  );
}

window.addEventListener("message", (ev) => {
  // Only the embedding app may talk to this page. The parent's document
  // origin is the same origin this page was served from.
  if (ev.origin !== appOrigin || ev.source !== window.parent) return;
  const d = ev.data;
  if (!d || d.mlop !== PROTOCOL_VERSION || typeof d.type !== "string") return;

  switch (d.type) {
    case "init": {
      if (app) return; // already booted — ignore duplicate init
      if (d.token !== token) return;
      boot(d).catch((e) => status("error", e && e.stack ? e.stack : e));
      break;
    }
    case "rpc-result": {
      if (!worker) return;
      worker.postMessage({
        type: "mlop:res",
        id: d.id,
        ok: d.ok === true,
        payload: JSON.stringify(d.ok === true ? (d.data ?? null) : d.error),
      });
      break;
    }
    case "context-update": {
      queueFsOp(
        () => app.writeFile("mlop_context.json", JSON.stringify(d.context)),
        "context-update",
      );
      break;
    }
    case "rerun": {
      if (typeof d.code === "string") currentCode = d.code;
      handleRerun();
      break;
    }
    case "dispose": {
      try {
        if (app) app.unmount();
      } catch {
        /* best effort — the parent removes the iframe anyway */
      }
      app = null;
      worker = null;
      break;
    }
  }
});

postToParent({ mlop: PROTOCOL_VERSION, token, type: "ready" });
