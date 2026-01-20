import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["app/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["app/main/**/*.ts", "app/shared/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.d.ts"],
    },
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "./app/shared"),
      "@main": resolve(__dirname, "./app/main"),
      "@renderer": resolve(__dirname, "./app/renderer"),
    },
  },
});
