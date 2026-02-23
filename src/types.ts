







export interface CookieOptions {
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  maxAge?: number;
}


export interface CookieJar {
  get: (name: string) => string | undefined;
  set: (name: string, value: string, options?: CookieOptions) => void;
}


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


export interface HttpError {
  status: number;
  body: { message: string };
}


export type ResolveFn = (event: MiddlewareRequestEvent) => Promise<Response>;


export type MiddlewareHandle = (input: {
  event: MiddlewareRequestEvent;
  resolve: ResolveFn;
}) => Promise<Response>;


export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (event: MiddlewareRequestEvent) => string;
  message?: string;
}


export interface RateLimitStore {
  hits: number;
  resetTime: number;
}
