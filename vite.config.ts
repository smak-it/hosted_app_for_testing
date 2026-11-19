import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: "frontend",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        notes: fileURLToPath(new URL("./frontend/index.html", import.meta.url)),
        admin: fileURLToPath(new URL("./frontend/admin.html", import.meta.url)),
      },
    },
  },
});
