import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(frontendRoot, "..");

export default defineConfig(({ mode }) => {
  // Shared .env lives at the project root, next to package.json.
  const env = loadEnv(mode, projectRoot, "");
  const apiTarget = env.API_TARGET || "http://localhost:8787";

  const proxy = {
    "/api": { target: apiTarget, changeOrigin: true },
    "/ws": { target: apiTarget, ws: true, changeOrigin: true },
  };

  return {
    root: frontendRoot,
    envDir: projectRoot,
    cacheDir: join(projectRoot, "node_modules", ".vite"),
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy,
    },
    preview: {
      port: 4173,
      proxy,
    },
    build: {
      outDir: join(projectRoot, "dist"),
      emptyOutDir: true,
      sourcemap: false,
    },
  };
});
