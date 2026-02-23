







export interface RateLimitLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
}


export interface RateLimitPackageConfig {
  
  getLogger?: () => RateLimitLogger;
  
  isProduction?: boolean;
  
  isDevelopment?: boolean;
  
  createHttpError?: (status: number, message: string) => never;
  
  cleanupIntervalMs?: number;
}

const noopLogger: RateLimitLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};


function defaultCreateHttpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status, body: { message } });
}

let config: RateLimitPackageConfig = {};


export function configureRateLimit(c: RateLimitPackageConfig): void {
  config = { ...config, ...c };
}


export function getRateLimitConfig(): Required<RateLimitPackageConfig> {
  return {
    getLogger: config.getLogger ?? (() => noopLogger),
    isProduction: config.isProduction ?? false,
    isDevelopment: config.isDevelopment ?? false,
    createHttpError: config.createHttpError ?? defaultCreateHttpError,
    cleanupIntervalMs: config.cleanupIntervalMs ?? 60000,
  };
}


export function resetRateLimitConfig(): void {
  config = {};
}
