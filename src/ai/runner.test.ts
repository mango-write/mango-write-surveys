// 受限推理流程（issue #223 §6）：一次调用产出候选定义，不落库；解析/形状/
// 语义三层校验的失败都要给出可消化的 error。
import { describe, expect, it, vi } from "vitest";

import type { SurveyModelPort } from "./model.js";
import { generateSurveyDefinition } from "./runner.js";

const goodDefinition = {
  version: 1,
  title: "科研工具调查",
  description: "",
  consent: "",
  questions: [
    {
      id: "q1",
      type: "single",
      title: "是否使用",
      required: false,
      options: [
        { id: "o1", label: "是" },
        { id: "o2", label: "否" },
      ],
    },
  ],
  pages: [{ id: "p1", title: "页", questionIds: ["q1"] }],
  researchDesign: { researchQuestion: "了解使用情况", population: "", recruitment: "", constructs: [{ id: "c1", label: "使用", definition: "使用情况", questionIds: ["q1"] }], analysisPlan: "描述", assumptions: [], pendingDecisions: [] },
};

function modelReplying(text: string): SurveyModelPort {
  return { complete: vi.fn().mockResolvedValue({ text }) };
}

describe("generateSurveyDefinition", () => {
  it("独立建卷不接受模型伪造来源，也不保存未确认的匿名承诺", async () => {
    const fakeSource = [{ sourceId: "sus-brooke-1996", questionId: "q1", language: "zh-CN", baselineQuestion: "{}" }];
    const result = await generateSurveyDefinition(modelReplying(JSON.stringify({ ...goodDefinition, sourceRecords: fakeSource })), { title: "调查", brief: "了解使用情况" });
    if (!result.ok) throw new Error(result.error);
    expect(result.definition.sourceRecords?.[0]?.sourceId).toBe("ai-generated-unverified");
    const unsupported = await generateSurveyDefinition(modelReplying(JSON.stringify({ ...goodDefinition, consent: "匿名汇总" })), { title: "调查", brief: "不收集姓名" });
    expect(unsupported).toMatchObject({ ok: false, error: expect.stringContaining("未经确认") });
  });
  it("独立生成同样只保留用户明确提供的填写时长", async () => {
    const researchDesign = {
      researchQuestion: "使用情况", population: "", recruitment: "", constructs: [{ id: "c1", label: "使用情况", definition: "使用情况", questionIds: ["q1"] }],
      analysisPlan: "描述", assumptions: [], pendingDecisions: [], timeBudgetMinutes: 8,
    };
    const model = modelReplying(JSON.stringify({ ...goodDefinition, researchDesign }));
    const unknown = await generateSurveyDefinition(model, { title: "科研工具调查", brief: "了解工具使用" });
    const explicit = await generateSurveyDefinition(model, { title: "科研工具调查", brief: "填写时间不超过8分钟" });
    if (!unknown.ok || !explicit.ok) throw new Error("生成失败");
    expect(unknown.definition.researchDesign).not.toHaveProperty("timeBudgetMinutes");
    expect(explicit.definition.researchDesign?.timeBudgetMinutes).toBe(8);
  });

  it("从 ```json 围栏里解析候选；标题以调用方给定为准", async () => {
    const reply = { ...goodDefinition, title: "模型自作主张的标题" };
    const model = modelReplying("以下是问卷：\n```json\n" + JSON.stringify(reply) + "\n```");
    const result = await generateSurveyDefinition(model, { title: "科研工具调查", brief: "了解工具使用" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.definition.title).toBe("科研工具调查");
      expect(result.definition.questions).toHaveLength(1);
    }
  });

  it("形状不合法返回 ok:false，不落库也没有第二次调用", async () => {
    const model = modelReplying('{"version":1}');
    const result = await generateSurveyDefinition(model, { title: "x", brief: "y" });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("形状不合法");
  });

  it("语义校验不过（空页）返回 ok:false", async () => {
    const broken = JSON.parse(JSON.stringify(goodDefinition)) as typeof goodDefinition;
    broken.pages.push({ id: "p2", title: "空页", questionIds: [] });
    const model = modelReplying(JSON.stringify(broken));
    const result = await generateSurveyDefinition(model, { title: "科研工具调查", brief: "y" });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("empty_page");
  });

  it("入口的取消信号与超时原样转交 model port", async () => {
    const model = modelReplying(JSON.stringify(goodDefinition));
    const controller = new AbortController();
    await generateSurveyDefinition(
      model,
      { title: "科研工具调查", brief: "y" },
      { signal: controller.signal, timeoutMs: 8000 },
    );
    expect(model.complete).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal, timeoutMs: 8000 }),
    );
  });
});
