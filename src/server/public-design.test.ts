import { describe, expect, it } from "vitest";
import { makeDefinition } from "../core/test-fixtures.js";
import { toPublicDefinition } from "./service.js";

describe("匿名问卷投影", () => {
  it.each([false, true])("不泄露研究设计与招募假设，保留选项图：%s", (withImage) => {
    const definition = makeDefinition();
    definition.researchDesign = {
      researchQuestion: "private-research-plan", population: "目标人群", recruitment: "private-recruitment-notes",
      purpose: "describe", timeBudgetMinutes: 5, constructs: [], analysisPlan: "仅描述",
      assumptions: ["private-assumption"], pendingDecisions: [],
    };
    if (withImage) definition.questions = [{
      id: "q1", title: "图片", type: "image_single", required: false,
      options: [{ id: "o1", label: "选项", imageFileId: "file-1" }],
    }];
    const result = toPublicDefinition(definition);
    expect(result).not.toHaveProperty("researchDesign");
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(definition.researchDesign.recruitment).toBe("private-recruitment-notes");
    if (withImage) expect(result.questions[0]).toMatchObject({
      options: [{ imageUrl: "/api/survey-public/assets/file-1" }],
    });
  });
});
