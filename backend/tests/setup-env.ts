/**
 * Jest setup: load backend env from .env.local (mirrors preload.ts behavior).
 * Integration tests connect to real PostgreSQL — without env the pg client
 * reports "client password must be a string". Previously these tests were
 * never matched by testMatch, so this loading gap never surfaced.
 *
 * Integration tests must NOT hit the dev compose DB (host `postgres` is a
 * container-internal name, unreachable from the host). Point DATABASE_URL at
 * the dedicated test PG `starfit-test-pg` (127.0.0.1:15432, see
 * tests/integration/E2E-TEST-GUIDE.md).
 *
 * NOTE: jest runs this file via ts-jest in CJS mode — no import.meta.
 */
import dotenv from "dotenv";
import path from "node:path";

const backendDir = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(backendDir, ".env.local"), override: true });
dotenv.config({ path: path.join(backendDir, ".env"), override: false });

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://starfit:starfit@127.0.0.1:15432/starfit";

if (
  process.env.TEST_DB_TYPE === "postgres" ||
  process.env.NODE_ENV !== "production"
) {
  process.env.DATABASE_URL = TEST_DB_URL;
  // 清掉散接参数，避免 pg 客户端用它们覆盖 connectionString
  delete process.env.PGHOST;
  delete process.env.PGPORT;
}
