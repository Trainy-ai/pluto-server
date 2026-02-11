import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const portOffset = parseInt(process.env.PORT_OFFSET || '0', 10);
const appPort = 3000 + portOffset;
const serverUrl = process.env.VITE_SERVER_URL || (portOffset
  ? `http://localhost:${3001 + portOffset}`
  : 'http://server:3001');

export default defineConfig({
  appType: 'spa', // Enable SPA mode for client-side routing
  plugins: [
    tailwindcss(),
    TanStackRouterVite({
      routeFileIgnorePrefix: "~",
      autoCodeSplitting: true,
    }),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: appPort,
    strictPort: false,
    hmr: false, // Disable HMR in Docker to avoid WebSocket issues
    cors: true,
    allowedHosts: ['app'],
    proxy: {
      // Proxy API and tRPC requests to the backend server
      // This makes all requests appear to come from the same origin, fixing cookie issues
      '/api': {
        target: serverUrl,
        changeOrigin: true,
        cookieDomainRewrite: '', // Remove domain from cookies so they work with proxy
        cookiePathRewrite: '/', // Ensure cookies work for all paths
      },
      '/trpc': {
        target: serverUrl,
        changeOrigin: true,
        cookieDomainRewrite: '', // Remove domain from cookies so they work with proxy
        cookiePathRewrite: '/', // Ensure cookies work for all paths
      },
    },
  },
});
