/**
 * In-memory rate limiter with configurable windows and presets.
 *
 * Framework-agnostic implementation extracted from SvelteKit middleware.
 * Uses dependency injection for logging and error handling.
 */

import { getRateLimitConfig } from './config.js';
import type {
  MiddlewareHandle,
  MiddlewareRequestEvent,
  RateLimitConfig,
  RateLimitStore,
} from './types.js';

// In-memory store (consider using Redis in production)
const rateLimitStore = new Map<string, RateLimitStore>();

// Handle for the cleanup interval so it can be stopped
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/** Start the periodic cleanup of expired entries */
export function startCleanup(): void {
  stopCleanup();
  const config = getRateLimitConfig();
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitStore.entries()) {
      if (value.resetTime <= now) {
        rateLimitStore.delete(key);
      }
    }
  }, config.cleanupIntervalMs);
  cleanupInterval.unref();
}

/** Stop the periodic cleanup */
export function stopCleanup(): void {
  if (cleanupInterval !== null) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/** Clear all entries from the rate limit store (for testing) */
export function clearStore(): void {
  rateLimitStore.clear();
}

/** Get the internal store (for testing) */
export function getStore(): Map<string, RateLimitStore> {
  return rateLimitStore;
}

// Start cleanup on module load
startCleanup();

// Default configs for different endpoints
export const rateLimitConfigs = {
  // Very strict for login attempts
  login: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    skipSuccessfulRequests: true,
    message: 'Too many login attempts. Please try again later.',
  } satisfies RateLimitConfig,

  // Strict for password reset
  passwordReset: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 3,
    message: 'Too many password reset requests. Please try again later.',
  } satisfies RateLimitConfig,

  // Moderate for user creation
  userCreation: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10,
    message: 'Too many user creation requests. Please try again later.',
  } satisfies RateLimitConfig,

  // General API rate limit
  api: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    message: 'Too many requests. Please slow down.',
  } satisfies RateLimitConfig,

  // Very strict for TOTP verification
  totp: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    skipSuccessfulRequests: true,
    message: 'Too many verification attempts. Please try again later.',
  } satisfies RateLimitConfig,
};

/** Default key generator (IP + path based) */
function defaultKeyGenerator(event: MiddlewareRequestEvent): string {
  const ip = event.getClientAddress();
  const path = event.url.pathname;
  return `${ip}:${path}`;
}

/** Create a rate limiter function for a given configuration */
export function createRateLimiter(
  config: RateLimitConfig,
): (event: MiddlewareRequestEvent) => Promise<void> {
  return async (event: MiddlewareRequestEvent): Promise<void> => {
    const keyGenerator = config.keyGenerator ?? defaultKeyGenerator;
    const key = keyGenerator(event);
    const now = Date.now();

    // Get or create rate limit entry
    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime <= now) {
      // Create new entry
      entry = {
        hits: 1,
        resetTime: now + config.windowMs,
      };
      rateLimitStore.set(key, entry);
      return;
    }

    // Check if limit exceeded
    if (entry.hits >= config.maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      const errorMessage = `${config.message ?? 'Too many requests'} (retry after ${retryAfter}s)`;

      const { createHttpError } = getRateLimitConfig();
      createHttpError(429, errorMessage);
    }

    // Increment hit count
    entry.hits++;
  };
}

// Pre-built rate limiters for specific routes
export const loginRateLimiter = createRateLimiter(rateLimitConfigs.login);
export const passwordResetRateLimiter = createRateLimiter(rateLimitConfigs.passwordReset);
export const userCreationRateLimiter = createRateLimiter(rateLimitConfigs.userCreation);
export const apiRateLimiter = createRateLimiter(rateLimitConfigs.api);
export const totpRateLimiter = createRateLimiter(rateLimitConfigs.totp);

/** Global rate limit middleware handle */
export const rateLimit: MiddlewareHandle = async ({ event, resolve }) => {
  // Skip rate limiting for static assets
  if (
    event.url.pathname.startsWith('/_app') ||
    event.url.pathname.startsWith('/favicon') ||
    event.url.pathname.endsWith('.css') ||
    event.url.pathname.endsWith('.js')
  ) {
    return resolve(event);
  }

  const logger = getRateLimitConfig().getLogger();

  try {
    // Apply specific rate limiters based on path
    if (event.url.pathname === '/admin/login' && event.request.method === 'POST') {
      await loginRateLimiter(event);
    } else if (event.url.pathname === '/admin/verify' && event.request.method === 'POST') {
      await totpRateLimiter(event);
    } else if (
      event.url.pathname === '/api/admin/users' &&
      event.request.method === 'POST'
    ) {
      await userCreationRateLimiter(event);
    } else if (event.url.pathname.includes('/reset-password')) {
      await passwordResetRateLimiter(event);
    } else if (event.url.pathname.startsWith('/api/')) {
      await apiRateLimiter(event);
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    // Don't throw error for rate limit issues, just continue
    logger.error('Rate limit error:', { error: String(err) });
  }

  const response = await resolve(event);

  // Add rate limit headers
  const key = defaultKeyGenerator(event);
  const entry = rateLimitStore.get(key);

  if (entry) {
    const remaining = Math.max(0, rateLimitConfigs.api.maxRequests - entry.hits);
    const reset = Math.ceil(entry.resetTime / 1000);

    response.headers.set('X-RateLimit-Limit', rateLimitConfigs.api.maxRequests.toString());
    response.headers.set('X-RateLimit-Remaining', remaining.toString());
    response.headers.set('X-RateLimit-Reset', reset.toString());
  }

  return response;
};
