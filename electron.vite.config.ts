import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "symbol-worker": resolve("src/main/symbol-worker.ts"),
        },
      },
    },
  },
  preload: { build: { rollupOptions: { output: { format: "cjs" } } } },
  renderer: { plugins: [react()] },
});
