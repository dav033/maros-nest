import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export interface RateLimit {
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_KEY = 'publicRateLimit';
export const RateLimited = (limit: RateLimit) => SetMetadata(RATE_LIMIT_KEY, limit);

const DEFAULT_LIMIT: RateLimit = { limit: 60, windowMs: 60_000 };

/** Stop the map from growing without bound when traffic is spread over many IPs. */
const SWEEP_EVERY = 500;

/**
 * Per-IP sliding window for the public endpoints.
 *
 * A 256-bit token cannot be guessed, but a six-character note password can, and
 * /unlock is the one public route where a wrong answer is cheap to retry. This is what
 * makes it expensive.
 *
 * In-memory on purpose: no new dependency, and one process is what this API runs as
 * today. **If it is ever scaled to more than one instance the window becomes per
 * instance**, and the honest fix at that point is @nestjs/throttler with a shared
 * store — not a bigger Map.
 */
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private requestsSinceSweep = 0;

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const config =
      this.reflector.getAllAndOverride<RateLimit>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_LIMIT;

    const request = context.switchToHttp().getRequest<Request>();
    const key = `${context.getClass().name}.${context.getHandler().name}:${this.clientIp(request)}`;
    const now = Date.now();

    const recent = (this.hits.get(key) ?? []).filter(
      (at) => now - at < config.windowMs,
    );

    if (recent.length >= config.limit) {
      throw new HttpException(
        'Too many requests — try again shortly',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.hits.set(key, recent);
    this.sweepIfDue(now);

    return true;
  }

  private sweepIfDue(now: number): void {
    if (++this.requestsSinceSweep < SWEEP_EVERY) return;
    this.requestsSinceSweep = 0;

    for (const [key, timestamps] of this.hits) {
      // Any window is at most a few minutes; an hour of silence means nobody is
      // coming back for this key.
      if (timestamps.every((at) => now - at > 3_600_000)) {
        this.hits.delete(key);
      }
    }
  }

  /**
   * Behind a proxy (Netlify, Supabase, any load balancer) req.ip is the proxy, so the
   * first hop of x-forwarded-for is the real client. It is client-controlled and
   * therefore spoofable — acceptable here, where the guard raises the cost of brute
   * force rather than proving identity.
   */
  private clientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return request.ip ?? 'unknown';
  }
}
