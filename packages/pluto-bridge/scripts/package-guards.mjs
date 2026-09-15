#!/usr/bin/env node
// Supply-chain guards for @trainy/pluto-bridge, run in PR CI and in the
// release build job. Customers run this package with npx as a local server
// over their Pluto data, so it must stay small and inert to install:
//
//   - no runtime dependencies of any kind (nothing transitive to compromise)
//   - no lifecycle scripts (nothing runs on install, pack or publish)
//   - the tarball holds only dist/, LICENSE, README.md and package.json
//   - a committed lockfile, so the build uses `npm ci`
//
// Usage: node scripts/package-guards.mjs   (from packages/pluto-bridge)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundleDependencies",
  "bundledDependencies",
];

// Every script npm runs implicitly during install, pack or publish.
const LIFECYCLE_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "preprepare",
  "postprepare",
  "prepublish",
  "prepublishOnly",
  "prepack",
  "postpack",
  "publish",
  "postpublish",
  "dependencies",
];

const ALLOWED_FILES = new Set(["package.json", "LICENSE", "README.md"]);

/** @param {Record<string, unknown>} manifest */
export function checkManifest(manifest) {
  const problems = [];
  for (const field of DEPENDENCY_FIELDS) {
    const value = manifest[field];
    const count = Array.isArray(value)
      ? value.length
      : value && typeof value === "object"
        ? Object.keys(value).length
        : 0;
    if (count > 0) {
      problems.push(`package.json must not declare ${field}`);
    }
  }
  const scripts =
    manifest.scripts && typeof manifest.scripts === "object"
      ? manifest.scripts
      : {};
  for (const name of LIFECYCLE_SCRIPTS) {
    if (name in scripts) {
      problems.push(`package.json must not define the "${name}" lifecycle script`);
    }
  }
  return problems;
}

/** @param {string[]} files paths inside the tarball */
export function checkPackedFiles(files) {
  const problems = [];
  for (const file of files) {
    if (!ALLOWED_FILES.has(file) && !file.startsWith("dist/")) {
      problems.push(`unexpected file in package: ${file}`);
    }
    if (file.startsWith("dist/") && file.includes("__tests__")) {
      problems.push(`test file in package: ${file}`);
    }
  }
  for (const required of ["package.json", "LICENSE", "README.md", "dist/bin.js"]) {
    if (!files.includes(required)) {
      problems.push(`package is missing ${required}`);
    }
  }
  return problems;
}

function main() {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const problems = checkManifest(manifest);

  if (!existsSync("package-lock.json")) {
    problems.push("package-lock.json is missing; the build must use npm ci");
  }

  if (!existsSync("dist/bin.js")) {
    problems.push("dist/bin.js is missing; run the build first");
  } else if (!readFileSync("dist/bin.js", "utf8").startsWith("#!/usr/bin/env node\n")) {
    problems.push("dist/bin.js must start with a node shebang");
  }

  // --ignore-scripts: never run a script while checking for scripts.
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      encoding: "utf8",
    }),
  );
  const files = packed[0].files.map((entry) => entry.path);
  problems.push(...checkPackedFiles(files));

  if (problems.length > 0) {
    console.error("pluto-bridge package guards failed:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`pluto-bridge package guards passed (${files.length} files):`);
  for (const file of files) console.log(`  ${file}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
