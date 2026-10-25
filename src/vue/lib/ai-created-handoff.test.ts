// AI 建卷落地交接单槽（issue #217）：写入 → 按 surveyId 取走（取走即清 =
// 刷新/重进不重复）；surveyId 不匹配不清槽（绕路打开别的问卷不丢提示）。
import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetAiCreatedSurveyHandoffForTest,
  setAiCreatedSurveyHandoff,
  takeAiCreatedSurveyHandoff,
} from "./ai-created-handoff";

const FRAME = {
  type: "survey_create" as const,
  surveyId: "00000000-0000-4000-8000-000000000001",
  operationId: "op-handoff-1",
  title: "科研工具使用习惯调查",
};

describe("ai-created-handoff（issue #217）", () => {
  beforeEach(() => __resetAiCreatedSurveyHandoffForTest());

  it("写入后按匹配的 surveyId 取走载荷，取走即清（落地提示只出现一次）", () => {
    setAiCreatedSurveyHandoff(FRAME);
    expect(takeAiCreatedSurveyHandoff(FRAME.surveyId)).toEqual(FRAME);
    // 二次取（组件重挂/刷新后的再 load）不再重复。
    expect(takeAiCreatedSurveyHandoff(FRAME.surveyId)).toBeNull();
  });

  it("surveyId 不匹配不清槽：绕路打开别的问卷后再进目标卷仍能取到", () => {
    setAiCreatedSurveyHandoff(FRAME);
    expect(takeAiCreatedSurveyHandoff("00000000-0000-4000-8000-00000000ffff")).toBeNull();
    expect(takeAiCreatedSurveyHandoff(FRAME.surveyId)).toEqual(FRAME);
  });

  it("空槽直接取返回 null", () => {
    expect(takeAiCreatedSurveyHandoff(FRAME.surveyId)).toBeNull();
  });
});
