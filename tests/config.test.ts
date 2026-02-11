import { describe, it, expect, beforeEach } from 'vitest';
import {
  configureRateLimit,
  getRateLimitConfig,
  resetRateLimitConfig,
  type RateLimitLogger,
  type RateLimitPackageConfig,
} from '../src/config.js';

describe('config', () => {
  beforeEach(() => {
    resetRateLimitConfig();
  });

  describe('configureRateLimit', () => {
    it('should set logger', () => {
      const logger: RateLimitLogger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      };
      configureRateLimit({ getLogger: () => logger });
      expect(getRateLimitConfig().getLogger()).toBe(logger);
    });

    it('should set isProduction', () => {
      configureRateLimit({ isProduction: true });
      expect(getRateLimitConfig().isProduction).toBe(true);
    });

    it('should set isDevelopment', () => {
      configureRateLimit({ isDevelopment: true });
      expect(getRateLimitConfig().isDevelopment).toBe(true);
    });

    it('should set createHttpError', () => {
      const customError = (status: number, message: string): never => {
        throw new Error(`${status}: ${message}`);
      };
      configureRateLimit({ createHttpError: customError });
      expect(getRateLimitConfig().createHttpError).toBe(customError);
    });

    it('should set cleanupIntervalMs', () => {
      configureRateLimit({ cleanupIntervalMs: 30000 });
      expect(getRateLimitConfig().cleanupIntervalMs).toBe(30000);
    });

    it('should merge with existing config', () => {
      configureRateLimit({ isProduction: true });
      configureRateLimit({ isDevelopment: true });
      const result = getRateLimitConfig();
      expect(result.isProduction).toBe(true);
      expect(result.isDevelopment).toBe(true);
    });

    it('should override previously set values', () => {
      configureRateLimit({ isProduction: true });
      configureRateLimit({ isProduction: false });
      expect(getRateLimitConfig().isProduction).toBe(false);
    });

    it('should accept empty config', () => {
      configureRateLimit({});
      // Should not throw
      const result = getRateLimitConfig();
      expect(result.isProduction).toBe(false);
    });

    it('should accept full config at once', () => {
      const logger: RateLimitLogger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      };
      const customError = (status: number, message: string): never => {
        throw new Error(`${status}: ${message}`);
      };
      const fullConfig: RateLimitPackageConfig = {
        getLogger: () => logger,
        isProduction: true,
        isDevelopment: false,
        createHttpError: customError,
        cleanupIntervalMs: 5000,
      };
      configureRateLimit(fullConfig);
      const result = getRateLimitConfig();
      expect(result.getLogger()).toBe(logger);
      expect(result.isProduction).toBe(true);
      expect(result.isDevelopment).toBe(false);
      expect(result.createHttpError).toBe(customError);
      expect(result.cleanupIntervalMs).toBe(5000);
    });
  });

  describe('getRateLimitConfig', () => {
    it('should return defaults when nothing configured', () => {
      const result = getRateLimitConfig();
      expect(result.isProduction).toBe(false);
      expect(result.isDevelopment).toBe(false);
      expect(result.cleanupIntervalMs).toBe(60000);
    });

    it('should return a noop logger by default', () => {
      const logger = getRateLimitConfig().getLogger();
      // Should not throw when called
      logger.info('test');
      logger.warn('test');
      logger.error('test');
      logger.debug('test');
    });

    it('should return default createHttpError', () => {
      const fn = getRateLimitConfig().createHttpError;
      expect(typeof fn).toBe('function');
    });

    it('should return configured values', () => {
      configureRateLimit({ isProduction: true, cleanupIntervalMs: 120000 });
      const result = getRateLimitConfig();
      expect(result.isProduction).toBe(true);
      expect(result.cleanupIntervalMs).toBe(120000);
    });

    it('should return defaults for unconfigured fields when partial config set', () => {
      configureRateLimit({ isProduction: true });
      const result = getRateLimitConfig();
      expect(result.isProduction).toBe(true);
      expect(result.isDevelopment).toBe(false); // default
      expect(result.cleanupIntervalMs).toBe(60000); // default
    });

    it('should return a Required type with all fields defined', () => {
      const result = getRateLimitConfig();
      expect(result.getLogger).toBeDefined();
      expect(result.isProduction).toBeDefined();
      expect(result.isDevelopment).toBeDefined();
      expect(result.createHttpError).toBeDefined();
      expect(result.cleanupIntervalMs).toBeDefined();
    });
  });

  describe('resetRateLimitConfig', () => {
    it('should clear all configured values', () => {
      configureRateLimit({ isProduction: true, isDevelopment: true, cleanupIntervalMs: 5000 });
      resetRateLimitConfig();
      const result = getRateLimitConfig();
      expect(result.isProduction).toBe(false);
      expect(result.isDevelopment).toBe(false);
      expect(result.cleanupIntervalMs).toBe(60000);
    });

    it('should return defaults after reset', () => {
      configureRateLimit({ isProduction: true });
      resetRateLimitConfig();
      expect(getRateLimitConfig().isProduction).toBe(false);
    });

    it('should allow reconfiguration after reset', () => {
      configureRateLimit({ isProduction: true });
      resetRateLimitConfig();
      configureRateLimit({ isDevelopment: true });
      const result = getRateLimitConfig();
      expect(result.isProduction).toBe(false);
      expect(result.isDevelopment).toBe(true);
    });

    it('should restore noop logger after reset', () => {
      const customLogger: RateLimitLogger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      };
      configureRateLimit({ getLogger: () => customLogger });
      resetRateLimitConfig();
      const logger = getRateLimitConfig().getLogger();
      expect(logger).not.toBe(customLogger);
      // Should still work without throwing
      logger.info('test');
    });
  });

  describe('defaultCreateHttpError', () => {
    it('should throw with the correct status', () => {
      const fn = getRateLimitConfig().createHttpError;
      try {
        fn(429, 'Too many requests');
      } catch (err: unknown) {
        expect(err).toHaveProperty('status', 429);
        return;
      }
      // Should not reach here
      expect.fail('Expected createHttpError to throw');
    });

    it('should throw with the correct message', () => {
      const fn = getRateLimitConfig().createHttpError;
      try {
        fn(403, 'Forbidden');
      } catch (err: unknown) {
        expect((err as Error).message).toBe('Forbidden');
        return;
      }
      expect.fail('Expected createHttpError to throw');
    });

    it('should throw an Error-like object with body', () => {
      const fn = getRateLimitConfig().createHttpError;
      try {
        fn(500, 'Server error');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        expect(err).toHaveProperty('body');
        expect((err as { body: { message: string } }).body.message).toBe('Server error');
        return;
      }
      expect.fail('Expected createHttpError to throw');
    });

    it('should throw an object matching SvelteKit error() shape', () => {
      const fn = getRateLimitConfig().createHttpError;
      try {
        fn(404, 'Not found');
      } catch (err: unknown) {
        expect(err).toHaveProperty('status', 404);
        expect(err).toHaveProperty('body');
        expect((err as { body: { message: string } }).body).toEqual({ message: 'Not found' });
        return;
      }
      expect.fail('Expected createHttpError to throw');
    });

    it('should always throw (never returns)', () => {
      const fn = getRateLimitConfig().createHttpError;
      expect(() => fn(400, 'Bad request')).toThrow();
    });
  });
});
