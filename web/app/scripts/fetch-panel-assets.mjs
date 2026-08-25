#!/usr/bin/env node
// Vendors the pinned stlite + Pyodide assets for Python Panels into
// web/app/public/stlite/ (git-ignored; baked into the Docker image at
// build time). Everything is sha256-verified: top-level pins live in
// panel-asset-pins.json; per-package Pyodide wheel hashes come from the
// (itself pinned) pyodide-lock.json. Already-present files with a
// matching hash are skipped, so re-runs are cheap.
//
// Usage: node scripts/fetch-panel-assets.mjs   (cwd: web/app)
//        pnpm --filter @mlop/app fetch-panel-assets
//
// Layout produced:
//   public/stlite/stlite/   — @stlite/browser build (stlite.js, css, streamlit wheels)
//   public/stlite/pyodide/  — pyodide core runtime + package wheels + vendored
//                             PyPI pure wheels; pyodide-lock.json is served
//                             with the PyPI wheels INJECTED as packages so
//                             micropip resolves every name-based requirement
//                             (streamlit's own deps, seaborn, plotly) from
//                             the lockfile — zero PyPI/index access at boot
//   public/stlite/manifest.json — {url, sha256, bytes} per served file
//
// Version bump procedure: change the pins file, set the coreFiles hashes
// to null (trust-on-first-use: this script prints the computed hashes to
// paste back), re-capture the stlite boot manifest per the Python Panels
// plan, and update `packages` with any new boot-time wheels.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const outDir = path.join(appDir, "public", "stlite");
const pins = JSON.parse(
  fs.readFileSync(path.join(scriptDir, "panel-asset-pins.json"), "utf8"),
);

const normalizeName = (name) => name.toLowerCase().replace(/_/g, "-");

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Ensure `destPath` holds the file at `url` with hash `expectedSha256`.
 * `expectedSha256: null` = trust-on-first-use (hash printed for pinning).
 * Returns a manifest entry {url, sha256, bytes, skipped}.
 */
async function ensureFile(url, destPath, expectedSha256, label) {
  if (fs.existsSync(destPath)) {
    const existing = sha256File(destPath);
    if (expectedSha256 === null || existing === expectedSha256) {
      return { url, sha256: existing, bytes: fs.statSync(destPath).size, skipped: true };
    }
    console.warn(`  hash mismatch for existing ${label} — re-downloading`);
  }
  const buf = await download(url);
  const actual = createHash("sha256").update(buf).digest("hex");
  if (expectedSha256 !== null && actual !== expectedSha256) {
    throw new Error(
      `sha256 mismatch for ${label}\n  url: ${url}\n  expected: ${expectedSha256}\n  actual:   ${actual}`,
    );
  }
  if (expectedSha256 === null) {
    console.log(`  PIN ME (panel-asset-pins.json) ${label}: ${actual}`);
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  console.log(`  fetched ${label} (${(buf.length / 1e6).toFixed(1)} MB)`);
  return { url, sha256: actual, bytes: buf.length, skipped: false };
}

/** Resolve the transitive dependency closure of `names` in the lockfile. */
function resolveClosure(lock, names) {
  const packages = {};
  for (const [key, value] of Object.entries(lock.packages)) {
    packages[normalizeName(key)] = value;
  }
  const seen = new Set();
  const stack = names.map(normalizeName);
  while (stack.length > 0) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    const pkg = packages[name];
    if (!pkg) {
      throw new Error(`package "${name}" not found in pyodide-lock.json`);
    }
    seen.add(name);
    stack.push(...pkg.depends.map(normalizeName));
  }
  return [...seen].sort().map((name) => packages[name]);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = { files: {} };
  const addEntry = (relPath, entry) => {
    manifest.files[relPath] = { url: entry.url, sha256: entry.sha256, bytes: entry.bytes };
    return entry;
  };

  // ── 1. stlite browser bundle ────────────────────────────────────────
  // Tarball lands in a cache dir OUTSIDE public/ (only the extracted
  // build/ is served) and is deliberately absent from manifest.json.
  console.log(`stlite @stlite/browser ${pins.stlite.version}`);
  const cacheDir = path.join(appDir, "node_modules", ".cache", "panel-assets");
  const tarballPath = path.join(cacheDir, `stlite-browser-${pins.stlite.version}.tgz`);
  await ensureFile(pins.stlite.url, tarballPath, pins.stlite.sha256, "stlite tarball");
  const stliteDir = path.join(outDir, "stlite");
  // Version marker gates the skip: an existing extract from a different
  // (or unknown) pin is stale and must be replaced, not kept.
  const versionMarkerPath = path.join(stliteDir, ".extracted-version");
  const extractedVersion = fs.existsSync(versionMarkerPath)
    ? fs.readFileSync(versionMarkerPath, "utf8").trim()
    : null;
  if (
    extractedVersion !== pins.stlite.version ||
    !fs.existsSync(path.join(stliteDir, "stlite.js"))
  ) {
    const extractDir = fs.mkdtempSync(path.join(outDir, ".stlite-extract-"));
    const tar = spawnSync("tar", ["-xzf", tarballPath, "-C", extractDir], { stdio: "inherit" });
    if (tar.status !== 0) throw new Error("tar extraction failed");
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(extractDir, "package", "package.json"), "utf8"),
    );
    // The host page relays through app._kernel._worker (unstable internals
    // verified against exactly this version) — refuse silent drift.
    if (pkgJson.version !== pins.stlite.version) {
      throw new Error(
        `stlite tarball is v${pkgJson.version}, pinned v${pins.stlite.version}`,
      );
    }
    fs.rmSync(stliteDir, { recursive: true, force: true });
    fs.renameSync(path.join(extractDir, "package", "build"), stliteDir);
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.writeFileSync(versionMarkerPath, `${pkgJson.version}\n`);
    console.log(`  extracted build/ → public/stlite/stlite/ (v${pkgJson.version})`);
  }

  // ── 2. pyodide runtime + package wheels ─────────────────────────────
  const { baseUrl, coreFiles, packages: packageNames, version } = pins.pyodide;
  console.log(`pyodide v${version} (core + ${packageNames.length} pinned packages)`);
  const pyodideDir = path.join(outDir, "pyodide");
  for (const [file, sha] of Object.entries(coreFiles)) {
    if (file === "pyodide-lock.json") continue; // handled below (modified copy served)
    addEntry(
      `pyodide/${file}`,
      await ensureFile(baseUrl + file, path.join(pyodideDir, file), sha, file),
    );
  }

  // The pristine lock lands in the cache dir (pin-verified); the SERVED
  // lock gets the PyPI pure wheels injected as packages below.
  const lockCachePath = path.join(cacheDir, `pyodide-lock-${version}.json`);
  await ensureFile(
    baseUrl + "pyodide-lock.json",
    lockCachePath,
    coreFiles["pyodide-lock.json"],
    "pyodide-lock.json",
  );
  const lock = JSON.parse(fs.readFileSync(lockCachePath, "utf8"));

  const closure = resolveClosure(lock, packageNames);
  console.log(`  dependency closure: ${closure.length} package files`);
  for (const pkg of closure) {
    addEntry(
      `pyodide/${pkg.file_name}`,
      await ensureFile(
        baseUrl + pkg.file_name,
        path.join(pyodideDir, pkg.file_name),
        pkg.sha256,
        pkg.file_name,
      ),
    );
  }

  // ── 3. vendored PyPI pure wheels, injected into the served lock ─────
  console.log(`PyPI wheels (${pins.pypiWheels.length}) → injected into pyodide-lock.json`);
  for (const wheel of pins.pypiWheels) {
    const fileName = path.basename(new URL(wheel.url).pathname);
    addEntry(
      `pyodide/${fileName}`,
      await ensureFile(wheel.url, path.join(pyodideDir, fileName), wheel.sha256, fileName),
    );
    lock.packages[normalizeName(wheel.name)] = {
      name: wheel.name,
      version: wheel.version,
      file_name: fileName,
      install_dir: "site",
      sha256: wheel.sha256,
      package_type: "package",
      imports: wheel.imports,
      depends: wheel.depends,
      unvendored_tests: false,
    };
  }
  const servedLockPath = path.join(pyodideDir, "pyodide-lock.json");
  fs.writeFileSync(servedLockPath, JSON.stringify(lock));
  addEntry("pyodide/pyodide-lock.json", {
    url: baseUrl + "pyodide-lock.json",
    sha256: sha256File(servedLockPath),
    bytes: fs.statSync(servedLockPath).size,
  });

  // ── 4. manifest ─────────────────────────────────────────────────────
  manifest.versions = { stlite: pins.stlite.version, pyodide: version };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  const downloadedBytes = Object.values(manifest.files).reduce((sum, f) => sum + f.bytes, 0);
  const dirBytes = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
      const p = path.join(dir, entry.name);
      return sum + (entry.isDirectory() ? dirBytes(p) : fs.statSync(p).size);
    }, 0);
  console.log(
    `done: ${Object.keys(manifest.files).length} downloaded files (${(downloadedBytes / 1e6).toFixed(1)} MB); ` +
      `public/stlite/ totals ${(dirBytes(outDir) / 1e6).toFixed(1)} MB (incl. extracted stlite build)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
