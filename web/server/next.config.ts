import { env } from "./lib/env";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: env.IS_DOCKER === "true" ? "standalone" : undefined,
};

export default nextConfig;
