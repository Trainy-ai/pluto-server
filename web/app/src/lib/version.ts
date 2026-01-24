import { env } from "./env";

export interface ServiceVersion {
  service: string;
  version: string;
  gitCommit: string;
  gitBranch: string;
  buildTime: string;
}

export interface AllServicesVersion {
  frontend: ServiceVersion;
  backend?: ServiceVersion;
  ingest?: ServiceVersion;
  py?: ServiceVersion;
}

export function getFrontendVersion(): ServiceVersion {
  return {
    service: "frontend",
    version: env.SERVICE_VERSION,
    gitCommit: env.GIT_COMMIT,
    gitBranch: env.GIT_BRANCH,
    buildTime: env.BUILD_TIME,
  };
}

export async function getAllServicesVersion(): Promise<AllServicesVersion> {
  const frontend = getFrontendVersion();
  try {
    const response = await fetch(`${env.VITE_SERVER_URL}/api/version/all`);
    if (!response.ok) {
      return { frontend };
    }
    const otherServices = await response.json();
    return {
      frontend,
      ...otherServices,
    };
  } catch {
    return { frontend };
  }
}
