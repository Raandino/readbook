import { defineConfig } from "drizzle-kit";

const dbPath = process.env.READBOOK_DB_PATH ?? "../../data/readbook.db";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: dbPath },
});
