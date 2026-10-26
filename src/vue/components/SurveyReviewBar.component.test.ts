// 画布诊断条测试（M2 评审）：摘要/状态/放弃/唯一整批应用入口；应用前可核对
// 候选项 before/after（definition 注入，review-change-rows 投影）；manual-only
// details 默认展开；manual/deferred 带 questionId 的发现可定位（emit locate）。
import { describe, expect, it } from "vitest";
import { mountSurveysComponent } from "../test-mount.js";
import { makeDefinition } from "../../core/test-fixtures.js";
import { buildSurveyReviewPlan } from "../../core/index.js";
import type { ToolSurveyDelivery } from "../../contracts/index.js";
import SurveyReviewBar from "./SurveyReviewBar.vue";

const baseFinding = {
  id: "f1", checkId: "wording.timeframe", questionId: "q1" as const, title: "时间范围", severity: "major" as const,
  reason: "缺少时间范围", recommendation: "说明过去一学期",
  suggestedOps: [{ op: "update_question" as const, questionId: "q1", patch: { title: "过去一学期的使用情况" } }],
};
const report = (overrides: Partial<Extract<ToolSurveyDelivery, { type: "survey_review" }>> = {}): Extract<ToolSurveyDelivery, { type: "survey_review" }> => ({
  type: "survey_review", surveyId: "s1", operationId: "review-1", baseDraftVersion: 1, summary: "澄清时间范围",
  findings: [{ ...baseFinding }],
  ...overrides,
});

function mountBar(reportInput: ReturnType<typeof report>, props: { stale?: boolean; busy?: boolean; disabled?: boolean } = {}) {
  const definition = makeDefinition();
  return mountSurveysComponent(SurveyReviewBar, {
    props: {
      report: reportInput,
      plan: buildSurveyReviewPlan(definition, reportInput.findings),
      definition,
      stale: props.stale ?? false,
      busy: props.busy ?? false,
      disabled: props.disabled ?? false,
    },
  });
}

function applyButton(wrapper: ReturnType<typeof mountBar>) {
  return wrapper.findAll("button").find((button) => button.text().includes("应用 1 组修改"));
}

describe("画布诊断条", () => {
  it("显示本次诊断摘要，ready 时提供唯一整批应用并向上发事件", async () => {
    const wrapper = mountBar(report());
    expect(wrapper.text()).toContain("澄清时间范围");
    const apply = applyButton(wrapper)!;
    expect(apply.exists()).toBe(true);
    await apply.trigger("click");
    expect(wrapper.emitted("apply")).toEqual([[]]);
    wrapper.unmount();
  });

  it("过期状态禁用应用并明示需重新检查；busy 状态同样禁用", async () => {
    const stale = mountBar(report(), { stale: true });
    expect(stale.text()).toContain("问卷已修改");
    expect(applyButton(stale)!.attributes("disabled")).toBeDefined();
    stale.unmount();

    const busy = mountBar(report(), { busy: true });
    expect(applyButton(busy)!.attributes("disabled")).toBeDefined();
    busy.unmount();
  });

  it("应用前可核对候选改动：before/after 在 details 中真实可读，不是盲应用", () => {
    const wrapper = mountBar(report());
    const changes = wrapper.find(".review-bar-changes");
    expect(changes.exists()).toBe(true);
    expect(changes.element.hasAttribute("open")).toBe(false);
    expect(changes.text()).toContain("候选项修改前后");
    expect(changes.text()).toContain("单选");
    expect(changes.text()).toContain("过去一学期的使用情况");
    // 候选行可定位到题。
    const locate = changes.find(".change-location");
    expect(locate.exists()).toBe(true);
    wrapper.unmount();
  });

  it("researchDesign/meta 候选改动同样可核对（不依赖研究面板）", () => {
    const wrapper = mountBar(report({
      findings: [{
        ...baseFinding, id: "f-meta", questionId: undefined,
        suggestedOps: [{
          op: "set_meta", title: "新标题",
          researchDesign: {
            researchQuestion: "使用情况", population: "研究生", recruitment: "自愿招募", purpose: "describe",
            timeBudgetMinutes: 5, constructs: [], analysisPlan: "逐题报告有效数与缺失数", assumptions: [], pendingDecisions: [],
          },
        }],
      }],
    }));
    const changes = wrapper.find(".review-bar-changes");
    expect(changes.exists()).toBe(true);
    expect(changes.text()).toContain("逐题报告有效数与缺失数");
    expect(changes.text()).toContain("新标题");
    wrapper.unmount();
  });

  it("empty 报告不冒充有问题，也不给应用按钮", () => {
    const wrapper = mountBar(report({ findings: [] }));
    expect(wrapper.text()).toContain("本次未发现需要修改的问题");
    expect(applyButton(wrapper)).toBeUndefined();
    wrapper.unmount();
  });

  it("blocked 状态暂停整批应用并说明冲突，且无候选可核对", () => {
    const finding = report().findings[0]!;
    const wrapper = mountBar(report({
      findings: [finding, { ...finding, id: "f2", suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: "另一版本" } }] }],
    }));
    expect(wrapper.text()).toContain("这些修改存在冲突");
    expect(applyButton(wrapper)).toBeUndefined();
    expect(wrapper.find(".review-bar-changes").exists()).toBe(false);
    wrapper.unmount();
  });

  it("放弃按钮发出 discard，应用与放弃互不影响状态判断", async () => {
    const wrapper = mountBar(report());
    await wrapper.findAll("button").find((button) => button.text() === "放弃本次诊断")!.trigger("click");
    expect(wrapper.emitted("discard")).toEqual([[]]);
    wrapper.unmount();
  });

  it("manual-only 的 details 默认展开；带题号的人工项可定位", async () => {
    const wrapper = mountBar(report({
      findings: [{ ...baseFinding, suggestedOps: undefined }],
    }));
    const more = wrapper.find(".review-bar-more");
    expect(more.exists()).toBe(true);
    expect(more.element.hasAttribute("open")).toBe(true);
    expect(more.text()).toContain("时间范围");
    expect(more.text()).toContain("缺少时间范围");
    expect(more.findAll("a").some((link) => link.attributes("href")?.startsWith("https://"))).toBe(true);
    // manual-only 没有整批应用，但可定位到题。
    expect(applyButton(wrapper)).toBeUndefined();
    const locate = more.findAll("button").find((button) => button.text() === "第 1 题")!;
    await locate.trigger("click");
    expect(wrapper.emitted("locate")).toEqual([["q1"]]);
    wrapper.unmount();
  });

  it("ready 方案下的人工项 details 默认折叠，不与应用核对区抢视线", () => {
    const wrapper = mountBar(report({
      findings: [baseFinding, { ...baseFinding, id: "f2", questionId: undefined, suggestedOps: undefined }],
    }));
    expect(wrapper.find(".review-bar-more").element.hasAttribute("open")).toBe(false);
    wrapper.unmount();
  });

  it("目录外发现标注独立核验提示，不引用不存在的出处", () => {
    const wrapper = mountBar(report({
      findings: [baseFinding, { ...baseFinding, id: "f2", checkId: undefined, questionId: undefined, suggestedOps: undefined }],
    }));
    const more = wrapper.find(".review-bar-more");
    expect(more.text()).toContain("目录外发现");
    wrapper.unmount();
  });
});
