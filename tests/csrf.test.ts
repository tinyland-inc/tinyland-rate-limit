import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateCSRFToken,
  csrfProtection,
  timingSafeEqual,
  setCSRFCookie,
  getCSRFToken,
  csrf,
  CSRF_EXCLUDE_PATHS,
} from '../src/csrf.js';
import { configureRateLimit, resetRateLimitConfig } from '../src/config.js';
import type { CookieJar, MiddlewareRequestEvent, ResolveFn } from '../src/types.js';





function createMockEvent(
  overrides: {
    method?: string;
    pathname?: string;
    ip?: string;
    cookieToken?: string;
    headerToken?: string;
    contentType?: string;
  } = {},
): MiddlewareRequestEvent {
  const cookieStore: Record<string, string> = {};
  if (overrides.cookieToken) {
    cookieStore['csrf_token'] = overrides.cookieToken;
  }

  return {
    request: {
      method: overrides.method ?? 'GET',
      headers: {
        get: vi.fn().mockImplementation((name: string) => {
          if (name === 'x-csrf-token') return overrides.headerToken ?? null;
          if (name === 'content-type') return overrides.contentType ?? null;
          return null;
        }),
      },
    },
    url: { pathname: overrides.pathname ?? '/' },
    cookies: {
      get: vi.fn().mockImplementation((name: string) => cookieStore[name]),
      set: vi.fn().mockImplementation((name: string, value: string) => {
        cookieStore[name] = value;
      }),
    },
    locals: {},
    getClientAddress: vi.fn().mockReturnValue(overrides.ip ?? '127.0.0.1'),
  };
}

function createMockResolve(): ResolveFn {
  return vi.fn().mockResolvedValue(
    new Response('OK', { status: 200, headers: new Headers() }),
  );
}





describe('csrf', () => {
  beforeEach(() => {
    resetRateLimitConfig();
  });

  
  
  
  describe('generateCSRFToken', () => {
    it('should return a string', () => {
      const token = generateCSRFToken();
      expect(typeof token).toBe('string');
    });

    it('should return a hex string', () => {
      const token = generateCSRFToken();
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it('should return a 64-character string (32 bytes hex)', () => {
      const token = generateCSRFToken();
      expect(token.length).toBe(64);
    });

    it('should return unique tokens', () => {
      const token1 = generateCSRFToken();
      const token2 = generateCSRFToken();
      expect(token1).not.toBe(token2);
    });

    it('should generate many unique tokens', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateCSRFToken());
      }
      expect(tokens.size).toBe(100);
    });
  });

  
  
  
  describe('timingSafeEqual', () => {
    it('should return true for equal strings', () => {
      expect(timingSafeEqual('abc', 'abc')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(timingSafeEqual('abc', 'def')).toBe(false);
    });

    it('should return false for different lengths', () => {
      expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    });

    it('should return true for empty strings', () => {
      
      
      expect(timingSafeEqual('', '')).toBe(true);
    });

    it('should return true for long equal strings', () => {
      const str = 'a'.repeat(1000);
      expect(timingSafeEqual(str, str)).toBe(true);
    });

    it('should return false when only one character differs', () => {
      expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
    });

    it('should handle hex token strings', () => {
      const token = generateCSRFToken();
      expect(timingSafeEqual(token, token)).toBe(true);
    });
  });

  
  
  
  describe('csrfProtection', () => {
    it('should skip GET requests', async () => {
      const event = createMockEvent({ method: 'GET', pathname: '/admin/dashboard' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip HEAD requests', async () => {
      const event = createMockEvent({ method: 'HEAD', pathname: '/admin/dashboard' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip OPTIONS requests', async () => {
      const event = createMockEvent({ method: 'OPTIONS', pathname: '/admin/dashboard' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip /api/health', async () => {
      const event = createMockEvent({ method: 'POST', pathname: '/api/health' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip /.well-known paths', async () => {
      const event = createMockEvent({
        method: 'POST',
        pathname: '/.well-known/openid-configuration',
      });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip /calendar paths', async () => {
      const event = createMockEvent({ method: 'POST', pathname: '/calendar/events' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip /login/totp paths', async () => {
      const event = createMockEvent({ method: 'POST', pathname: '/login/totp' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip /api/socket.io', async () => {
      const event = createMockEvent({ method: 'POST', pathname: '/api/socket.io' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip /admin/login (excluded path)', async () => {
      const event = createMockEvent({ method: 'POST', pathname: '/admin/login' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip /admin/verify (excluded path)', async () => {
      const event = createMockEvent({ method: 'POST', pathname: '/admin/verify' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip /api/admin/login (excluded path)', async () => {
      const event = createMockEvent({ method: 'POST', pathname: '/api/admin/login' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip /api/admin/verify (excluded path)', async () => {
      const event = createMockEvent({ method: 'POST', pathname: '/api/admin/verify' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip /api/csrf-token', async () => {
      const event = createMockEvent({ method: 'POST', pathname: '/api/csrf-token' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip /api/calendar', async () => {
      const event = createMockEvent({ method: 'POST', pathname: '/api/calendar' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip non-admin non-api routes', async () => {
      const event = createMockEvent({ method: 'POST', pathname: '/profile/update' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should skip non-admin public routes', async () => {
      const event = createMockEvent({ method: 'POST', pathname: '/contact' });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should throw 403 when no cookie token for API admin routes', async () => {
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
      });
      await expect(csrfProtection(event)).rejects.toHaveProperty('status', 403);
    });

    it('should throw 403 with "CSRF token missing" message for API routes', async () => {
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
      });
      try {
        await csrfProtection(event);
        expect.fail('Expected to throw');
      } catch (err: unknown) {
        expect((err as Error).message).toContain('CSRF token missing');
      }
    });

    it('should not throw for page admin routes without cookie', async () => {
      const event = createMockEvent({
        method: 'POST',
        pathname: '/admin/dashboard',
      });
      
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should throw 403 when no request token for API routes with cookie', async () => {
      const token = generateCSRFToken();
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
        cookieToken: token,
        
      });
      await expect(csrfProtection(event)).rejects.toHaveProperty('status', 403);
    });

    it('should throw 403 on token mismatch', async () => {
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
        cookieToken: 'aaa111bbb222ccc333ddd444eee555ff' + 'aaa111bbb222ccc333ddd444eee555ff',
        headerToken: 'fff555eee444ddd333ccc222bbb111aa' + 'fff555eee444ddd333ccc222bbb111aa',
      });
      await expect(csrfProtection(event)).rejects.toHaveProperty('status', 403);
    });

    it('should throw with "Invalid CSRF token" on mismatch', async () => {
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
        cookieToken: 'aaa111bbb222ccc333ddd444eee555ff' + 'aaa111bbb222ccc333ddd444eee555ff',
        headerToken: 'fff555eee444ddd333ccc222bbb111aa' + 'fff555eee444ddd333ccc222bbb111aa',
      });
      try {
        await csrfProtection(event);
        expect.fail('Expected to throw');
      } catch (err: unknown) {
        expect((err as Error).message).toContain('Invalid CSRF token');
      }
    });

    it('should pass on valid token match', async () => {
      const token = generateCSRFToken();
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
        cookieToken: token,
        headerToken: token,
      });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should validate tokens for /api/admin/* paths', async () => {
      const token = generateCSRFToken();
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/users',
        cookieToken: token,
        headerToken: token,
      });
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should not validate page admin routes with cookie (non-API)', async () => {
      const token = generateCSRFToken();
      const event = createMockEvent({
        method: 'POST',
        pathname: '/admin/settings',
        cookieToken: token,
        
      });
      
      await expect(csrfProtection(event)).resolves.toBeUndefined();
    });

    it('should log debug in development for excluded paths', async () => {
      const debugFn = vi.fn();
      configureRateLimit({
        isDevelopment: true,
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: debugFn,
        }),
      });

      const event = createMockEvent({ method: 'POST', pathname: '/api/health' });
      await csrfProtection(event);
      expect(debugFn).toHaveBeenCalled();
    });

    it('should not log debug in production for excluded paths', async () => {
      const debugFn = vi.fn();
      configureRateLimit({
        isDevelopment: false,
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: debugFn,
        }),
      });

      const event = createMockEvent({ method: 'POST', pathname: '/api/health' });
      await csrfProtection(event);
      expect(debugFn).not.toHaveBeenCalled();
    });
  });

  
  
  
  describe('CSRF_EXCLUDE_PATHS', () => {
    it('should include /api/health', () => {
      expect(CSRF_EXCLUDE_PATHS).toContain('/api/health');
    });

    it('should include /api/csrf-token', () => {
      expect(CSRF_EXCLUDE_PATHS).toContain('/api/csrf-token');
    });

    it('should include /.well-known', () => {
      expect(CSRF_EXCLUDE_PATHS).toContain('/.well-known');
    });

    it('should include /admin/login', () => {
      expect(CSRF_EXCLUDE_PATHS).toContain('/admin/login');
    });

    it('should include /admin/verify', () => {
      expect(CSRF_EXCLUDE_PATHS).toContain('/admin/verify');
    });

    it('should include /api/admin/login', () => {
      expect(CSRF_EXCLUDE_PATHS).toContain('/api/admin/login');
    });

    it('should include /api/admin/verify', () => {
      expect(CSRF_EXCLUDE_PATHS).toContain('/api/admin/verify');
    });

    it('should include /login/totp', () => {
      expect(CSRF_EXCLUDE_PATHS).toContain('/login/totp');
    });

    it('should include /api/socket.io', () => {
      expect(CSRF_EXCLUDE_PATHS).toContain('/api/socket.io');
    });

    it('should include /calendar', () => {
      expect(CSRF_EXCLUDE_PATHS).toContain('/calendar');
    });

    it('should include /api/calendar', () => {
      expect(CSRF_EXCLUDE_PATHS).toContain('/api/calendar');
    });

    it('should have 11 entries', () => {
      expect(CSRF_EXCLUDE_PATHS.length).toBe(11);
    });
  });

  
  
  
  describe('setCSRFCookie', () => {
    it('should set cookie with correct name', () => {
      const cookies: CookieJar = { get: vi.fn(), set: vi.fn() };
      const token = generateCSRFToken();
      setCSRFCookie(cookies, token);
      expect(cookies.set).toHaveBeenCalledWith(
        'csrf_token',
        token,
        expect.any(Object),
      );
    });

    it('should set path to "/"', () => {
      const cookies: CookieJar = { get: vi.fn(), set: vi.fn() };
      setCSRFCookie(cookies, 'test');
      expect(cookies.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ path: '/' }),
      );
    });

    it('should set httpOnly to true', () => {
      const cookies: CookieJar = { get: vi.fn(), set: vi.fn() };
      setCSRFCookie(cookies, 'test');
      expect(cookies.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it('should set secure to false when not production', () => {
      configureRateLimit({ isProduction: false });
      const cookies: CookieJar = { get: vi.fn(), set: vi.fn() };
      setCSRFCookie(cookies, 'test');
      expect(cookies.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ secure: false }),
      );
    });

    it('should set secure to true when production', () => {
      configureRateLimit({ isProduction: true });
      const cookies: CookieJar = { get: vi.fn(), set: vi.fn() };
      setCSRFCookie(cookies, 'test');
      expect(cookies.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ secure: true }),
      );
    });

    it('should set sameSite to "lax"', () => {
      const cookies: CookieJar = { get: vi.fn(), set: vi.fn() };
      setCSRFCookie(cookies, 'test');
      expect(cookies.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ sameSite: 'lax' }),
      );
    });

    it('should set maxAge to 86400 (24 hours)', () => {
      const cookies: CookieJar = { get: vi.fn(), set: vi.fn() };
      setCSRFCookie(cookies, 'test');
      expect(cookies.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ maxAge: 60 * 60 * 24 }),
      );
    });

    it('should set the token value', () => {
      const cookies: CookieJar = { get: vi.fn(), set: vi.fn() };
      const token = 'mytoken123';
      setCSRFCookie(cookies, token);
      expect(cookies.set).toHaveBeenCalledWith('csrf_token', token, expect.any(Object));
    });
  });

  
  
  
  describe('getCSRFToken', () => {
    it('should return existing token from cookie', () => {
      const existingToken = 'existing-token-value';
      const cookies: CookieJar = {
        get: vi.fn().mockReturnValue(existingToken),
        set: vi.fn(),
      };
      const token = getCSRFToken(cookies);
      expect(token).toBe(existingToken);
    });

    it('should not set cookie when token exists', () => {
      const cookies: CookieJar = {
        get: vi.fn().mockReturnValue('existing'),
        set: vi.fn(),
      };
      getCSRFToken(cookies);
      expect(cookies.set).not.toHaveBeenCalled();
    });

    it('should generate new token when no cookie', () => {
      const cookies: CookieJar = {
        get: vi.fn().mockReturnValue(undefined),
        set: vi.fn(),
      };
      const token = getCSRFToken(cookies);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should set cookie for new token', () => {
      const cookies: CookieJar = {
        get: vi.fn().mockReturnValue(undefined),
        set: vi.fn(),
      };
      const token = getCSRFToken(cookies);
      expect(cookies.set).toHaveBeenCalledWith('csrf_token', token, expect.any(Object));
    });

    it('should return a valid hex token when generating', () => {
      const cookies: CookieJar = {
        get: vi.fn().mockReturnValue(undefined),
        set: vi.fn(),
      };
      const token = getCSRFToken(cookies);
      expect(token.length).toBe(64);
      expect(token).toMatch(/^[0-9a-f]+$/);
    });
  });

  
  
  
  describe('csrf middleware Handle', () => {
    it('should call csrfProtection and resolve on success', async () => {
      const event = createMockEvent({ method: 'GET', pathname: '/' });
      const resolve = createMockResolve();
      const response = await csrf({ event, resolve });
      expect(resolve).toHaveBeenCalledWith(event);
      expect(response.status).toBe(200);
    });

    it('should resolve for safe methods', async () => {
      const resolve = createMockResolve();
      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        const event = createMockEvent({ method, pathname: '/admin/dashboard' });
        await csrf({ event, resolve });
      }
      expect(resolve).toHaveBeenCalledTimes(3);
    });

    it('should allow login page through on error', async () => {
      const event = createMockEvent({
        method: 'POST',
        pathname: '/admin/login',
      });
      const resolve = createMockResolve();
      
      
      const response = await csrf({ event, resolve });
      expect(response.status).toBe(200);
    });

    it('should allow verify page through on error', async () => {
      const event = createMockEvent({
        method: 'POST',
        pathname: '/admin/verify',
      });
      const resolve = createMockResolve();
      const response = await csrf({ event, resolve });
      expect(response.status).toBe(200);
    });

    it('should allow /api/admin/login through on error', async () => {
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/login',
      });
      const resolve = createMockResolve();
      const response = await csrf({ event, resolve });
      expect(response.status).toBe(200);
    });

    it('should allow /api/admin/verify through on error', async () => {
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/verify',
      });
      const resolve = createMockResolve();
      const response = await csrf({ event, resolve });
      expect(response.status).toBe(200);
    });

    it('should re-throw HttpError for admin API routes', async () => {
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
        
      });
      const resolve = createMockResolve();
      await expect(csrf({ event, resolve })).rejects.toHaveProperty('status', 403);
    });

    it('should throw 403 for admin routes when token is invalid', async () => {
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
        cookieToken: 'a'.repeat(64),
        headerToken: 'b'.repeat(64),
      });
      const resolve = createMockResolve();
      await expect(csrf({ event, resolve })).rejects.toHaveProperty('status', 403);
    });

    it('should log warning for non-admin route errors', async () => {
      const warnFn = vi.fn();
      configureRateLimit({
        getLogger: () => ({
          info: vi.fn(),
          warn: warnFn,
          error: vi.fn(),
          debug: vi.fn(),
        }),
        
        createHttpError: (status: number, message: string): never => {
          throw Object.assign(new Error(message), { status, body: { message } });
        },
      });

      
      
      const event = createMockEvent({ method: 'POST', pathname: '/public' });
      const resolve = createMockResolve();
      await csrf({ event, resolve });
      
    });

    it('should log error details when csrfProtection throws', async () => {
      const errorFn = vi.fn();
      configureRateLimit({
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: errorFn,
          debug: vi.fn(),
        }),
      });

      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
        
      });
      const resolve = createMockResolve();

      try {
        await csrf({ event, resolve });
      } catch {
        
      }

      expect(errorFn).toHaveBeenCalled();
    });

    it('should pass valid CSRF through for admin API', async () => {
      const token = generateCSRFToken();
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
        cookieToken: token,
        headerToken: token,
      });
      const resolve = createMockResolve();
      const response = await csrf({ event, resolve });
      expect(response.status).toBe(200);
    });

    it('should not block non-admin routes even without CSRF', async () => {
      const event = createMockEvent({
        method: 'POST',
        pathname: '/public/form',
      });
      const resolve = createMockResolve();
      const response = await csrf({ event, resolve });
      expect(response.status).toBe(200);
    });
  });

  
  
  
  describe('DI config integration', () => {
    it('should use isDevelopment from config for debug logging', async () => {
      const debugFn = vi.fn();
      configureRateLimit({
        isDevelopment: true,
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: debugFn,
        }),
      });

      const token = generateCSRFToken();
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
        cookieToken: token,
        headerToken: token,
      });
      await csrfProtection(event);
      
      expect(debugFn).toHaveBeenCalled();
    });

    it('should not debug log when isDevelopment is false', async () => {
      const debugFn = vi.fn();
      configureRateLimit({
        isDevelopment: false,
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: debugFn,
        }),
      });

      const token = generateCSRFToken();
      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
        cookieToken: token,
        headerToken: token,
      });
      await csrfProtection(event);
      expect(debugFn).not.toHaveBeenCalled();
    });

    it('should use isProduction for secure cookie flag', () => {
      configureRateLimit({ isProduction: true });
      const cookies: CookieJar = { get: vi.fn(), set: vi.fn() };
      setCSRFCookie(cookies, 'token');
      expect(cookies.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ secure: true }),
      );
    });

    it('should use logger from config for error logging', async () => {
      const errorFn = vi.fn();
      configureRateLimit({
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: errorFn,
          debug: vi.fn(),
        }),
      });

      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
      });

      try {
        await csrfProtection(event);
      } catch {
        
      }

      expect(errorFn).toHaveBeenCalled();
    });

    it('should use createHttpError from config', async () => {
      const customError = vi.fn().mockImplementation(
        (status: number, message: string): never => {
          throw Object.assign(new Error(message), { status, body: { message } });
        },
      );
      configureRateLimit({ createHttpError: customError });

      const event = createMockEvent({
        method: 'POST',
        pathname: '/api/admin/settings',
      });

      try {
        await csrfProtection(event);
      } catch {
        
      }

      expect(customError).toHaveBeenCalledWith(403, expect.any(String));
    });
  });
});
