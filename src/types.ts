/**
 * Framework-agnostic types for tinyland-rate-limit
 *
 * These abstract the SvelteKit-specific types (RequestEvent, Handle, error)
 * so the package can work with any framework.
 */

/** Cookie options for setting cookies */
export interface CookieOptions {
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  maxAge?: number;
}

/** Cookie jar interface (subset of SvelteKit Cookies) */
export interface CookieJar {
  get: (name: string) => string | undefined;
  set: (name: string, value: string, options?: CookieOptions) => void;
}

/** Request event interface (subset of SvelteKit RequestEvent) */
export interface MiddlewareRequestEvent {
  request: {
    method: string;
    headers: {
      get: (name: string) => string | null;
    };
  };
  url: {
    pathname: string;
  };
  cookies: CookieJar;
  locals: Record<string, unknown>;
  getClientAddress: () => string;
}

/** HTTP error type */
export interface HttpError {
  status: number;
  body: { message: string };
}

/** Resolve function type */
export type ResolveFn = (event: MiddlewareRequestEvent) => Promise<Response>;

/** Middleware handle type (matches SvelteKit Handle) */
export type MiddlewareHandle = (input: {
  event: MiddlewareRequestEvent;
  resolve: ResolveFn;
}) => Promise<Response>;

/** Rate limit configuration for a specific endpoint */
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (event: MiddlewareRequestEvent) => string;
  message?: string;
}

/** Rate limit store entry */
export interface RateLimitStore {
  hits: number;
  resetTime: number;
}
