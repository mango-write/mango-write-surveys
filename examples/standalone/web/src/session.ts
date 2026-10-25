// 独立站登录态（session.ts）：单管理员会话 cookie 是 HttpOnly，前端读不到，
// 只能本地标记 + 服务端探测。cookie 失效由 transport 的 401 兜底回登录页。
let signedIn = false;
let probing: Promise<boolean> | null = null;

export function markSignedIn(): void {
  signedIn = true;
  probing = null;
}

export function markSignedOut(): void {
  signedIn = false;
  probing = null;
}

export function isSignedIn(): boolean {
  return signedIn;
}

/** GET /api/surveys 探测会话：200 = 已登录，401 = 未登录。应用装载后首个
 *  受守卫导航触发一次，结果按当前标记缓存。 */
export function probeSession(): Promise<boolean> {
  probing ??= fetch("/api/surveys", { credentials: "include" })
    .then((response) => response.ok)
    .catch(() => false);
  return probing;
}
