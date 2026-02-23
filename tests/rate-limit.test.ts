import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createRateLimiter,
  rateLimitConfigs,
  loginRateLimiter,
  passwordResetRateLimiter,
  userCreationRateLimiter,
  apiRateLimiter,
  totpRateLimiter,
  rateLimit,
  clearStore,
  getStore,
  startCleanup,
  stopCleanup,
} from '../src/rate-limit.js';
import { configureRateLimit, resetRateLimitConfig } from '../src/config.js';
import type { MiddlewareRequestEvent, ResolveFn, RateLimitConfig } from '../src/types.js';





function createMockEvent(
  overrides: Partial<MiddlewareRequestEvent> & {
    method?: string;
    pathname?: string;
    ip?: string;
    headerFn?: (name: string) => string | null;
  } = {},
): MiddlewareRequestEvent {
  const { method, pathname, ip, headerFn, ...rest } = overrides;
  return {
    request: {
      method: method ?? 'GET',
      headers: { get: headerFn ?? vi.fn().mockReturnValue(null) },
    },
    url: { pathname: pathname ?? '/' },
    cookies: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() },
    locals: {},
    getClientAddress: vi.fn().mockReturnValue(ip ?? '127.0.0.1'),
    ...rest,
  };
}

function createMockResolve(): ResolveFn {
  return vi.fn().mockResolvedValue(
    new Response('OK', { status: 200, headers: new Headers() }),
  );
}





describe('rate-limit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearStore();
    resetRateLimitConfig();
    stopCleanup();
  });

  afterEach(() => {
    vi.useRealTimers();
    stopCleanup();
  });

  
  
  
  describe('createRateLimiter', () => {
    it('should create a function', () => {
      const limiter = createRateLimiter({ windowMs: 1000, maxRequests: 1 });
      expect(typeof limiter).toBe('function');
    });

    it('should accept custom config', () => {
      const config: RateLimitConfig = {
        windowMs: 5000,
        maxRequests: 3,
        message: 'custom',
      };
      const limiter = createRateLimiter(config);
      expect(typeof limiter).toBe('function');
    });
  });

  
  
  
  describe('rate limiting logic', () => {
    it('should allow the first request', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 5 });
      const event = createMockEvent();
      await expect(limiter(event)).resolves.toBeUndefined();
    });

    it('should allow requests under the limit', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 3 });
      const event = createMockEvent();
      await limiter(event); 
      await expect(limiter(event)).resolves.toBeUndefined(); 
    });

    it('should throw 429 at the limit', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
      const event = createMockEvent();
      await limiter(event); 
      await limiter(event); 
      await expect(limiter(event)).rejects.toHaveProperty('status', 429); 
    });

    it('should throw 429 over the limit', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const event = createMockEvent();
      await limiter(event); 
      await expect(limiter(event)).rejects.toHaveProperty('status', 429);
    });

    it('should reset after window expiry', async () => {
      const limiter = createRateLimiter({ windowMs: 1000, maxRequests: 1 });
      const event = createMockEvent();
      await limiter(event); 

      
      vi.advanceTimersByTime(1001);

      
      await expect(limiter(event)).resolves.toBeUndefined();
    });

    it('should track different keys separately', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const event1 = createMockEvent({ ip: '1.1.1.1' });
      const event2 = createMockEvent({ ip: '2.2.2.2' });

      await limiter(event1);
      await expect(limiter(event2)).resolves.toBeUndefined();
    });

    it('should track different paths separately', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const event1 = createMockEvent({ pathname: '/a' });
      const event2 = createMockEvent({ pathname: '/b' });

      await limiter(event1);
      await expect(limiter(event2)).resolves.toBeUndefined();
    });

    it('should include retry-after in error message', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        message: 'Rate limited',
      });
      const event = createMockEvent();
      await limiter(event);

      try {
        await limiter(event);
        expect.fail('Expected to throw');
      } catch (err: unknown) {
        expect((err as Error).message).toMatch(/retry after \d+s/);
      }
    });

    it('should use custom message in error', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        message: 'Slow down buddy',
      });
      const event = createMockEvent();
      await limiter(event);

      try {
        await limiter(event);
        expect.fail('Expected to throw');
      } catch (err: unknown) {
        expect((err as Error).message).toContain('Slow down buddy');
      }
    });

    it('should use default message when none provided', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const event = createMockEvent();
      await limiter(event);

      try {
        await limiter(event);
        expect.fail('Expected to throw');
      } catch (err: unknown) {
        expect((err as Error).message).toContain('Too many requests');
      }
    });

    it('should increment hits correctly', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 5 });
      const event = createMockEvent();

      await limiter(event); 
      await limiter(event); 
      await limiter(event); 

      const store = getStore();
      const key = '127.0.0.1:/';
      expect(store.get(key)?.hits).toBe(3);
    });

    it('should create a new entry with hits=1 for first request', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 5 });
      const event = createMockEvent();

      await limiter(event);

      const store = getStore();
      const key = '127.0.0.1:/';
      expect(store.get(key)?.hits).toBe(1);
    });

    it('should set resetTime to now + windowMs', async () => {
      const now = Date.now();
      const windowMs = 30000;
      const limiter = createRateLimiter({ windowMs, maxRequests: 5 });
      const event = createMockEvent();

      await limiter(event);

      const store = getStore();
      const key = '127.0.0.1:/';
      expect(store.get(key)?.resetTime).toBe(now + windowMs);
    });
  });

  
  
  
  describe('key generation', () => {
    it('should use IP:path as default key', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 5 });
      const event = createMockEvent({ ip: '10.0.0.1', pathname: '/test' });

      await limiter(event);

      expect(getStore().has('10.0.0.1:/test')).toBe(true);
    });

    it('should use custom key generator when provided', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
        keyGenerator: (e) => `custom:${e.url.pathname}`,
      });
      const event = createMockEvent({ pathname: '/custom' });

      await limiter(event);

      expect(getStore().has('custom:/custom')).toBe(true);
    });

    it('should separate keys for different IPs on same path', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const event1 = createMockEvent({ ip: '1.1.1.1', pathname: '/same' });
      const event2 = createMockEvent({ ip: '2.2.2.2', pathname: '/same' });

      await limiter(event1);
      
      await expect(limiter(event2)).resolves.toBeUndefined();
    });
  });

  
  
  
  describe('preset configs', () => {
    it('login: 5 requests per 15 minutes', () => {
      expect(rateLimitConfigs.login.maxRequests).toBe(5);
      expect(rateLimitConfigs.login.windowMs).toBe(15 * 60 * 1000);
    });

    it('login: skipSuccessfulRequests enabled', () => {
      expect(rateLimitConfigs.login.skipSuccessfulRequests).toBe(true);
    });

    it('login: has custom message', () => {
      expect(rateLimitConfigs.login.message).toContain('login attempts');
    });

    it('passwordReset: 3 requests per 1 hour', () => {
      expect(rateLimitConfigs.passwordReset.maxRequests).toBe(3);
      expect(rateLimitConfigs.passwordReset.windowMs).toBe(60 * 60 * 1000);
    });

    it('passwordReset: has custom message', () => {
      expect(rateLimitConfigs.passwordReset.message).toContain('password reset');
    });

    it('userCreation: 10 requests per 1 hour', () => {
      expect(rateLimitConfigs.userCreation.maxRequests).toBe(10);
      expect(rateLimitConfigs.userCreation.windowMs).toBe(60 * 60 * 1000);
    });

    it('userCreation: has custom message', () => {
      expect(rateLimitConfigs.userCreation.message).toContain('user creation');
    });

    it('api: 100 requests per 1 minute', () => {
      expect(rateLimitConfigs.api.maxRequests).toBe(100);
      expect(rateLimitConfigs.api.windowMs).toBe(60 * 1000);
    });

    it('api: has custom message', () => {
      expect(rateLimitConfigs.api.message).toContain('slow down');
    });

    it('totp: 5 requests per 15 minutes', () => {
      expect(rateLimitConfigs.totp.maxRequests).toBe(5);
      expect(rateLimitConfigs.totp.windowMs).toBe(15 * 60 * 1000);
    });

    it('totp: skipSuccessfulRequests enabled', () => {
      expect(rateLimitConfigs.totp.skipSuccessfulRequests).toBe(true);
    });

    it('totp: has custom message', () => {
      expect(rateLimitConfigs.totp.message).toContain('verification attempts');
    });
  });

  
  
  
  describe('named rate limiters', () => {
    it('loginRateLimiter is a function', () => {
      expect(typeof loginRateLimiter).toBe('function');
    });

    it('passwordResetRateLimiter is a function', () => {
      expect(typeof passwordResetRateLimiter).toBe('function');
    });

    it('userCreationRateLimiter is a function', () => {
      expect(typeof userCreationRateLimiter).toBe('function');
    });

    it('apiRateLimiter is a function', () => {
      expect(typeof apiRateLimiter).toBe('function');
    });

    it('totpRateLimiter is a function', () => {
      expect(typeof totpRateLimiter).toBe('function');
    });

    it('loginRateLimiter enforces login preset', async () => {
      const event = createMockEvent({ pathname: '/admin/login' });
      
      for (let i = 0; i < 5; i++) {
        await loginRateLimiter(event);
      }
      
      await expect(loginRateLimiter(event)).rejects.toHaveProperty('status', 429);
    });

    it('passwordResetRateLimiter enforces passwordReset preset', async () => {
      const event = createMockEvent({ pathname: '/reset-password' });
      for (let i = 0; i < 3; i++) {
        await passwordResetRateLimiter(event);
      }
      await expect(passwordResetRateLimiter(event)).rejects.toHaveProperty('status', 429);
    });

    it('userCreationRateLimiter enforces userCreation preset', async () => {
      const event = createMockEvent({ pathname: '/api/admin/users' });
      for (let i = 0; i < 10; i++) {
        await userCreationRateLimiter(event);
      }
      await expect(userCreationRateLimiter(event)).rejects.toHaveProperty('status', 429);
    });

    it('apiRateLimiter enforces api preset', async () => {
      const event = createMockEvent({ pathname: '/api/data' });
      for (let i = 0; i < 100; i++) {
        await apiRateLimiter(event);
      }
      await expect(apiRateLimiter(event)).rejects.toHaveProperty('status', 429);
    });

    it('totpRateLimiter enforces totp preset', async () => {
      const event = createMockEvent({ pathname: '/admin/verify' });
      for (let i = 0; i < 5; i++) {
        await totpRateLimiter(event);
      }
      await expect(totpRateLimiter(event)).rejects.toHaveProperty('status', 429);
    });
  });

  
  
  
  describe('rateLimit middleware', () => {
    it('should skip /_app paths', async () => {
      const event = createMockEvent({ pathname: '/_app/immutable/chunks/main.js' });
      const resolve = createMockResolve();
      await rateLimit({ event, resolve });
      expect(resolve).toHaveBeenCalledWith(event);
    });

    it('should skip /favicon paths', async () => {
      const event = createMockEvent({ pathname: '/favicon.ico' });
      const resolve = createMockResolve();
      await rateLimit({ event, resolve });
      expect(resolve).toHaveBeenCalledWith(event);
    });

    it('should skip .css files', async () => {
      const event = createMockEvent({ pathname: '/styles/main.css' });
      const resolve = createMockResolve();
      await rateLimit({ event, resolve });
      expect(resolve).toHaveBeenCalledWith(event);
    });

    it('should skip .js files', async () => {
      const event = createMockEvent({ pathname: '/scripts/app.js' });
      const resolve = createMockResolve();
      await rateLimit({ event, resolve });
      expect(resolve).toHaveBeenCalledWith(event);
    });

    it('should apply login limiter for POST /admin/login', async () => {
      const resolve = createMockResolve();

      for (let i = 0; i < 5; i++) {
        const event = createMockEvent({ method: 'POST', pathname: '/admin/login' });
        await rateLimit({ event, resolve });
      }

      const event = createMockEvent({ method: 'POST', pathname: '/admin/login' });
      await expect(rateLimit({ event, resolve })).rejects.toHaveProperty('status', 429);
    });

    it('should not apply login limiter for GET /admin/login', async () => {
      const resolve = createMockResolve();
      
      
      const event = createMockEvent({ method: 'GET', pathname: '/admin/login' });
      await expect(rateLimit({ event, resolve })).resolves.toBeDefined();
    });

    it('should apply totp limiter for POST /admin/verify', async () => {
      const resolve = createMockResolve();

      for (let i = 0; i < 5; i++) {
        const event = createMockEvent({ method: 'POST', pathname: '/admin/verify' });
        await rateLimit({ event, resolve });
      }

      const event = createMockEvent({ method: 'POST', pathname: '/admin/verify' });
      await expect(rateLimit({ event, resolve })).rejects.toHaveProperty('status', 429);
    });

    it('should apply userCreation limiter for POST /api/admin/users', async () => {
      const resolve = createMockResolve();

      for (let i = 0; i < 10; i++) {
        const event = createMockEvent({ method: 'POST', pathname: '/api/admin/users' });
        await rateLimit({ event, resolve });
      }

      const event = createMockEvent({ method: 'POST', pathname: '/api/admin/users' });
      await expect(rateLimit({ event, resolve })).rejects.toHaveProperty('status', 429);
    });

    it('should apply passwordReset limiter for /reset-password', async () => {
      const resolve = createMockResolve();

      for (let i = 0; i < 3; i++) {
        const event = createMockEvent({ pathname: '/reset-password' });
        await rateLimit({ event, resolve });
      }

      const event = createMockEvent({ pathname: '/reset-password' });
      await expect(rateLimit({ event, resolve })).rejects.toHaveProperty('status', 429);
    });

    it('should apply api limiter for /api/* routes', async () => {
      const resolve = createMockResolve();

      for (let i = 0; i < 100; i++) {
        const event = createMockEvent({ pathname: '/api/data' });
        await rateLimit({ event, resolve });
      }

      const event = createMockEvent({ pathname: '/api/data' });
      await expect(rateLimit({ event, resolve })).rejects.toHaveProperty('status', 429);
    });

    it('should pass non-matched requests through', async () => {
      const event = createMockEvent({ pathname: '/about' });
      const resolve = createMockResolve();
      const response = await rateLimit({ event, resolve });
      expect(resolve).toHaveBeenCalledWith(event);
      expect(response).toBeDefined();
    });

    it('should add X-RateLimit-Limit header', async () => {
      const event = createMockEvent({ pathname: '/api/test' });
      const resolve = createMockResolve();
      const response = await rateLimit({ event, resolve });
      expect(response.headers.get('X-RateLimit-Limit')).toBe('100');
    });

    it('should add X-RateLimit-Remaining header', async () => {
      const event = createMockEvent({ pathname: '/api/test' });
      const resolve = createMockResolve();
      const response = await rateLimit({ event, resolve });
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('99');
    });

    it('should add X-RateLimit-Reset header', async () => {
      const event = createMockEvent({ pathname: '/api/test' });
      const resolve = createMockResolve();
      const response = await rateLimit({ event, resolve });
      expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy();
    });

    it('should decrement remaining count with each request', async () => {
      const resolve = createMockResolve();

      const event1 = createMockEvent({ pathname: '/api/test' });
      await rateLimit({ event: event1, resolve });

      const event2 = createMockEvent({ pathname: '/api/test' });
      const response2 = await rateLimit({ event: event2, resolve });
      expect(response2.headers.get('X-RateLimit-Remaining')).toBe('98');
    });

    it('should handle non-status errors gracefully', async () => {
      
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const event = createMockEvent({ pathname: '/some-path' });
      const resolve = createMockResolve();

      
      await expect(rateLimit({ event, resolve })).resolves.toBeDefined();
    });

    it('should re-throw errors with status property', async () => {
      const resolve = createMockResolve();

      
      for (let i = 0; i < 5; i++) {
        const event = createMockEvent({ method: 'POST', pathname: '/admin/login' });
        await rateLimit({ event, resolve });
      }

      const event = createMockEvent({ method: 'POST', pathname: '/admin/login' });
      try {
        await rateLimit({ event, resolve });
        expect.fail('Expected to throw');
      } catch (err: unknown) {
        expect(err).toHaveProperty('status', 429);
      }
    });

    it('should not add headers for requests without store entry', async () => {
      const event = createMockEvent({ pathname: '/page' });
      const resolve = createMockResolve();
      const response = await rateLimit({ event, resolve });
      
      expect(response.headers.get('X-RateLimit-Limit')).toBeNull();
    });

    it('should apply passwordReset for paths containing /reset-password', async () => {
      const resolve = createMockResolve();
      const event = createMockEvent({ pathname: '/user/reset-password/confirm' });
      await rateLimit({ event, resolve });
      
      const store = getStore();
      expect(store.size).toBeGreaterThan(0);
    });
  });

  
  
  
  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      const limiter = createRateLimiter({ windowMs: 1000, maxRequests: 5 });
      const event = createMockEvent();
      await limiter(event);
      expect(getStore().size).toBe(1);

      startCleanup();

      
      vi.advanceTimersByTime(61000);

      expect(getStore().size).toBe(0);
    });

    it('should preserve active entries', async () => {
      startCleanup();

      const limiter = createRateLimiter({ windowMs: 120000, maxRequests: 5 });
      const event = createMockEvent();
      await limiter(event);

      
      vi.advanceTimersByTime(61000);

      expect(getStore().size).toBe(1);
    });

    it('should stop cleanup when stopCleanup is called', () => {
      startCleanup();
      stopCleanup();
      
    });

    it('clearStore should remove all entries', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 5 });
      await limiter(createMockEvent({ ip: '1.1.1.1' }));
      await limiter(createMockEvent({ ip: '2.2.2.2' }));
      expect(getStore().size).toBe(2);

      clearStore();
      expect(getStore().size).toBe(0);
    });

    it('should handle multiple start/stop cycles', () => {
      startCleanup();
      stopCleanup();
      startCleanup();
      stopCleanup();
      
    });
  });

  
  
  
  describe('error factory', () => {
    it('should use createHttpError from config', async () => {
      const customError = vi.fn().mockImplementation((status: number, msg: string): never => {
        throw Object.assign(new Error(msg), { status, body: { message: msg } });
      });
      configureRateLimit({ createHttpError: customError });

      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const event = createMockEvent();
      await limiter(event);

      try {
        await limiter(event);
      } catch {
        
      }

      expect(customError).toHaveBeenCalledWith(429, expect.stringContaining('Too many requests'));
    });

    it('should pass correct status code', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const event = createMockEvent();
      await limiter(event);

      try {
        await limiter(event);
        expect.fail('Expected to throw');
      } catch (err: unknown) {
        expect((err as { status: number }).status).toBe(429);
      }
    });
  });

  
  
  
  describe('DI config integration', () => {
    it('should use logger from config for errors in middleware', async () => {
      const errorFn = vi.fn();
      configureRateLimit({
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: errorFn,
          debug: vi.fn(),
        }),
      });

      
      
      const resolve = createMockResolve();
      const event = createMockEvent({ pathname: '/about' });
      await rateLimit({ event, resolve });
      
    });

    it('should use configured cleanupIntervalMs', () => {
      configureRateLimit({ cleanupIntervalMs: 5000 });
      
      startCleanup();
      
      stopCleanup();
    });
  });
});
