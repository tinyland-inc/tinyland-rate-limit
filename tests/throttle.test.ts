import { describe, expect, it, vi } from "vitest";
import {
  createCompositeThrottleStore,
  createMemoryThrottleStore,
  createThrottle,
  pgThrottleTableDdl,
  type ThrottleStore,
} from "../src/throttle.js";

const cfg = (overrides = {}) => ({
  maxAttempts: 3,
  windowSeconds: 60,
  lockoutSeconds: 120,
  store: createMemoryThrottleStore(),
  ...overrides,
});

describe("createMemoryThrottleStore", () => {
  it("stores and retrieves records", async () => {
    const store = createMemoryThrottleStore();
    const record = {
      key: "pin:alice",
      scope: "pin",
      subject: "alice",
      attemptCount: 1,
      windowStartedAt: new Date(),
      lastFailedAt: new Date(),
      blockedUntil: null,
    };
    await store.save(record);
    expect(await store.get("pin:alice")).toEqual(record);
  });

  it("returns null for missing keys", async () => {
    const store = createMemoryThrottleStore();
    expect(await store.get("missing")).toBeNull();
  });

  it("clears records", async () => {
    const store = createMemoryThrottleStore();
    await store.save({
      key: "x",
      scope: "s",
      subject: "u",
      attemptCount: 1,
      windowStartedAt: new Date(),
      lastFailedAt: new Date(),
      blockedUntil: null,
    });
    await store.clear("x");
    expect(await store.get("x")).toBeNull();
  });
});

describe("createCompositeThrottleStore", () => {
  it("uses primary when healthy", async () => {
    const primary = createMemoryThrottleStore();
    const fallback = createMemoryThrottleStore();
    const composite = createCompositeThrottleStore(primary, fallback);
    await composite.save({
      key: "x",
      scope: "s",
      subject: "u",
      attemptCount: 1,
      windowStartedAt: new Date(),
      lastFailedAt: new Date(),
      blockedUntil: null,
    });
    expect(await primary.get("x")).not.toBeNull();
    expect(await fallback.get("x")).toBeNull();
  });

  it("falls back when primary throws", async () => {
    const primary: ThrottleStore = {
      get: vi.fn().mockRejectedValue(new Error("pg down")),
      save: vi.fn().mockRejectedValue(new Error("pg down")),
      clear: vi.fn().mockRejectedValue(new Error("pg down")),
    };
    const fallback = createMemoryThrottleStore();
    const composite = createCompositeThrottleStore(primary, fallback);
    await composite.save({
      key: "x",
      scope: "s",
      subject: "u",
      attemptCount: 1,
      windowStartedAt: new Date(),
      lastFailedAt: new Date(),
      blockedUntil: null,
    });
    expect(await fallback.get("x")).not.toBeNull();
  });
});

describe("pgThrottleTableDdl", () => {
  it("emits valid SQL with default table name", () => {
    const ddl = pgThrottleTableDdl();
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS pin_auth_throttles");
    expect(ddl).toContain("PRIMARY KEY");
    expect(ddl).toContain("CREATE INDEX IF NOT EXISTS");
  });

  it("respects custom table name", () => {
    const ddl = pgThrottleTableDdl("my_throttles");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS my_throttles");
    expect(ddl).toContain("ON my_throttles");
  });
});

describe("createThrottle", () => {
  it("allows under maxAttempts", async () => {
    const t = createThrottle(cfg());
    expect((await t.check("pin", "alice")).allowed).toBe(true);
    await t.recordFailure("pin", "alice");
    expect((await t.check("pin", "alice")).allowed).toBe(true);
    await t.recordFailure("pin", "alice");
    expect((await t.check("pin", "alice")).allowed).toBe(true);
  });

  it("blocks at maxAttempts and reports retryAfterSeconds", async () => {
    const t = createThrottle(cfg());
    await t.recordFailure("pin", "alice");
    await t.recordFailure("pin", "alice");
    await t.recordFailure("pin", "alice");
    const status = await t.check("pin", "alice");
    expect(status.allowed).toBe(false);
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
    expect(status.retryAfterSeconds).toBeLessThanOrEqual(120);
    expect(status.scope).toBe("pin");
  });

  it("clear resets state", async () => {
    const t = createThrottle(cfg());
    await t.recordFailure("pin", "alice");
    await t.recordFailure("pin", "alice");
    await t.recordFailure("pin", "alice");
    expect((await t.check("pin", "alice")).allowed).toBe(false);
    await t.clear("pin", "alice");
    expect((await t.check("pin", "alice")).allowed).toBe(true);
  });

  it("isolates different scopes for the same subject", async () => {
    const t = createThrottle(cfg());
    await t.recordFailure("pin", "alice");
    await t.recordFailure("pin", "alice");
    await t.recordFailure("pin", "alice");
    expect((await t.check("pin", "alice")).allowed).toBe(false);
    expect((await t.check("password", "alice")).allowed).toBe(true);
  });

  it("expires sliding window and resets attempts", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const t = createThrottle(cfg({ now: () => now }));

    await t.recordFailure("pin", "alice");
    await t.recordFailure("pin", "alice");
    expect((await t.check("pin", "alice")).allowed).toBe(true);

    // jump past the 60s window
    now = new Date("2026-01-01T00:01:30Z");
    await t.recordFailure("pin", "alice");

    // window resets, only one attempt counted
    const store = createMemoryThrottleStore();
    // Resetting check via fresh inspection through API
    expect((await t.check("pin", "alice")).allowed).toBe(true);
  });

  it("ignores recordFailure during active block", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const store = createMemoryThrottleStore();
    const t = createThrottle(cfg({ store, now: () => now }));

    await t.recordFailure("pin", "alice");
    await t.recordFailure("pin", "alice");
    await t.recordFailure("pin", "alice");

    const recordBefore = await store.get("pin:alice");
    expect(recordBefore?.attemptCount).toBe(3);

    // try more failures during lockout — should not increment
    await t.recordFailure("pin", "alice");
    const recordAfter = await store.get("pin:alice");
    expect(recordAfter?.attemptCount).toBe(3);
  });

  it("retryAfterSeconds becomes 0 after lockout expires", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const t = createThrottle(cfg({ now: () => now }));

    await t.recordFailure("pin", "alice");
    await t.recordFailure("pin", "alice");
    await t.recordFailure("pin", "alice");

    // jump past lockout (120s)
    now = new Date("2026-01-01T00:03:00Z");

    const status = await t.check("pin", "alice");
    expect(status.allowed).toBe(true);
    expect(status.retryAfterSeconds).toBe(0);
  });
});
