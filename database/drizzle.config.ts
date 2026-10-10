import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Passwordless fallback — no credential in source. Set DATABASE_URL in `.env`.
    url: process.env.DATABASE_URL ?? 'postgres://aglotrends@localhost:5433/aglotrends',
  },
});
