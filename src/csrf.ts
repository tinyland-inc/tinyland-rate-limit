/**
 * CSRF token protection middleware.
 *
 * Framework-agnostic implementation extracted from SvelteKit middleware.
 * Uses dependency injection for logging, environment detection, and error handling.
 */

import crypto from 'crypto';
import { getRateLimitConfig } from './config.js';
import type { CookieJar, MiddlewareHandle, MiddlewareRequestEvent } from './types.js';

const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

// Safe methods that don't require CSRF protection
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// Paths that should be excluded from CSRF protection
export const CSRF_EXCLUDE_PATHS = [
  '/api/health',
  '/api/csrf-token',
  '/.well-known',
  '/api/calendar',
  '/calendar',
  '/login/totp',
  '/api/socket.io',
  '/admin/login',
  '/admin/verify',
  '/api/admin/login',
  '/api/admin/verify',
];

/** Generate a secure CSRF token */
export function generateCSRFToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/** Get CSRF token from request (header) */
function getTokenFromRequest(event: MiddlewareRequestEvent): string | null {
  // Check header first
  const headerToken = event.request.headers.get(CSRF_HEADER_NAME);
  if (headerToken) {
    return headerToken;
  }

  // Check form data for non-JSON requests
  const contentType = event.request.headers.get('content-type') ?? '';
  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    // This will be handled in the actual route handlers
    // as we can't consume the body here
    return null;
  }

  return null;
}

/** Timing-safe string comparison */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  return crypto.timingSafeEqual(bufferA, bufferB);
}

/** CSRF protection middleware function */
export async function csrfProtection(event: MiddlewareRequestEvent): Promise<void> {
  const { isDevelopment, createHttpError } = getRateLimitConfig();
  const logger = getRateLimitConfig().getLogger();

  // Skip CSRF for safe methods
  if (SAFE_METHODS.includes(event.request.method)) {
    return;
  }

  // Skip CSRF for excluded paths
  if (CSRF_EXCLUDE_PATHS.some((path) => event.url.pathname.startsWith(path))) {
    if (isDevelopment) {
      logger.debug('[CSRF] Skipping protection for excluded path:', {
        pathname: event.url.pathname,
      });
    }
    return;
  }

  // Skip CSRF for non-admin routes
  if (
    !event.url.pathname.startsWith('/admin') &&
    !event.url.pathname.startsWith('/api/admin')
  ) {
    return;
  }

  // Get token from cookie
  const cookieToken = event.cookies.get(CSRF_COOKIE_NAME);

  // If no cookie token, this might be the first request
  if (!cookieToken) {
    // For API routes (excluding login/verify), this is an error
    if (event.url.pathname.startsWith('/api')) {
      logger.error('[CSRF] No token for API route:', { pathname: event.url.pathname });
      createHttpError(403, 'CSRF token missing');
    }
    // For page routes, we'll generate one in the load function
    if (isDevelopment) {
      logger.debug('[CSRF] No token for page route, will be set in load:', {
        pathname: event.url.pathname,
      });
    }
    return;
  }

  // For API routes, validate the token
  if (event.url.pathname.startsWith('/api')) {
    const requestToken = getTokenFromRequest(event);

    if (!requestToken) {
      logger.error('[CSRF] Token not provided in request for:', {
        pathname: event.url.pathname,
      });
      createHttpError(403, 'CSRF token not provided in request');
    }

    if (!timingSafeEqual(cookieToken, requestToken!)) {
      logger.error('[CSRF] Token mismatch for:', { pathname: event.url.pathname });
      createHttpError(403, 'Invalid CSRF token');
    }

    if (isDevelopment) {
      logger.debug('[CSRF] Token validated successfully for:', {
        pathname: event.url.pathname,
      });
    }
  }
}

/** Helper to set CSRF cookie */
export function setCSRFCookie(cookies: CookieJar, token: string): void {
  const { isProduction } = getRateLimitConfig();
  cookies.set(CSRF_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24, // 24 hours
  });
}

/** Helper to get CSRF token for forms (creates one if missing) */
export function getCSRFToken(cookies: CookieJar): string {
  let token = cookies.get(CSRF_COOKIE_NAME);

  if (!token) {
    token = generateCSRFToken();
    setCSRFCookie(cookies, token);
  }

  return token;
}

/** Middleware handle function for CSRF protection */
export const csrf: MiddlewareHandle = async ({ event, resolve }) => {
  const { isDevelopment, createHttpError } = getRateLimitConfig();
  const logger = getRateLimitConfig().getLogger();

  try {
    await csrfProtection(event);
  } catch (err) {
    // Log the error with details
    logger.error('[CSRF] Validation error:', {
      path: event.url.pathname,
      method: event.request.method,
      hasCookie: !!event.cookies.get(CSRF_COOKIE_NAME),
      error: String(err),
    });

    // Only throw CSRF errors for admin routes
    if (
      event.url.pathname.startsWith('/admin') ||
      event.url.pathname.startsWith('/api/admin')
    ) {
      // Don't block login/verify pages - they need to load to set the token
      if (
        event.url.pathname === '/admin/login' ||
        event.url.pathname === '/admin/verify' ||
        event.url.pathname === '/api/admin/login' ||
        event.url.pathname === '/api/admin/verify'
      ) {
        if (isDevelopment) {
          logger.debug('[CSRF] Allowing access to login/verify page to set CSRF token');
        }
        return resolve(event);
      }

      if (err && typeof err === 'object' && 'status' in err) {
        throw err;
      }
      createHttpError(403, 'CSRF validation error');
    }
    // For non-admin routes, log but don't block
    logger.warn('[CSRF] Non-admin route validation warning:', {
      pathname: event.url.pathname,
    });
  }

  return resolve(event);
};
