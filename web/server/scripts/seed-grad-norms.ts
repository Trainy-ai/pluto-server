/**
 * Seed deeply-nested gradient/weight norm metrics into project `test2` in the
 * `ryandevvm` org by using the real ingest API (matches what the SDK does).
 *
 * Pattern: training/{gradient,weight}/norms/{layer-path}/{min,max,mean,std}
 *
 * Run from host:
 *   API_KEY=mlpi_... npx tsx web/server/scripts/seed-grad-norms.ts
 *
 * Or from a one-shot container on the mlop_network — see the bottom of the file
 * for an env-var override, then ingest=http://ingest:3003, server=http://backend-4000:4001.
 */
const PROJECT_NAME = process.env.PROJECT_NAME || "test2";
const SERVER_URL = process.env.SERVER_URL || "http://backend-4000:4001";
const INGEST_URL = process.env.INGEST_URL || "http://ingest:3003";
const API_KEY = process.env.API_KEY;
const TOTAL_STEPS = Number(process.env.TOTAL_STEPS || 800);
// Sample the deep grad/weight tree every Nth step so we don't write
// hundreds of thousands of points. Top-level metrics still get every step.
const TREE_STRIDE = Number(process.env.TREE_STRIDE || 4);

if (!API_KEY) {
  console.error("API_KEY env var is required (e.g. mlpi_...)");
  process.exit(1);
}

const LAYER_PATHS = [
  "model.embedding.token_emb",
  "model.embedding.pos_emb",
  "model.encoder.attention.q_proj",
  "model.encoder.attention.k_proj",
  "model.encoder.attention.v_proj",
  "model.encoder.attention.out_proj",
  "model.encoder.mlp.fc1",
  "model.encoder.mlp.fc2",
  "model.encoder.layernorm",
  "model.decoder.attention.q_proj",
  "model.decoder.attention.k_proj",
  "model.decoder.attention.v_proj",
  "model.decoder.attention.out_proj",
  "model.decoder.cross_attention.q_proj",
  "model.decoder.cross_attention.k_proj",
  "model.decoder.cross_attention.v_proj",
  "model.decoder.mlp.hidden_layer",
  "model.decoder.mlp.output_layer",
  "model.decoder.residual_layer",
  "model.decoder.layernorm",
  "model.lm_head",
];
const STATS = ["min", "max", "mean", "std"];

function topMetrics(step: number, seed: number): Record<string, number> {
  const p = step / TOTAL_STEPS;
  const out: Record<string, number> = {
    "train/loss": 2.5 * Math.exp(-3 * p) + 0.15 + Math.random() * 0.04 + seed * 0.02,
    "train/accuracy": 0.5 + 0.45 * (1 - Math.exp(-4 * p)) + Math.random() * 0.02 - seed * 0.01,
    "val/loss": 2.6 * Math.exp(-2.5 * p) + 0.2 + Math.random() * 0.05 + seed * 0.02,
    "val/accuracy": 0.45 + 0.4 * (1 - Math.exp(-3.5 * p)) + Math.random() * 0.025 - seed * 0.01,
  };
  // Cosine warmup → cosine decay LR schedule
  const warmup = 50;
  if (step < warmup) {
    out["lr"] = 1e-4 * (step / warmup);
  } else {
    const pp = (step - warmup) / (TOTAL_STEPS - warmup);
    out["lr"] = 1e-4 * 0.5 * (1 + Math.cos(pp * Math.PI));
  }
  return out;
}

function gradNormValue(layerIdx: number, stat: string, step: number, seed: number): number {
  const decay = Math.exp(-2 * (step / TOTAL_STEPS));
  const layerScale = 0.5 + 0.5 * Math.abs(Math.cos(layerIdx * 0.7));
  const noise = (Math.random() - 0.5) * 0.02;
  const seedJitter = seed * 0.05;
  const base = 0.05 * layerScale * decay + 0.005 + seedJitter;
  switch (stat) {
    case "min":  return Math.max(0, base * 0.05 + noise * 0.2);
    case "max":  return base * 4.0 + Math.abs(noise) * 2.0;
    case "mean": return base + noise;
    case "std":  return base * 0.6 + Math.abs(noise);
    default:     return base;
  }
}

function weightNormValue(layerIdx: number, stat: string, step: number, seed: number): number {
  const drift = 0.5 + 0.3 * (step / TOTAL_STEPS);
  const layerScale = 0.7 + 0.3 * Math.abs(Math.sin(layerIdx * 0.9));
  const noise = (Math.random() - 0.5) * 0.01;
  const seedJitter = seed * 0.02;
  const base = drift * layerScale + seedJitter;
  switch (stat) {
    case "min":  return base * 0.1 + noise * 0.1;
    case "max":  return base * 1.8 + Math.abs(noise) * 0.5;
    case "mean": return base + noise;
    case "std":  return base * 0.25 + Math.abs(noise) * 0.5;
    default:     return base;
  }
}

function treeMetrics(step: number, seed: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let li = 0; li < LAYER_PATHS.length; li++) {
    const lp = LAYER_PATHS[li];
    for (const stat of STATS) {
      out[`training/gradient/norms/${lp}/${stat}`] = gradNormValue(li, stat, step, seed);
      out[`training/weight/norms/${lp}/${stat}`] = weightNormValue(li, stat, step, seed);
    }
  }
  return out;
}

async function createRun(name: string, runIdx: number): Promise<{ runId: number; url: string }> {
  const res = await fetch(`${SERVER_URL}/api/runs/create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectName: PROJECT_NAME,
      runName: name,
      tags: ["grad-norms", "seeded"],
      config: JSON.stringify({
        description: "Seeded run with deep gradient/weight norm tree",
        seed: runIdx,
        model: "transformer-mock",
      }),
      systemMetadata: JSON.stringify({ hostname: "seeded", gpu: "A100" }),
    }),
  });
  if (!res.ok) throw new Error(`createRun ${name}: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { runId: number; url: string };
  console.log(`   created ${name} → runId=${j.runId}`);
  return j;
}

async function registerLogNames(runId: number, logNames: string[]) {
  // Batch in chunks of 250 to avoid huge requests
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
    if (!res.ok) throw new Error(`registerLogNames: ${res.status} ${await res.text()}`);
  }
}

async function sendNdjson(runId: number, lines: string[]) {
  const CHUNK = 1000; // lines per request
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

async function setRunStatus(runId: number, status: "RUNNING" | "COMPLETED" | "FAILED") {
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

async function main() {
  console.log(`Seeding ${PROJECT_NAME} via real API…`);
  console.log(`   server=${SERVER_URL} ingest=${INGEST_URL}`);

  const runs: { runId: number; name: string; seed: number }[] = [];
  for (let i = 0; i < 2; i++) {
    const name = `grad-norms-${i === 0 ? "demo" : "comparison"}`;
    const r = await createRun(name, i);
    runs.push({ runId: r.runId, name, seed: i });
  }

  // Compose the full set of metric names once — same for every step.
  const baseNames = [
    "train/loss", "train/accuracy", "val/loss", "val/accuracy", "lr",
  ];
  const treeNames: string[] = [];
  for (const lp of LAYER_PATHS) {
    for (const s of STATS) {
      treeNames.push(`training/gradient/norms/${lp}/${s}`);
      treeNames.push(`training/weight/norms/${lp}/${s}`);
    }
  }
  const allNames = [...baseNames, ...treeNames];
  console.log(`   ${allNames.length} metrics per run`);

  // Pre-register log names so they show up in run_logs (the Rust ingest does
  // this lazily but registering up front is cleaner and matches SDK behavior).
  for (const r of runs) {
    await registerLogNames(r.runId, allNames);
  }
  console.log(`   registered log names`);

  // Build NDJSON: one line per (step, runIdx). Each line carries all metrics
  // active at that step. Top metrics every step, tree metrics every TREE_STRIDE.
  const baseTime = Date.now() - TOTAL_STEPS * 1000;
  for (const r of runs) {
    await setRunStatus(r.runId, "RUNNING");
    const lines: string[] = [];
    for (let step = 0; step <= TOTAL_STEPS; step++) {
      const time = baseTime + step * 1000;
      const data: Record<string, number> = topMetrics(step, r.seed);
      if (step % TREE_STRIDE === 0) {
        Object.assign(data, treeMetrics(step, r.seed));
      }
      lines.push(JSON.stringify({ time, step, data }));
    }
    await sendNdjson(r.runId, lines);
    await setRunStatus(r.runId, "COMPLETED");
    console.log(`   ingested ${lines.length} step lines for ${r.name}`);
  }

  console.log(`\nDone. Open the project test2 and look at runs ${runs.map((r) => r.name).join(", ")}`);
  console.log(`Try a dynamic section with pattern \`training/gradient/norms/*\` and Advanced → Combine \`min, max, mean\`.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
