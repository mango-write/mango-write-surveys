// 进程内限流（自主仓 lib/rate-limit.ts 的匿名滑动窗口子集 vendored，#223）。
// 模块化单体单进程设计下进程内窗口即权威；状态重启即清，防刷不承担正确性。
import type { Context, MiddlewareHandler } from "hono";

interface WindowState {
  hits: number[];
}

/**
 * 匿名桶键的真实客户端 IP。X-Real-IP 由反向代理按 $remote_addr 覆盖写入、
 * 不可伪造；缺失时退回 X-Forwarded-For 末跳（代理追加的真实对端，前缀是
 * 伪造的不参与），再退回 socket 对端。
 */
function anonymousKeyOf(c: Context): string | null {
  const realIp = c.req.header("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    const last = hops[hops.length - 1]?.trim();
    if (last) return last;
  }
  const env = c.env as
    | { incoming?: { socket?: { remoteAddress?: string } } }
    | undefined;
  return env?.incoming?.socket?.remoteAddress ?? null;
}

export interface SurveyRateLimitOptions {
  key?: (c: Context) => string;
  windowMs: number;
  max: number;
  methods?: string[];
  name: string;
  message?: string;
}

const buckets = new Map<string, Map<string, WindowState>>();

export function surveyRateLimit(options: SurveyRateLimitOptions): MiddlewareHandler {
  const bucket = new Map<string, WindowState>();
  buckets.set(options.name, bucket);
  const methods = options.methods?.map((m) => m.toUpperCase());
  return async (c, next) => {
    if (methods && !methods.includes(c.req.method.toUpperCase())) return next();
    const key = options.key ? options.key(c) : (anonymousKeyOf(c) ?? "anonymous");
    const now = Date.now();
    const state = bucket.get(key) ?? { hits: [] };
    state.hits = state.hits.filter((t) => now - t < options.windowMs);
    if (state.hits.length >= options.max) {
      bucket.set(key, state);
      return c.json(
        {
          error: "rate_limited",
          message: options.message ?? "请求过于频繁，请稍后再试。",
          retryAfterMs: options.windowMs - (now - state.hits[0]!),
        },
        429,
      );
    }
    state.hits.push(now);
    bucket.set(key, state);
    return next();
  };
}

/** Test-only: 清空全部限流桶。 */
export function resetSurveyRateLimitForTests(): void {
  for (const bucket of buckets.values()) bucket.clear();
}
