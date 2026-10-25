// 键序无关的稳定序列化（issue #217）。发布快照的 contentHash 与工作台的
// 「草稿有未发布修改」判定都建立在同一份 canonical 形式上：api 侧 sha256Hex
// （node:crypto），web 侧 crypto.subtle——哈希实现可以各异，canonical 形式
// 必须只有这一份，否则两端比对静默失配。

/** 键序无关的稳定序列化：同一份定义在任何客户端序列化顺序下得到同一哈希。 */
export function canonicalSurveyJson(value: unknown): string {
  return JSON.stringify(stabilize(value));
}

function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stabilize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(source).sort())
      out[key] = stabilize(source[key]);
    return out;
  }
  return value;
}
