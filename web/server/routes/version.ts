import { Hono } from "hono";

interface VersionInfo {
  service: string;
  version: string;
  gitCommit: string;
  gitBranch: string;
  buildTime: string;
}

interface AllVersionsInfo {
  backend: VersionInfo;
  ingest?: VersionInfo | { error: string };
  py?: VersionInfo | { error: string };
}

const router = new Hono();

function getBackendVersion(): VersionInfo {
  return {
    service: "backend",
    version: process.env.SERVICE_VERSION || "unknown",
    gitCommit: process.env.GIT_COMMIT || "unknown",
    gitBranch: process.env.GIT_BRANCH || "unknown",
    buildTime: process.env.BUILD_TIME || "unknown",
  };
}

async function fetchServiceVersion(
  url: string,
  timeoutMs = 5000
): Promise<VersionInfo | { error: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }
    return (await response.json()) as VersionInfo;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return { error: `Request timed out after ${timeoutMs}ms` };
      }
      return { error: error.message };
    }
    return { error: "Unknown error" };
  }
}

router.get("/version", (c) => {
  return c.json(getBackendVersion());
});

router.get("/version/all", async (c) => {
  // Get internal service URLs from environment or use defaults
  const ingestUrl = process.env.INGEST_URL || "http://ingest:3003";
  const pyUrl = process.env.PY_URL || "http://py:3004";

  const [ingestVersion, pyVersion] = await Promise.all([
    fetchServiceVersion(`${ingestUrl}/version`),
    fetchServiceVersion(`${pyUrl}/version`),
  ]);

  const allVersions: AllVersionsInfo = {
    backend: getBackendVersion(),
    ingest: ingestVersion,
    py: pyVersion,
  };

  return c.json(allVersions);
});

export default router;
