/**
 * Dependency injection configuration for tinyland-rate-limit.
 *
 * Allows consumers to provide their own logger, environment flags,
 * and error factory without coupling to any framework.
 */

/** Logger interface for rate limit and CSRF operations */
export interface RateLimitLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
}

/** Package configuration options */
export interface RateLimitPackageConfig {
  /** Logger instance. Defaults to noop. */
  getLogger?: () => RateLimitLogger;
  /** Whether running in production. Defaults to false. */
  isProduction?: boolean;
  /** Whether running in development. Defaults to false. */
  isDevelopment?: boolean;
  /** Factory for creating HTTP errors. Defaults to throwing plain objects. */
  createHttpError?: (status: number, message: string) => never;
  /** Cleanup interval for expired rate limit entries in ms. Defaults to 60000 (1 min). */
  cleanupIntervalMs?: number;
}

const noopLogger: RateLimitLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Default error factory that throws an object matching SvelteKit's error() shape */
function defaultCreateHttpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status, body: { message } });
}

let config: RateLimitPackageConfig = {};

/** Configure the rate limit package with custom dependencies */
export function configureRateLimit(c: RateLimitPackageConfig): void {
  config = { ...config, ...c };
}

/** Get the resolved configuration with defaults applied */
export function getRateLimitConfig(): Required<RateLimitPackageConfig> {
  return {
    getLogger: config.getLogger ?? (() => noopLogger),
    isProduction: config.isProduction ?? false,
    isDevelopment: config.isDevelopment ?? false,
    createHttpError: config.createHttpError ?? defaultCreateHttpError,
    cleanupIntervalMs: config.cleanupIntervalMs ?? 60000,
  };
}

/** Reset configuration to defaults (primarily for testing) */
export function resetRateLimitConfig(): void {
  config = {};
}
