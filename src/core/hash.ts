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

// 内容指纹口径：试填反馈（researchDesign.pretest）是作者自报元数据，不是问卷
// 内容；在无设计草稿上保存试填时合成的全空研究设计基底同样不携带内容信号。
// dirty 与诊断过期判定都建立在归一化（剥 pretest + 丢全空设计）后的 canonical
// 形式上，服务端与客户端共用本函数，保证两端指纹逐字节可比。
function isEmptyResearchDesign(design: Record<string, unknown>): boolean {
  return (
    design.researchQuestion === "" &&
    design.population === "" &&
    design.recruitment === "" &&
    design.analysisPlan === "" &&
    Array.isArray(design.constructs) &&
    design.constructs.length === 0 &&
    (design.analysisModels === undefined ||
      (Array.isArray(design.analysisModels) && design.analysisModels.length === 0)) &&
    Array.isArray(design.assumptions) &&
    design.assumptions.length === 0 &&
    Array.isArray(design.pendingDecisions) &&
    design.pendingDecisions.length === 0 &&
    (design.purpose === undefined || design.purpose === "describe") &&
    (design.timeBudgetMinutes === undefined || design.timeBudgetMinutes === 5)
  );
}

export function canonicalContentJson(definition: unknown): string {
  const source = definition as { researchDesign?: Record<string, unknown> };
  const design = source.researchDesign;
  let next: { researchDesign?: Record<string, unknown> } = source;
  if (design?.pretest) {
    const { pretest: _pretest, ...rest } = design;
    next = { ...source, researchDesign: rest };
  }
  if (next.researchDesign && isEmptyResearchDesign(next.researchDesign)) {
    const { researchDesign: _design, ...rest } = next;
    next = rest;
  }
  return canonicalSurveyJson(next);
}

/** WebCrypto sha256（浏览器与 jsdom 均有 globalThis.crypto.subtle）；与 node 侧
 *  sha256Hex 只共享 canonical 形式，哈希实现各自持有。 */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
