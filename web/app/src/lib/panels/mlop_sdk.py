# mlop — Python Panels SDK.
#
# Mounted into the stlite (Pyodide) kernel as `mlop.py` by the sandbox
# host page (public/stlite/panel-host.js); the source travels over the
# `init` bridge message (bundled into the app via Vite `?raw`).
#
# The sandboxed iframe has no network access: every data call marshals a
# JSON request over postMessage to the parent app, which executes ONLY
# the allowlisted read-only tRPC queries with the viewer's own session
# (src/lib/panels/panel-bridge-allowlist.ts) and posts the result back.
#
# All data methods are async — call them with `await` (stlite supports
# top-level await in panel scripts):
#
#     import streamlit as st
#     import mlop
#
#     ctx = mlop.get_context()
#     df = await mlop.get_metrics(metrics=["train/loss"])
#     st.line_chart(df.pivot(index="step", columns="run_name", values="value"))

import asyncio
import json

import js
from pyodide.ffi import create_proxy

_TIMEOUT_SECONDS = 60
_CONTEXT_FILE = "mlop_context.json"

_pending = {}
_counter = 0


class MlopError(Exception):
    """Bridge request failure.

    `code` is one of: FORBIDDEN_METHOD, BAD_PARAMS, UPSTREAM, TIMEOUT.
    """

    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__(f"[{code}] {message}")


# ─── postMessage plumbing ────────────────────────────────────────────


def _on_message(event):
    try:
        data = event.data
        if getattr(data, "type", None) != "mlop:res":
            return
        future = _pending.pop(data.id, None)
        if future is None or future.done():
            return
        payload = json.loads(data.payload)
        if getattr(data, "ok", False):
            future.set_result(payload)
        else:
            payload = payload if isinstance(payload, dict) else {}
            future.set_exception(
                MlopError(
                    payload.get("code", "UPSTREAM"),
                    payload.get("message", "bridge request failed"),
                )
            )
    except Exception as exc:  # never break the worker's message loop
        js.console.error("mlop bridge listener error: " + repr(exc))


js.self.addEventListener("message", create_proxy(_on_message))


async def _request(method, params):
    global _counter
    _counter += 1
    request_id = "mlop-%d" % _counter
    future = asyncio.get_event_loop().create_future()
    _pending[request_id] = future
    # JSON string across the pyodide FFI (fast path — no proxy graphs).
    js.self.postMessage(
        js.JSON.parse(
            json.dumps(
                {
                    "type": "mlop:rpc",
                    "id": request_id,
                    "method": method,
                    "params": params or {},
                }
            )
        )
    )
    try:
        return await asyncio.wait_for(future, _TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        _pending.pop(request_id, None)
        raise MlopError(
            "TIMEOUT",
            "mlop.%s timed out after %ds waiting for the host app"
            % (method, _TIMEOUT_SECONDS),
        ) from None


# ─── Context (sync — delivered by the host, no bridge round-trip) ────


class Run:
    def __init__(self, raw):
        self.id = raw["id"]
        self.name = raw["name"]
        self.color = raw["color"]

    def __repr__(self):
        return f"Run(id={self.id!r}, name={self.name!r}, color={self.color!r})"


class PanelSize:
    def __init__(self, raw):
        self.width = raw["width"]
        self.height = raw["height"]


class Context:
    """Host snapshot: selected runs (+colors), project/org, theme, panel size."""

    def __init__(self, raw):
        self.runs = [Run(r) for r in raw["runs"]]
        self.project = raw["projectName"]
        self.org = raw["orgSlug"]
        self.organization_id = raw["organizationId"]
        self.theme = raw["theme"]
        self.panel = PanelSize(raw["panel"])


def get_context():
    """Current host context. Re-read on every call so `context-update`
    messages (run selection / theme / panel size changes) are visible."""
    with open(_CONTEXT_FILE) as f:
        return Context(json.load(f))


def colors():
    """{run_id: "#hex"} for the currently selected runs (matplotlib-friendly)."""
    return {run.id: run.color for run in get_context().runs}


# ─── Data API (async, host-mediated) ─────────────────────────────────


async def get_runs(limit=None):
    """List the project's runs (list of dicts, timestamps as ISO strings)."""
    params = {}
    if limit is not None:
        params["limit"] = limit
    return await _request("getRuns", params)


async def get_metric_names(search=None):
    """List distinct metric names, optionally fuzzy-filtered by `search`."""
    params = {}
    if search is not None:
        params["search"] = search
    result = await _request("getMetricNames", params)
    return result["metricNames"]


async def get_file_log_names(search=None):
    """List distinct file-type log names as [{"logName", "logType"}, ...]."""
    params = {}
    if search is not None:
        params["search"] = search
    result = await _request("getFileLogNames", params)
    return result["files"]


async def get_metrics(metrics, runs=None, buckets=None):
    """Bucketed metric series as a long-form pandas DataFrame with columns
    run_id, run_name, metric, step, value.

    `runs` defaults to the runs selected in the host UI. The host returns
    columnar series ({metric: {run_id: {steps, values, ...}}}); this SDK
    performs the long-form transform locally (documented choice: the
    columnar wire format stays compact, pandas assembly is cheap in-kernel).
    Bucket-averaged NaN/Inf buckets arrive as None → NaN in the frame.
    """
    import pandas as pd

    params = {"metrics": list(metrics)}
    if runs is not None:
        params["runIds"] = list(runs)
    if buckets is not None:
        params["buckets"] = buckets
    result = await _request("getMetrics", params)

    run_names = {run.id: run.name for run in get_context().runs}
    rows = []
    for metric, by_run in result.items():
        if metric == "__json_safe" or not isinstance(by_run, dict):
            continue
        for run_id, series in by_run.items():
            name = run_names.get(run_id, run_id)
            steps = series.get("steps") or []
            values = series.get("values") or []
            for step, value in zip(steps, values):
                rows.append((run_id, name, metric, step, value))
    return pd.DataFrame(
        rows, columns=["run_id", "run_name", "metric", "step", "value"]
    )


async def get_metric_summaries(metrics, aggregation="LAST", runs=None):
    """Aggregated per-run values: {run_id: {metric: value}}.

    `aggregation` ∈ LAST | AVG | MIN | MAX | VARIANCE.
    `runs` defaults to the runs selected in the host UI.
    """
    params = {"metrics": list(metrics), "aggregation": aggregation}
    if runs is not None:
        params["runIds"] = list(runs)
    result = await _request("getMetricSummaries", params)
    return result["summaries"]


async def get_metric_values(run_id):
    """Latest value of every metric for one run (list of dicts)."""
    return await _request("getMetricValues", {"runId": run_id})


async def get_logs(run_id, log_type=None):
    """Console/debug logs for one run as
    [{"message", "logType", "time", "lineNumber"}, ...]."""
    params = {"runId": run_id}
    if log_type is not None:
        params["logType"] = log_type
    return await _request("getLogs", params)


async def get_file_url(run_id, log_name, file_name):
    """Presigned URL (string) for one logged file."""
    result = await _request(
        "getFileUrl",
        {"runId": run_id, "logName": log_name, "fileName": file_name},
    )
    return result["url"]
