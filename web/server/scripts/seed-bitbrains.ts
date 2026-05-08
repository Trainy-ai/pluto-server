/**
 * Seed `validation/bitbrains_fast_storage/<bucket>/original/<metric>` paths
 * into project `test2` via the real ingest API. Designed to exercise
 * regex-with-capture-groups prefix grouping (PR #434):
 *
 *   regex: `validation/bitbrains_fast_storage/(.*?)/original/(.*?)$`
 *   captures: (bucket, metric)
 *   each unique tuple → its own combined widget
 *
 * Run from a one-shot container on the mlop_network:
 *   docker run --rm -v /home/azureuser/server-private-wt2/web/server/scripts:/scripts:ro \
 *     --network mlop_network -w /work \
 *     -e API_KEY=mlpi_Gu0LJq4V5jn4tmt9 \
 *     -e SERVER_URL=http://backend-4000:4001 -e INGEST_URL=http://ingest:3003 \
 *     node:22-alpine sh -c "cp /scripts/seed-bitbrains.ts /work/seed.ts && \
 *                            npm init -y >/dev/null && npm i tsx --silent && \
 *                            npx tsx /work/seed.ts"
 */
const PROJECT_NAME = process.env.PROJECT_NAME || "test2";
const SERVER_URL = process.env.SERVER_URL || "http://backend-4000:4001";
const INGEST_URL = process.env.INGEST_URL || "http://ingest:3003";
const API_KEY = process.env.API_KEY;
const TOTAL_STEPS = Number(process.env.TOTAL_STEPS || 200);

if (!API_KEY) {
  console.error("API_KEY env var is required (e.g. mlpi_...)");
  process.exit(1);
}

// Two varying segments — the regex `validation/bitbrains_fast_storage/(.*?)/original/(.*?)$`
// captures (bucket, metric). Each unique pair should bucket into its own
// combined widget. Adding "smoothed" variants (which DON'T match the regex —
// they use `/smoothed/` instead of `/original/`) tests passthrough behavior.
const BUCKETS = ["5T", "H", "D", "W"];                     // forecast horizons
const METRICS = ["CRPS", "MASE", "MAPE", "sMAPE", "wQL"];  // forecast accuracy metrics

interface MetricSpec {
  name: string;
  curveSeed: number;
}

function buildMetricSpecs(): MetricSpec[] {
  const specs: MetricSpec[] = [];
  let i = 0;
  for (const bucket of BUCKETS) {
    for (const metric of METRICS) {
      // /original/ — these match the regex
      specs.push({
        name: `validation/bitbrains_fast_storage/${bucket}/original/${metric}`,
        curveSeed: i++,
      });
      // /smoothed/ — these do NOT match the example regex; useful for testing
      // that passthrough works alongside regex-grouped buckets
      specs.push({
        name: `validation/bitbrains_fast_storage/${bucket}/smoothed/${metric}`,
        curveSeed: i++,
      });
    }
  }
  return specs;
}

function metricValue(curveSeed: number, step: number, runSeed: number): number {
  // A monotone-ish convergence curve with per-metric variation.
  const p = step / TOTAL_STEPS;
  const baseFloor = 0.05 + (curveSeed % 7) * 0.01;
  const startMag = 1.0 + (curveSeed % 5) * 0.3;
  const noise = (Math.random() - 0.5) * 0.04;
  const seedJitter = runSeed * 0.05;
  return startMag * Math.exp(-2.5 * p) + baseFloor + noise + seedJitter;
}

async function createRun(name: string, runIdx: number): Promise<{ runId: number }> {
  const res = await fetch(`${SERVER_URL}/api/runs/create`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      projectName: PROJECT_NAME,
      runName: name,
      tags: ["bitbrains", "seeded"],
      config: JSON.stringify({
        description: "Seeded blah-eval run for regex-capture grouping",
        seed: runIdx,
        dataset: "bitbrains_fast_storage",
      }),
      systemMetadata: JSON.stringify({ hostname: "seeded", gpu: "A100" }),
    }),
  });
  if (!res.ok) throw new Error(`createRun ${name}: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { runId: number };
  console.log(`   created ${name} → runId=${j.runId}`);
  return j;
}

async function registerLogNames(runId: number, logNames: string[]) {
  const CHUNK = 250;
  for (let i = 0; i < logNames.length; i += CHUNK) {
    const batch = logNames.slice(i, i + CHUNK);
    const res = await fetch(`${SERVER_URL}/api/runs/logName/add`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ projectName: PROJECT_NAME, runId, logName: batch, logType: "METRIC" }),
    });
    if (!res.ok) throw new Error(`registerLogNames: ${res.status} ${await res.text()}`);
  }
}

async function sendNdjson(runId: number, lines: string[]) {
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
    if (res.status >= 400) throw new Error(`ingest: ${res.status} ${await res.text()}`);
  }
}

async function setStatus(runId: number, status: "RUNNING" | "COMPLETED") {
  const res = await fetch(`${SERVER_URL}/api/runs/status/update`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ projectName: PROJECT_NAME, runId, status }),
  });
  if (!res.ok) throw new Error(`status: ${res.status} ${await res.text()}`);
}

async function main() {
  console.log(`Seeding bitbrains regex-capture data into ${PROJECT_NAME}...`);
  console.log(`   server=${SERVER_URL} ingest=${INGEST_URL}`);

  const specs = buildMetricSpecs();
  const allNames = specs.map((s) => s.name);
  console.log(`   ${allNames.length} metrics per run (${BUCKETS.length} buckets × ${METRICS.length} metrics × 2 variants)`);

  const runs = [
    { name: "bitbrains-baseline", seed: 0 },
    { name: "bitbrains-tuned", seed: 1 },
  ];

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const created = await createRun(r.name, i);
    await registerLogNames(created.runId, allNames);
    await setStatus(created.runId, "RUNNING");

    const baseTime = Date.now() - TOTAL_STEPS * 1000;
    const lines: string[] = [];
    for (let step = 0; step <= TOTAL_STEPS; step++) {
      const time = baseTime + step * 1000;
      const data: Record<string, number> = {};
      for (const s of specs) {
        data[s.name] = metricValue(s.curveSeed, step, r.seed);
      }
      lines.push(JSON.stringify({ time, step, data }));
    }
    await sendNdjson(created.runId, lines);
    await setStatus(created.runId, "COMPLETED");
    console.log(`   ingested ${lines.length} steps for ${r.name}`);
  }

  console.log(`\nDone.`);
  console.log(`Try a dynamic section with pattern \`validation/*\`,`);
  console.log(`  Combine these suffixes: ${METRICS.join(", ")}`);
  console.log(`  Or group by regex with capture groups: validation/bitbrains_fast_storage/(.*?)/original/(.*?)$`);
  console.log(`Expected: ${BUCKETS.length * METRICS.length} combined widgets, one per (bucket, metric) tuple.`);
  console.log(`Smoothed variants don't match the regex — they'll appear as their own widgets.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
