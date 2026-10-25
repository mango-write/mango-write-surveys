import { describe, expect, it } from "vitest";
import {
  CHECK_DIMENSIONS,
  RESEARCH_TYPE_IDS,
  ResearchTypeSchema,
  SOURCES,
  SOURCE_IDS,
  STANDARDS_CHECKS,
  validateStandardsCatalog,
  RESEARCH_TYPES,
  SEVERITY_LEVELS,
  REVIEW_PROTOCOL_STATUS,
} from "./index.js";

// 阶段 1 的验收进测试：目录条目不合格（缺来源/适用条件/示例/处理方式、
// id 冲突、引用不在登记表）这里直接红，不靠人工核查。
describe("研究标准目录", () => {
  it("交叉校验零问题", () => {
    expect(validateStandardsCatalog(STANDARDS_CHECKS)).toEqual([]);
  });

  it("每个维度至少 5 条", () => {
    const insufficient = CHECK_DIMENSIONS.filter(
      (dimension) =>
        STANDARDS_CHECKS.filter((c) => c.dimension === dimension).length < 5,
    );
    expect(insufficient, `检查项不足的维度：${insufficient.join(", ")}`).toEqual([]);
  });

  it("来源登记表全部被引用", () => {
    const cited = new Set(STANDARDS_CHECKS.flatMap((c) => c.citations.map((x) => x.source)));
    for (const id of SOURCE_IDS) {
      expect(cited.has(id), `来源 ${id} 从未被引用`).toBe(true);
    }
    expect(Object.keys(SOURCES).sort()).toEqual([...SOURCE_IDS].sort());
  });

  it("三分类都有代表条目", () => {
    for (const cls of ["rule", "judgment", "human_data"] as const) {
      expect(
        STANDARDS_CHECKS.some((c) => c.classification === cls),
        `分类 ${cls} 无条目`,
      ).toBe(true);
    }
  });

  it("研究类型表与 id 清单一致且过 schema", () => {
    expect(RESEARCH_TYPES.map((t) => t.id).sort()).toEqual([...RESEARCH_TYPE_IDS].sort());
    for (const t of RESEARCH_TYPES) {
      expect(ResearchTypeSchema.safeParse(t).success, `${t.id} 不合格`).toBe(true);
    }
  });

  it("严重级别表与 severity 词表一致，评审协议处于草案状态", () => {
    expect(SEVERITY_LEVELS.map((s) => s.id).sort()).toEqual(["blocker", "major", "minor"]);
    expect(REVIEW_PROTOCOL_STATUS).toBe("draft-pending-expert-review");
  });
});
