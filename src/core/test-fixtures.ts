import type { SurveyDefinition } from "./definition.js";

// 合法基准：p1 单选+多选（z 互斥，含 y 时跳 p3），p2 文本(q1=a 才显示)+数字，p3 量表。
export function makeDefinition(): SurveyDefinition {
  return {
    version: 1,
    title: "测试问卷",
    description: "",
    consent: "",
    questions: [
      {
        id: "q1",
        type: "single",
        title: "单选",
        required: true,
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
      {
        id: "q2",
        type: "multiple",
        title: "多选",
        required: false,
        options: [
          { id: "x", label: "X" },
          { id: "y", label: "Y" },
          { id: "z", label: "Z", exclusive: true },
        ],
        minChoices: 1,
        maxChoices: 2,
      },
      {
        id: "q3",
        type: "text",
        title: "文本",
        required: true,
        showIf: { questionId: "q1", op: "eq", value: "a" },
      },
      {
        id: "q4",
        type: "number",
        title: "数字",
        required: true,
        min: 0,
        max: 120,
      },
      {
        id: "q5",
        type: "scale",
        title: "量表",
        required: false,
        min: 1,
        max: 5,
      },
    ],
    pages: [
      {
        id: "p1",
        title: "一",
        questionIds: ["q1", "q2"],
        jump: {
          when: { questionId: "q2", op: "contains", value: "y" },
          targetPageId: "p3",
        },
      },
      { id: "p2", title: "二", questionIds: ["q3", "q4"] },
      { id: "p3", title: "三", questionIds: ["q5"] },
    ],
  };
}

// 隐藏链：c2 只在 c1=a 时可见，c3 只在 c2=open 时可见——c2 被隐藏时它的答案不能点亮 c3。
export function makeChainDefinition(): SurveyDefinition {
  return {
    version: 1,
    title: "链",
    description: "",
    consent: "",
    questions: [
      {
        id: "c1",
        type: "single",
        title: "c1",
        required: true,
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
      {
        id: "c2",
        type: "text",
        title: "c2",
        required: false,
        showIf: { questionId: "c1", op: "eq", value: "a" },
      },
      {
        id: "c3",
        type: "single",
        title: "c3",
        required: false,
        showIf: { questionId: "c2", op: "eq", value: "open" },
        options: [
          { id: "x", label: "X" },
          { id: "y", label: "Y" },
        ],
      },
    ],
    pages: [
      { id: "p1", title: "一", questionIds: ["c1", "c2"] },
      { id: "p2", title: "二", questionIds: ["c3"] },
    ],
  };
}
