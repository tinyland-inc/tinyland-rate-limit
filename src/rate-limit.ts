






import { getRateLimitConfig } from './config.js';
import type {
  MiddlewareHandle,
  MiddlewareRequestEvent,
  RateLimitConfig,
  RateLimitStore,
} from './types.js';


const rateLimitStore = new Map<string, RateLimitStore>();


let cleanupInterval: ReturnType<typeof setInterval> | null = null;


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


export function stopCleanup(): void {
  if (cleanupInterval !== null) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}


export function clearStore(): void {
  rateLimitStore.clear();
}


export function getStore(): Map<string, RateLimitStore> {
  return rateLimitStore;
}


startCleanup();


export const rateLimitConfigs = {
  
  login: {
    windowMs: 15 * 60 * 1000, 
    maxRequests: 5,
    skipSuccessfulRequests: true,
    message: 'Too many login attempts. Please try again later.',
  } satisfies RateLimitConfig,

  
  passwordReset: {
    windowMs: 60 * 60 * 1000, 
    maxRequests: 3,
    message: 'Too many password reset requests. Please try again later.',
  } satisfies RateLimitConfig,

  
  userCreation: {
    windowMs: 60 * 60 * 1000, 
    maxRequests: 10,
    message: 'Too many user creation requests. Please try again later.',
  } satisfies RateLimitConfig,

  
  api: {
    windowMs: 60 * 1000, 
    maxRequests: 100,
    message: 'Too many requests. Please slow down.',
  } satisfies RateLimitConfig,

  
  totp: {
    windowMs: 15 * 60 * 1000, 
    maxRequests: 5,
    skipSuccessfulRequests: true,
    message: 'Too many verification attempts. Please try again later.',
  } satisfies RateLimitConfig,
};


function defaultKeyGenerator(event: MiddlewareRequestEvent): string {
  const ip = event.getClientAddress();
  const path = event.url.pathname;
  return `${ip}:${path}`;
}


export function createRateLimiter(
  config: RateLimitConfig,
): (event: MiddlewareRequestEvent) => Promise<void> {
  return async (event: MiddlewareRequestEvent): Promise<void> => {
    const keyGenerator = config.keyGenerator ?? defaultKeyGenerator;
    const key = keyGenerator(event);
    const now = Date.now();

    
    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime <= now) {
      
      entry = {
        hits: 1,
        resetTime: now + config.windowMs,
      };
      rateLimitStore.set(key, entry);
      return;
    }

    
    if (entry.hits >= config.maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      const errorMessage = `${config.message ?? 'Too many requests'} (retry after ${retryAfter}s)`;

      const { createHttpError } = getRateLimitConfig();
      createHttpError(429, errorMessage);
    }

    
    entry.hits++;
  };
}


export const loginRateLimiter = createRateLimiter(rateLimitConfigs.login);
export const passwordResetRateLimiter = createRateLimiter(rateLimitConfigs.passwordReset);
export const userCreationRateLimiter = createRateLimiter(rateLimitConfigs.userCreation);
export const apiRateLimiter = createRateLimiter(rateLimitConfigs.api);
export const totpRateLimiter = createRateLimiter(rateLimitConfigs.totp);


export const rateLimit: MiddlewareHandle = async ({ event, resolve }) => {
  
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
    
    logger.error('Rate limit error:', { error: String(err) });
  }

  const response = await resolve(event);

  
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
