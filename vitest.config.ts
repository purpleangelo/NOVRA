import { defineConfig } from "vitest/config";
import path from "node:path";

const testEnv = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/novra_test",
  REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1",
  STORAGE_DIR: path.resolve(__dirname, "storage-test"),
  AI_PROVIDER: "mock",
  FAL_KEY: "",
  ANTHROPIC_API_KEY: "",
};
Object.assign(process.env, testEnv);

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
    env: testEnv,
  },
});
