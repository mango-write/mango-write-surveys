import { describe, expect, it } from "vitest";

import {
  buildCognitiveInterviewGuide,
  formatCognitiveInterviewGuide,
  type CognitiveInterviewPhrasing,
} from "./cognitive-interview.js";
import type { SurveyPretestAspect } from "./definition.js";
import { makeDefinition } from "./test-fixtures.js";

const ASPECTS: SurveyPretestAspect[] = ["comprehension", "recall", "judgment", "response"];

describe("buildCognitiveInterviewGuide", () => {
  it("每道可答题恰好四条探查问题，按页序排列，说明块跳过", () => {
    const definition = makeDefinition();
    definition.questions.push({
      id: "q9",
      type: "statement",
      title: "",
      required: false,
      body: "说明块不是题目",
    });
    definition.pages[0]!.questionIds.push("q9");
    const guide = buildCognitiveInterviewGuide(definition);
    expect(guide.title).toBe(definition.title);
    // 页序 = 全卷题序：q1,q2,q3,q4,q5（q9 是说明块，不出现）。
    expect([...new Set(guide.items.map((item) => item.questionId))]).toEqual([
      "q1",
      "q2",
      "q3",
      "q4",
      "q5",
    ]);
    for (const questionId of ["q1", "q2", "q3", "q4", "q5"]) {
      const items = guide.items.filter((item) => item.questionId === questionId);
      expect(items.map((item) => item.aspect)).toEqual(ASPECTS);
      expect(items.every((item) => item.prompt.trim().length > 0)).toBe(true);
    }
  });

  it("卷首说明存在且覆盖试填对象、记录方式与回填去向", () => {
    const guide = buildCognitiveInterviewGuide(makeDefinition());
    expect(guide.intro).toContain("2–5");
    expect(guide.intro).toContain("原话");
    expect(guide.intro).toContain("试填反馈");
    // 措辞铁律：不出现方法学黑话。
    expect(guide.intro).not.toContain("认知访谈");
    expect(guide.items.every((item) => !item.prompt.includes("认知访谈"))).toBe(true);
  });

  it("探查问题引用题干；空卷只有说明没有条目", () => {
    const guide = buildCognitiveInterviewGuide(makeDefinition());
    expect(guide.items.find((item) => item.questionId === "q1")!.prompt).toContain("单选");

    const empty = buildCognitiveInterviewGuide({
      version: 1,
      title: "空卷",
      description: "",
      consent: "",
      questions: [],
      pages: [{ id: "p1", title: "一", questionIds: [] }],
    });
    expect(empty.items).toEqual([]);
    expect(empty.intro.length).toBeGreaterThan(0);
  });

  it("phrasing 可注入：结构与措辞分离，本地化层只换文案", () => {
    const phrasing: CognitiveInterviewPhrasing = {
      intro: ({ questions }) => `INTRO ${questions}`,
      probe: (aspect) => `P:${aspect}`,
    };
    const guide = buildCognitiveInterviewGuide(makeDefinition(), phrasing);
    expect(guide.intro).toBe(`INTRO 5`);
    expect(guide.items.filter((item) => item.questionId === "q1").map((item) => item.prompt)).toEqual([
      "P:comprehension",
      "P:recall",
      "P:judgment",
      "P:response",
    ]);
  });
});

describe("formatCognitiveInterviewGuide", () => {
  it("输出纯文本：说明在前，逐题编号，探查问题缩进", () => {
    const guide = buildCognitiveInterviewGuide(makeDefinition(), {
      intro: () => "INTRO",
      probe: (aspect, title) => `${aspect}:${title}`,
    });
    const text = formatCognitiveInterviewGuide(guide);
    expect(text.startsWith("INTRO\n")).toBe(true);
    expect(text).toContain("\n1. 单选\n");
    expect(text).toContain("\n5. 量表\n");
    expect(text).toContain("   - comprehension:单选");
    expect(text).toContain("   - response:量表");
    expect(text).not.toContain("[object Object]");
  });
});
