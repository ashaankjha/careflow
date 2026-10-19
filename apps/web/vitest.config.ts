import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/empty.ts", import.meta.url)),
    },
  },
  test: { globalSetup: ["./test/global-setup.ts"], include: ["test/**/*.test.ts"], fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000 },
});
