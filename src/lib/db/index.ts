import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error("DATABASE_URL is required to connect to the CRM database")
}

type DatabaseGlobal = typeof globalThis & { crmPool?: Pool }
const globalForDatabase = globalThis as DatabaseGlobal

export const pool = globalForDatabase.crmPool ?? new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.crmPool = pool
}

export const db = drizzle(pool, { schema })
