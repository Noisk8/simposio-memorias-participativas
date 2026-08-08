export function slugify(text: string): string;

export function parseFrontmatter(content: string): Record<string, unknown>;

export function isValidPublicImagePath(value: unknown): boolean;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export type RateLimitCheck = (key: string, now?: number) => RateLimitResult;

export function createRateLimiter(options?: { max?: number; windowMs?: number }): RateLimitCheck;
