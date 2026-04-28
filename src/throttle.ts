/**
 * Sliding-window throttle with pluggable storage.
 *
 * Distinct from the request-rate-limit middleware in `rate-limit.ts`.
 * This module provides the **scope/subject attempt counter with lockout**
 * pattern used by PIN auth, password reset, OAuth, and similar flows where:
 *
 * - You want to limit attempts per (scope, subject) pair (e.g. ("pin", userId))
 * - You want persistent state across replicas/restarts (PG store)
 * - You want a memory fallback when the persistent store is unavailable
 * - You want explicit lockout semantics distinct from the sliding window
 *
 * Usage:
 *
 * ```typescript
 * import {
 *   createThrottle,
 *   createPgThrottleStore,
 *   createMemoryThrottleStore,
 *   createCompositeThrottleStore,
 * } from "@tummycrypt/tinyland-rate-limit";
 *
 * const memory = createMemoryThrottleStore();
 * const pg = createPgThrottleStore({ pool, table: "pin_auth_throttles" });
 * const store = createCompositeThrottleStore(pg, memory);
 *
 * const throttle = createThrottle({
 *   store,
 *   maxAttempts: 5,
 *   windowSeconds: 15 * 60,
 *   lockoutSeconds: 15 * 60,
 * });
 *
 * const status = await throttle.check("pin", userId);
 * if (!status.allowed) return throttled(status.retryAfterSeconds);
 *
 * if (verifyPin(input)) {
 *   await throttle.clear("pin", userId);
 * } else {
 *   await throttle.recordFailure("pin", userId);
 * }
 * ```
 */

import type { Pool } from "pg";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ThrottleConfig {
  /** Maximum failed attempts allowed per window. */
  maxAttempts: number;
  /** Sliding window duration in seconds. */
  windowSeconds: number;
  /** Lockout duration after maxAttempts is reached, in seconds. */
  lockoutSeconds: number;
}

export interface ThrottleRecord {
  key: string;
  scope: string;
  subject: string;
  attemptCount: number;
  windowStartedAt: Date;
  lastFailedAt: Date;
  blockedUntil: Date | null;
}

export interface ThrottleStatus {
  /** Whether the operation is allowed right now. */
  allowed: boolean;
  /** Seconds until the next allowed attempt (0 when allowed). */
  retryAfterSeconds: number;
  /** Scope that triggered the lockout, if blocked. */
  scope: string | null;
}

export interface ThrottleStore {
  get(key: string): Promise<ThrottleRecord | null>;
  save(record: ThrottleRecord): Promise<void>;
  clear(key: string): Promise<void>;
}

export interface ThrottleClient {
  /** Check whether the operation is allowed; does not record an attempt. */
  check(scope: string, subject: string): Promise<ThrottleStatus>;
  /** Record a failed attempt; may transition to blocked state. */
  recordFailure(scope: string, subject: string): Promise<void>;
  /** Reset all state for the (scope, subject) pair (e.g. on success). */
  clear(scope: string, subject: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Memory store
// ---------------------------------------------------------------------------

export function createMemoryThrottleStore(): ThrottleStore {
  const data = new Map<string, ThrottleRecord>();
  return {
    async get(key) {
      return data.get(key) ?? null;
    },
    async save(record) {
      data.set(record.key, { ...record });
    },
    async clear(key) {
      data.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// PG store
// ---------------------------------------------------------------------------

export interface PgThrottleStoreConfig {
  /** node-postgres Pool (consumer-provided). */
  pool: Pool;
  /** Fully-qualified table name. Default: "pin_auth_throttles". */
  table?: string;
}

/**
 * SQL DDL for the throttle table. Consumers can run this once at boot or
 * include it in their migrations.
 */
export function pgThrottleTableDdl(table = "pin_auth_throttles"): string {
  return `
    CREATE TABLE IF NOT EXISTS ${table} (
      key text PRIMARY KEY,
      scope text NOT NULL,
      subject text NOT NULL,
      attempt_count integer NOT NULL DEFAULT 0,
      window_started_at timestamptz NOT NULL DEFAULT now(),
      last_failed_at timestamptz NOT NULL DEFAULT now(),
      blocked_until timestamptz
    );
    CREATE INDEX IF NOT EXISTS ${table}_scope_subject_idx
      ON ${table} (scope, subject);
  `;
}

export function createPgThrottleStore(
  config: PgThrottleStoreConfig,
): ThrottleStore {
  const { pool, table = "pin_auth_throttles" } = config;

  return {
    async get(key) {
      const result = await pool.query<{
        key: string;
        scope: string;
        subject: string;
        attempt_count: number;
        window_started_at: Date;
        last_failed_at: Date;
        blocked_until: Date | null;
      }>(`SELECT * FROM ${table} WHERE key = $1`, [key]);
      const row = result.rows[0];
      if (!row) return null;
      return {
        key: row.key,
        scope: row.scope,
        subject: row.subject,
        attemptCount: row.attempt_count,
        windowStartedAt: row.window_started_at,
        lastFailedAt: row.last_failed_at,
        blockedUntil: row.blocked_until,
      };
    },
    async save(record) {
      await pool.query(
        `INSERT INTO ${table} (
          key, scope, subject, attempt_count,
          window_started_at, last_failed_at, blocked_until
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (key) DO UPDATE SET
          attempt_count = EXCLUDED.attempt_count,
          window_started_at = EXCLUDED.window_started_at,
          last_failed_at = EXCLUDED.last_failed_at,
          blocked_until = EXCLUDED.blocked_until`,
        [
          record.key,
          record.scope,
          record.subject,
          record.attemptCount,
          record.windowStartedAt,
          record.lastFailedAt,
          record.blockedUntil,
        ],
      );
    },
    async clear(key) {
      await pool.query(`DELETE FROM ${table} WHERE key = $1`, [key]);
    },
  };
}

// ---------------------------------------------------------------------------
// Composite store: primary with fallback on error
// ---------------------------------------------------------------------------

/**
 * Wrap two stores so that the primary is used when healthy, and the
 * fallback is used transparently when the primary throws.
 *
 * Useful pattern: PG primary with memory fallback for graceful degradation
 * when the database is briefly unavailable.
 */
export function createCompositeThrottleStore(
  primary: ThrottleStore,
  fallback: ThrottleStore,
): ThrottleStore {
  const tryPrimary = async <T>(op: () => Promise<T>, fb: () => Promise<T>): Promise<T> => {
    try {
      return await op();
    } catch {
      return fb();
    }
  };

  return {
    async get(key) {
      return tryPrimary(
        () => primary.get(key),
        () => fallback.get(key),
      );
    },
    async save(record) {
      return tryPrimary(
        () => primary.save(record),
        () => fallback.save(record),
      );
    },
    async clear(key) {
      return tryPrimary(
        () => primary.clear(key),
        () => fallback.clear(key),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Throttle client
// ---------------------------------------------------------------------------

export interface CreateThrottleConfig extends ThrottleConfig {
  store: ThrottleStore;
  /** Override clock for tests. */
  now?: () => Date;
}

const buildKey = (scope: string, subject: string) => `${scope}:${subject}`;

export function createThrottle(config: CreateThrottleConfig): ThrottleClient {
  const { store, maxAttempts, windowSeconds, lockoutSeconds } = config;
  const now = config.now ?? (() => new Date());

  const isBlocked = (record: ThrottleRecord, t: Date): boolean =>
    record.blockedUntil !== null && record.blockedUntil > t;

  const isWindowExpired = (record: ThrottleRecord, t: Date): boolean =>
    t.getTime() - record.windowStartedAt.getTime() >= windowSeconds * 1000;

  return {
    async check(scope, subject) {
      const key = buildKey(scope, subject);
      const record = await store.get(key);
      const t = now();
      if (!record) {
        return { allowed: true, retryAfterSeconds: 0, scope: null };
      }
      if (isBlocked(record, t)) {
        const retryAfterSeconds = Math.max(
          0,
          Math.ceil((record.blockedUntil!.getTime() - t.getTime()) / 1000),
        );
        return { allowed: false, retryAfterSeconds, scope: record.scope };
      }
      return { allowed: true, retryAfterSeconds: 0, scope: null };
    },

    async recordFailure(scope, subject) {
      const key = buildKey(scope, subject);
      const t = now();
      const existing = await store.get(key);

      if (!existing) {
        await store.save({
          key,
          scope,
          subject,
          attemptCount: 1,
          windowStartedAt: t,
          lastFailedAt: t,
          blockedUntil: null,
        });
        return;
      }

      if (isBlocked(existing, t)) return;

      const reset = isWindowExpired(existing, t);
      const attemptCount = reset ? 1 : existing.attemptCount + 1;
      const windowStartedAt = reset ? t : existing.windowStartedAt;
      const blockedUntil =
        attemptCount >= maxAttempts
          ? new Date(t.getTime() + lockoutSeconds * 1000)
          : null;

      await store.save({
        ...existing,
        attemptCount,
        windowStartedAt,
        lastFailedAt: t,
        blockedUntil,
      });
    },

    async clear(scope, subject) {
      await store.clear(buildKey(scope, subject));
    },
  };
}
