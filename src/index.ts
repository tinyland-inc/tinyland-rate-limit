/**
 * @tinyland-inc/tinyland-rate-limit
 *
 * Framework-agnostic rate limiting and CSRF protection middleware.
 * Extracted from SvelteKit middleware for reuse across frameworks.
 */

// Configuration / DI
export {
  configureRateLimit,
  getRateLimitConfig,
  resetRateLimitConfig,
  type RateLimitLogger,
  type RateLimitPackageConfig,
} from './config.js';

// Types
export type {
  CookieJar,
  CookieOptions,
  HttpError,
  MiddlewareHandle,
  MiddlewareRequestEvent,
  RateLimitConfig,
  RateLimitStore,
  ResolveFn,
} from './types.js';

// Rate limiting
export {
  apiRateLimiter,
  clearStore,
  createRateLimiter,
  getStore,
  loginRateLimiter,
  passwordResetRateLimiter,
  rateLimit,
  rateLimitConfigs,
  startCleanup,
  stopCleanup,
  totpRateLimiter,
  userCreationRateLimiter,
} from './rate-limit.js';

// CSRF protection
export {
  csrf,
  CSRF_EXCLUDE_PATHS,
  csrfProtection,
  generateCSRFToken,
  getCSRFToken,
  setCSRFCookie,
  timingSafeEqual,
} from './csrf.js';
