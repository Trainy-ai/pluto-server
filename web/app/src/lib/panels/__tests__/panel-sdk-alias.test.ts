import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The panel SDK is `pluto`, renamed from `mlop`. Panel code is stored
 * verbatim in the dashboard config, so panels saved before the rename
 * still say `import mlop` and must keep running. These tests pin the two
 * halves of that promise: the module the host mounts, and the exception
 * name panels may be catching.
 *
 * panel-host.js is a static asset with no build step, so it is read as
 * text rather than imported.
 */
const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const sdk = read("../pluto_sdk.py");
const host = read("../../../../public/stlite/panel-host.js");

describe("panel SDK naming", () => {
  it("exposes PlutoError with MlopError as an alias of the same class", () => {
    expect(sdk).toMatch(/^class PlutoError\(Exception\):/m);
    expect(sdk).toMatch(/^MlopError = PlutoError$/m);
    // No second definition: the alias must not drift into its own class.
    expect(sdk).not.toMatch(/^class MlopError\(/m);
    expect(sdk).not.toMatch(/raise MlopError\(/);
  });

  it("reads its context from the renamed file the host writes", () => {
    expect(sdk).toContain('_CONTEXT_FILE = "pluto_context.json"');
    expect(host).toContain('"pluto_context.json": JSON.stringify(init.context)');
    expect(host).toContain(
      'app.writeFile("pluto_context.json", JSON.stringify(d.context))',
    );
    expect(host).not.toContain("mlop_context.json");
  });

  it("mounts the SDK as pluto.py and mlop.py as an alias module", () => {
    expect(host).toContain('"pluto.py": init.sdk');
    expect(host).toContain('"mlop.py": SDK_ALIAS_MODULE');
  });

  it("binds the alias to the same module object, not a second copy", () => {
    // `sys.modules[__name__] = pluto` is what makes `import mlop` return
    // the live pluto module: one bridge listener, one pending-request map.
    // A `from pluto import *` shim would pass an import check and then
    // silently run a second, unwired copy of the SDK.
    expect(host).toContain("sys.modules[__name__] = pluto");
    expect(host).not.toMatch(/from pluto import \*/);
  });

  it("keeps the postMessage protocol names, which are not branding", () => {
    // The wire contract with panel-host.js. Renaming it would break a
    // live panel iframe across a deploy for no user-visible gain.
    expect(sdk).toContain('"type": "mlop:rpc"');
    expect(sdk).toContain('!= "mlop:res"');
    expect(host).toContain('"mlop:rpc"');
  });
});
