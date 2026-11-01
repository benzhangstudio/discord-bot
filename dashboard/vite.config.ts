import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist/dashboard", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    // During local development, send API and login requests to the bot's web server.
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
    },
  },
});
