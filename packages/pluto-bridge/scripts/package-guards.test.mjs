import { describe, expect, it } from "vitest";
import { checkManifest, checkPackedFiles } from "./package-guards.mjs";

const clean = {
  name: "@trainy/pluto-bridge",
  scripts: { build: "tsc", test: "vitest run" },
  devDependencies: { typescript: "5.8.3" },
};

describe("checkManifest", () => {
  it("passes a manifest with only dev dependencies and ordinary scripts", () => {
    expect(checkManifest(clean)).toEqual([]);
  });

  it("fails when a runtime dependency is added", () => {
    expect(
      checkManifest({ ...clean, dependencies: { "left-pad": "1.3.0" } }),
    ).toEqual(["package.json must not declare dependencies"]);
    expect(
      checkManifest({ ...clean, optionalDependencies: { fsevents: "2.3.3" } }),
    ).toHaveLength(1);
    expect(checkManifest({ ...clean, bundleDependencies: ["x"] })).toHaveLength(1);
  });

  it("fails when an install-time script is added", () => {
    expect(
      checkManifest({
        ...clean,
        scripts: { ...clean.scripts, postinstall: "node setup.js" },
      }),
    ).toEqual(['package.json must not define the "postinstall" lifecycle script']);
    for (const name of ["preinstall", "install", "prepare", "prepack", "prepublishOnly"]) {
      expect(
        checkManifest({ ...clean, scripts: { [name]: "x" } }),
      ).toHaveLength(1);
    }
  });

  it("allows an empty dependencies object", () => {
    expect(checkManifest({ ...clean, dependencies: {} })).toEqual([]);
  });
});

describe("checkPackedFiles", () => {
  const expected = ["LICENSE", "README.md", "package.json", "dist/bin.js", "dist/cli.js"];

  it("passes the expected tarball contents", () => {
    expect(checkPackedFiles(expected)).toEqual([]);
  });

  it("fails on source, config or test files", () => {
    expect(checkPackedFiles([...expected, "src/cli.ts"])).toEqual([
      "unexpected file in package: src/cli.ts",
    ]);
    expect(checkPackedFiles([...expected, ".npmrc"])).toHaveLength(1);
    expect(
      checkPackedFiles([...expected, "dist/__tests__/cli.test.js"]),
    ).toHaveLength(1);
  });

  it("fails when the entry point or license is missing", () => {
    expect(checkPackedFiles(["package.json", "README.md", "dist/cli.js"])).toEqual([
      "package is missing LICENSE",
      "package is missing dist/bin.js",
    ]);
  });
});
