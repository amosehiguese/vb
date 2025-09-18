import { env } from './src/config/environment';

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./src/db/migrations",
  dialect: "postgresql",
  schema: "./src/db/schema.ts",

  dbCredentials: {
    url: env.DATABASE_URL,
  },

  breakpoints: true,
  strict: true,
  verbose: true,
});
