/**
 * Seed a long-running RUNNING run with backfilled history + live-tick emits.
 *
 * Purpose: exercise auto-refresh (RUNNING-status 30s TTL) and the
 * virtualized-chart scroll-back-into-view refresh against a distributions
 * widget whose bars rollup reads from `training/dataset/{bars}`.
 *
 * The run is created with timestamps from N hours ago up to now and then
 * left in RUNNING. After backfill the script enters a tick loop, emitting
 * one new point per metric every TICK_INTERVAL_S seconds for
 * LIVE_DURATION_MIN minutes (Ctrl-C to stop earlier).
 *
 * Metrics seeded per step:
 *   training/dataset/<suffix>   (12 siblings → {bars} eligible)
 *   normal/<suffix>             (8 siblings  → {bars} eligible)
 *   train/loss, train/accuracy, val/loss, val/accuracy, lr
 *
 * Run from host (default project = `test2`):
 *   API_KEY=mlpi_... npx tsx web/server/scripts/seed-running-bars.ts
 *
 * Useful env overrides:
 *   PROJECT_NAME=test2          target project (must exist)
 *   RUN_NAME=running-bars-demo  run name (created if missing)
 *   SERVER_URL=...              backend base URL (default localhost:3001)
 *   INGEST_URL=...              ingest base URL (default localhost:3003)
 *   BACKFILL_HOURS=5            how many hours of past data to seed
 *   STEP_INTERVAL_S=10          spacing between historical points
 *   TICK_INTERVAL_S=12          live-emit cadence after backfill
 *   LIVE_DURATION_MIN=60        total live-emit window
 */

const PROJECT_NAME = process.env.PROJECT_NAME || "test2";
const RUN_NAME = process.env.RUN_NAME || "running-bars-demo";
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3001";
const INGEST_URL = process.env.INGEST_URL || "http://localhost:3003";
const API_KEY = process.env.API_KEY;
const BACKFILL_HOURS = Number(process.env.BACKFILL_HOURS || 5);
const STEP_INTERVAL_S = Number(process.env.STEP_INTERVAL_S || 10);
const TICK_INTERVAL_S = Number(process.env.TICK_INTERVAL_S || 12);
const LIVE_DURATION_MIN = Number(process.env.LIVE_DURATION_MIN || 60);

if (!API_KEY) {
  console.error("API_KEY env var is required (e.g. mlpi_...)");
  process.exit(1);
}

const DATASET_SUFFIXES = [
  "cifar10",
  "cifar100",
  "imagenet",
  "mnist",
  "fashion_mnist",
  "coco",
  "voc",
  "ade20k",
  "kitti",
  "svhn",
  "cityscapes",
  "places365",
];

// `normal/*` siblings — second {bars}-eligible prefix. Each suffix is a
// gaussian-ish series with its own mean+stdev so the categorical view
// shows a meaningful distribution across siblings.
const NORMAL_SUFFIXES = [
  "sample_a",
  "sample_b",
  "sample_c",
  "sample_d",
  "sample_e",
  "sample_f",
  "sample_g",
  "sample_h",
];

const LINE_METRICS = [
  "train/loss",
  "train/accuracy",
  "val/loss",
  "val/accuracy",
  "lr",
];

const ALL_METRICS = [
  ...DATASET_SUFFIXES.map((s) => `training/dataset/${s}`),
  ...NORMAL_SUFFIXES.map((s) => `normal/${s}`),
  ...LINE_METRICS,
];

// Box-Muller for one gaussian draw with given mean+stdev.
function gaussian(mean: number, stdev: number): number {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdev * z;
}

function metricsAtStep(step: number, totalSteps: number): Record<string, number> {
  const p = totalSteps > 0 ? step / totalSteps : 0;
  const out: Record<string, number> = {};

  // Line metrics — decay-to-floor + noise so the live ticks visibly move.
  out["train/loss"] = 2.5 * Math.exp(-3 * p) + 0.15 + Math.random() * 0.04;
  out["train/accuracy"] =
    0.5 + 0.45 * (1 - Math.exp(-4 * p)) + Math.random() * 0.02;
  out["val/loss"] = 2.6 * Math.exp(-2.5 * p) + 0.2 + Math.random() * 0.05;
  out["val/accuracy"] =
    0.45 + 0.4 * (1 - Math.exp(-3.5 * p)) + Math.random() * 0.025;
  out["lr"] = 1e-4 * 0.5 * (1 + Math.cos(p * Math.PI));

  // Categorical bars — one value per dataset; values drift independently so
  // the bars heatmap/ridgeline have meaningful variation over time.
  for (let i = 0; i < DATASET_SUFFIXES.length; i++) {
    const s = DATASET_SUFFIXES[i];
    const base = 0.3 + 0.2 * Math.sin(i * 0.7 + p * Math.PI * 2);
    const trend = 0.4 * (1 - Math.exp(-2 * p));
    const noise = (Math.random() - 0.5) * 0.08;
    out[`training/dataset/${s}`] = Math.max(0, base + trend + noise);
  }

  // normal/* siblings — each is a gaussian sample with its own mean+stdev
  // drifting slowly over training progress. The bars rollup for this
  // prefix shows the across-sample distribution at each step.
  for (let i = 0; i < NORMAL_SUFFIXES.length; i++) {
    const s = NORMAL_SUFFIXES[i];
    const mean = -1.5 + (i / (NORMAL_SUFFIXES.length - 1)) * 3 + 0.4 * Math.sin(p * Math.PI);
    const stdev = 0.4 + 0.15 * Math.cos(i * 1.1);
    out[`normal/${s}`] = gaussian(mean, stdev);
  }

  return out;
}

async function createOrFindRun(): Promise<{ runId: number; url: string }> {
  const res = await fetch(`${SERVER_URL}/api/runs/create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectName: PROJECT_NAME,
      runName: RUN_NAME,
      tags: ["seed", "running-bars"],
      externalId: `seed-running-bars-${RUN_NAME}`,
      config: JSON.stringify({
        description: "Long-running RUNNING demo for distributions auto-refresh",
        seed: 0,
        model: "demo-mock",
      }),
      systemMetadata: JSON.stringify({ hostname: "seeded", gpu: "demo" }),
    }),
  });
  if (!res.ok) throw new Error(`createRun: ${res.status} ${await res.text()}`);
  return (await res.json()) as { runId: number; url: string };
}

async function registerLogNames(runId: number, logNames: string[]): Promise<void> {
  const CHUNK = 250;
  for (let i = 0; i < logNames.length; i += CHUNK) {
    const batch = logNames.slice(i, i + CHUNK);
    const res = await fetch(`${SERVER_URL}/api/runs/logName/add`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectName: PROJECT_NAME,
        runId,
        logName: batch,
        logType: "METRIC",
      }),
    });
    if (!res.ok)
      throw new Error(`registerLogNames: ${res.status} ${await res.text()}`);
  }
}

async function sendNdjson(runId: number, lines: string[]): Promise<void> {
  const CHUNK = 1000;
  for (let i = 0; i < lines.length; i += CHUNK) {
    const batch = lines.slice(i, i + CHUNK).join("\n");
    const res = await fetch(`${INGEST_URL}/ingest/metrics`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/x-ndjson",
        "X-Run-Id": String(runId),
        "X-Project-Name": PROJECT_NAME,
      },
      body: batch,
    });
    if (res.status >= 400) {
      throw new Error(`ingest: ${res.status} ${await res.text()}`);
    }
  }
}

async function setRunStatus(
  runId: number,
  status: "RUNNING" | "COMPLETED" | "FAILED",
): Promise<void> {
  const res = await fetch(`${SERVER_URL}/api/runs/status/update`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectName: PROJECT_NAME, runId, status }),
  });
  if (!res.ok) throw new Error(`status: ${res.status} ${await res.text()}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log(`Seeding ${PROJECT_NAME}/${RUN_NAME} via real API…`);
  console.log(`   server=${SERVER_URL} ingest=${INGEST_URL}`);
  console.log(
    `   backfill=${BACKFILL_HOURS}h step=${STEP_INTERVAL_S}s tick=${TICK_INTERVAL_S}s live=${LIVE_DURATION_MIN}min`,
  );

  const { runId } = await createOrFindRun();
  console.log(`   run created → runId=${runId}`);

  await registerLogNames(runId, ALL_METRICS);
  console.log(`   registered ${ALL_METRICS.length} log names`);

  await setRunStatus(runId, "RUNNING");

  const backfillSteps = Math.floor((BACKFILL_HOURS * 3600) / STEP_INTERVAL_S);
  const nowMs = Date.now();
  const startMs = nowMs - BACKFILL_HOURS * 3600 * 1000;

  // Backfill historical points.
  const lines: string[] = [];
  for (let step = 0; step < backfillSteps; step++) {
    const time = startMs + step * STEP_INTERVAL_S * 1000;
    lines.push(JSON.stringify({ time, step, data: metricsAtStep(step, backfillSteps) }));
  }
  console.log(`   ingesting ${lines.length} historical points…`);
  await sendNdjson(runId, lines);
  console.log(`   backfill complete`);

  // Live tick loop. Each tick advances `step` by 1 and emits at wall-clock time.
  const ticksTotal = Math.ceil((LIVE_DURATION_MIN * 60) / TICK_INTERVAL_S);
  console.log(
    `   live-emit: ${ticksTotal} ticks over ${LIVE_DURATION_MIN}min (Ctrl-C to stop)`,
  );

  let step = backfillSteps;
  const projectedTotal = backfillSteps + ticksTotal;
  for (let tick = 0; tick < ticksTotal; tick++) {
    const data = metricsAtStep(step, projectedTotal);
    const time = Date.now();
    await sendNdjson(runId, [JSON.stringify({ time, step, data })]);
    if (tick % 5 === 0) {
      console.log(
        `   tick ${tick + 1}/${ticksTotal} (step=${step}, train/loss=${data["train/loss"].toFixed(3)})`,
      );
    }
    step += 1;
    await sleep(TICK_INTERVAL_S * 1000);
  }

  console.log(`\n   live window finished. Run left in RUNNING status.`);
  console.log(`   To finalize: curl -X POST ... runs/status/update with COMPLETED.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
