// 媒体 sha 级互斥：上传（put + 绑定入库）与释放回收（绑定检查 + 物理删除）
// 必须串行——同内容重传落在 GC 的检查与删除之间，会留下「有绑定无字节」的
// 永久裂图。绑定行归 storage port、字节归 media port，跨 port 的互斥只能在
// 编排层收口；主站宿主池有自己的串行化，这里过一道进程内锁无副作用。
import type { SurveysMediaPort } from "../ports.js";

const locks = new Map<string, Promise<unknown>>();

export function withMediaShaLock<T>(sha256: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(sha256) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const gate = run.then(
    () => undefined,
    () => undefined,
  );
  locks.set(sha256, gate);
  void gate.then(() => {
    if (locks.get(sha256) === gate) locks.delete(sha256);
  });
  return run;
}

/** 删除问卷级联释放绑定后的字节回收：逐 sha 与上传路径互斥。 */
export async function collectReleasedMedia(
  media: SurveysMediaPort,
  shas: string[],
): Promise<void> {
  for (const sha256 of shas) {
    await withMediaShaLock(sha256, () => media.collectAfterRelease([sha256]));
  }
}
