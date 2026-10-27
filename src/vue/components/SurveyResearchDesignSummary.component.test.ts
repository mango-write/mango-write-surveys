// 研究设计只读摘要卡：默认折叠（无 open 属性）、三行内容（研究问题 / 构念→
// 题号+计分 / 分析计划）与待确认事项；空设计给「还没有研究设计」与既有入口
// 指引，不做编辑器。jsdom 不做 details 折叠裁剪，内容断言不依赖展开态。
import { describe, expect, it } from "vitest";
import { mountSurveysComponent, createTestHost } from "../test-mount.js";
import { makeDefinition } from "../../core/test-fixtures.js";
import type { SurveyDefinition, SurveyResearchDesign } from "../../contracts/index.js";
import SurveyResearchDesignSummary from "./SurveyResearchDesignSummary.vue";

const design: SurveyResearchDesign = {
  researchQuestion: "研究生如何选用科研工具",
  population: "研究生",
  recruitment: "实验室招募",
  purpose: "measure",
  timeBudgetMinutes: 5,
  constructs: [
    {
      id: "c1",
      label: "易用性",
      definition: "感知易用程度",
      questionIds: ["q1", "q2"],
      scoring: { method: "mean", reverseVariableIds: [], minValid: 2 },
    },
    { id: "c2", label: "工具依赖", definition: "依赖程度", questionIds: [] },
  ],
  analysisPlan: "先信度，再 EFA，最后调节中介。",
  assumptions: [],
  pendingDecisions: ["是否需要按年级分层", "招募渠道待定"],
};

function mountSummary(props: { design: SurveyResearchDesign | null; definition?: SurveyDefinition }) {
  return mountSurveysComponent(
    SurveyResearchDesignSummary,
    {
      props: {
        design: props.design,
        definition: props.definition ?? makeDefinition(),
      },
    },
    createTestHost(),
  );
}

describe("SurveyResearchDesignSummary", () => {
  it("默认折叠：只露标题与已填写状态", () => {
    const wrapper = mountSummary({ design });
    const details = wrapper.find("details.design-summary");
    expect(details.exists()).toBe(true);
    expect(details.attributes("open")).toBeUndefined();
    expect(wrapper.text()).toContain("研究设计");
    expect(wrapper.text()).toContain("已填写");
    wrapper.unmount();
  });

  it("展开后：研究问题、每构念一行（题号列表 + 计分一句话）、分析计划与待确认事项", () => {
    const wrapper = mountSummary({ design });
    expect(wrapper.text()).toContain("研究生如何选用科研工具");
    // 题号与大纲同口径：q1、q2 是第 1、2 号。
    expect(wrapper.text()).toContain("易用性");
    expect(wrapper.text()).toContain("第 1、2 题");
    expect(wrapper.text()).toContain("计分：取均值，至少 2 题有效");
    // 无映射构念明说，不冒充已覆盖。
    expect(wrapper.text()).toContain("工具依赖");
    expect(wrapper.text()).toContain("映射待更新");
    expect(wrapper.text()).toContain("先信度，再 EFA，最后调节中介。");
    expect(wrapper.text()).toContain("待你确认");
    expect(wrapper.text()).toContain("是否需要按年级分层");
    wrapper.unmount();
  });

  it("空设计或只有试填合成的空基底：状态「未填写」+ 指向既有入口，不列内容", () => {
    const blankBase = { ...design, researchQuestion: "  ", constructs: [] };
    for (const empty of [null, blankBase]) {
      const wrapper = mountSummary({ design: empty });
      expect(wrapper.text()).toContain("未填写");
      expect(wrapper.text()).toContain("还没有研究设计");
      expect(wrapper.text()).not.toContain("待你确认");
      wrapper.unmount();
    }
  });
});
