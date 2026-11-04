import { defineConfig } from "vitest/config";

// One test run for the whole monorepo. Tests live next to the code they cover
// as `*.test.ts`. Each test file gets a fresh in-memory SQLite database unless
// it sets READBOOK_DB_PATH itself.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/web/src/**/*.test.ts"],
    environment: "node",
    env: { READBOOK_DB_PATH: ":memory:" },
    pool: "forks",
  },
});
