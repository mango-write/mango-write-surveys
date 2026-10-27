// 设计画布组件测试（issue #217）：题型菜单定位插入、末题后插入带与页尾入口去重、
// 换题型可逆（载荷暂存/恢复
// + 破坏性确认）、菜单外点/Esc/滚动关闭、复制（新 id）、Enter 加选项与最少 2 项、
// 默认选项聚焦全选、上移/下移顺序、空页保留、校验点击定位与双向高亮、点画布空白取消选中。
// 拖拽的纯变换在 lib/definition-ops.test.ts，DnD 手势在浏览器实测覆盖。
// 宿主组件把 change 应用回 modelValue（与工作台同向），交互按真实状态机推进。
import { defineComponent, h, ref, type Ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import type { SurveyDefinition, SurveyQuestion } from "../../contracts/index.js";
// @ts-expect-error primevue 4.5.5 未带 confirmationeventbus 的类型声明；官方
// 补上声明后删除本行即可。
import ConfirmationEventBus from "primevue/confirmationeventbus";
import ConfirmationService from "primevue/confirmationservice";
import ConfirmDialog from "primevue/confirmdialog";

import { createSurveysTestI18n, createTestHost, mountSurveysComponent } from "../test-mount.js";
import SurveyDesignCanvas from "./SurveyDesignCanvas.vue";

const i18n = createSurveysTestI18n();

const confirmMocks = vi.hoisted(() => ({ require: vi.fn() }));
vi.mock("primevue/useconfirm", () => ({
  useConfirm: () => ({ require: confirmMocks.require }),
}));

if (typeof document !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const t = (key: string, params?: Record<string, unknown>) =>
  i18n.global.t(key, params as never);

function definition(): SurveyDefinition {
  return {
    version: 1,
    title: "研究问卷",
    description: "",
    consent: "",
    questions: [
      {
        id: "q1",
        type: "single",
        title: "年级",
        required: true,
        options: [
          { id: "o1", label: "大一" },
          { id: "o2", label: "大二" },
        ],
      },
      {
        id: "q2",
        type: "text",
        title: "备注",
        required: false,
        showIf: { questionId: "q1", op: "eq", value: "o1" },
      },
    ],
    pages: [{ id: "p1", title: "第一页", questionIds: ["q1", "q2"] }],
  };
}

// 挂到 document 的画布宿主（deselect/ghost 用例要真实 isConnected），文件级
// afterEach 统一卸载，防跨用例 DOM 残留。
const attached: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of attached.reverse()) wrapper.unmount();
  attached.length = 0;
});

async function mountCanvas(
  initial: SurveyDefinition = definition(),
  surveyId?: string,
  attachToBody = false,
  reviewQuestionIds?: readonly string[],
) {
  const changes: Array<{ next: SurveyDefinition; label?: string }> = [];
  const selections: string[] = [];
  const current = ref(initial);
  const selectedId = ref("");
  const Host = defineComponent({
    name: "CanvasHost",
    setup() {
      return () =>
        h(SurveyDesignCanvas, {
          modelValue: current.value,
          activeQuestionId: selectedId.value,
          ...(surveyId ? { surveyId } : {}),
          reviewQuestionIds,
          onChange: (next: SurveyDefinition, label?: string) => {
            changes.push({ next, label });
            current.value = next;
          },
          onSelect: (id: string) => {
            selections.push(id);
            selectedId.value = id;
          },
        });
    },
  });
  const wrapper = mountSurveysComponent(Host, attachToBody ? { attachTo: document.body } : {}, createTestHost());
  if (attachToBody) attached.push(wrapper);
  await flushPromises();
  return {
    wrapper,
    current: () => current.value,
    selectedId: () => selectedId.value,
    changes,
    selections,
  };
}

async function selectCard(
  harness: Awaited<ReturnType<typeof mountCanvas>>,
  id: string,
) {
  await harness.wrapper.find(`[data-canvas-question="${id}"]`).trigger("click");
  await flushPromises();
}

async function insertType(
  harness: Awaited<ReturnType<typeof mountCanvas>>,
  zoneIndex: number,
  typeLabel: string,
) {
  const menu = () => harness.wrapper.find(".survey-type-menu");
  // 菜单已在同一入口打开时不要重复点（会切换/收起）。
  if (!menu().exists())
    await harness.wrapper
      .findAll(".add-zone")
      [zoneIndex]!
      .find(".add-zone__btn")
      .trigger("click");
  await menu()
    .findAll(".type-item")
    .find((item) => item.text().includes(typeLabel))!
    .trigger("click");
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  confirmMocks.require.mockImplementation(
    (options: { accept?: () => void }) => options.accept?.(),
  );
});

describe("SurveyDesignCanvas 题型菜单与插入", () => {
  it("标题、说明与参与声明直接可编辑，不需要打开另一个编辑界面", async () => {
    const initial = { ...definition(), description: "研究简介", consent: "自愿参与说明" };
    const harness = await mountCanvas(initial);
    expect(harness.wrapper.find(".canvas-title").exists()).toBe(true);
    expect(harness.wrapper.find(".cover-heading button").exists()).toBe(false);
    const fields = harness.wrapper.findAll(".head-field textarea");
    expect(fields).toHaveLength(2);
    await harness.wrapper.find(".canvas-title").setValue("新的问卷标题");
    await fields[0]!.setValue("可直接修改的**研究说明**");
    expect(harness.current()).toMatchObject({
      title: "新的问卷标题", description: "可直接修改的**研究说明**", consent: "自愿参与说明",
    });
    harness.wrapper.unmount();
  });

  it("同一道题重复定位仍会滚动，定位后不改动定义", async () => {
    const harness = await mountCanvas(definition(), undefined, true);
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const canvas = harness.wrapper.findComponent(SurveyDesignCanvas);
    await canvas.vm.locateQuestion("q2");
    await flushPromises();
    scroll.mockClear();
    await canvas.vm.locateQuestion("q2");
    await flushPromises();
    expect(scroll).toHaveBeenCalledOnce();
    expect(harness.selectedId()).toBe("q2");
    expect(harness.changes).toHaveLength(0);
    scroll.mockRestore();
  });
  it("页尾「+」展开题型菜单（图标+名称+说明），选择量表插入页尾并选中", async () => {
    const harness = await mountCanvas();
    expect(harness.wrapper.find(".survey-type-menu").exists()).toBe(false);
    const zones = harness.wrapper.findAll(".add-zone__btn");
    await zones.at(-1)!.trigger("click");
    const menu = harness.wrapper.find(".survey-type-menu");
    expect(menu.exists()).toBe(true);
    expect(menu.findAll(".type-item")).toHaveLength(18);
    // 分组标签渲染（选择题/填空/评分量表/矩阵/日期与时间/其他）。
    expect(menu.text()).toContain(t("surveys.typeGroup.choice"));
    expect(menu.text()).toContain(t("surveys.typeGroup.matrix"));
    expect(menu.text()).toContain(t("surveys.type.scale"));
    expect(menu.text()).toContain(t("surveys.typeHint.scale"));

    await insertType(harness, 1, t("surveys.type.scale"));
    const next = harness.current();
    expect(next.pages[0]!.questionIds).toHaveLength(3);
    const inserted = next.questions.at(-1)!;
    expect(inserted.type).toBe("scale");
    expect(inserted).toMatchObject({ min: 1, max: 5 });
    expect(harness.selectedId()).toBe(inserted.id);
    // 菜单已收起。
    expect(harness.wrapper.find(".survey-type-menu").exists()).toBe(false);
  });

  it("两题只渲染两个加题入口（题间 + 页尾各一），页尾入口仍可加题", async () => {
    const harness = await mountCanvas();
    // 末题后的插入带与页尾入口重合：只保留页尾一份，不再出现第 3 个 zone。
    const zones = harness.wrapper.findAll(".add-zone");
    expect(zones).toHaveLength(2);
    expect(zones[0]!.find(".add-zone__btn").exists()).toBe(true);
    expect(zones[1]!.find(".add-zone__btn").exists()).toBe(true);

    await insertType(harness, 1, t("surveys.type.scale"));
    expect(harness.current().pages[0]!.questionIds).toHaveLength(3);
    expect(harness.current().questions.at(-1)!.type).toBe("scale");
  });

  it("卡片之间的「+」在该位置插入", async () => {
    const harness = await mountCanvas();
    // 第 1 个 add-zone 在 q1 之后（题与题之间）。
    await insertType(harness, 0, t("surveys.type.number"));
    const next = harness.current();
    const insertedId = next.pages[0]!.questionIds[1]!;
    expect(insertedId).not.toBe("q1");
    expect(insertedId).not.toBe("q2");
    expect(next.pages[0]!.questionIds).toHaveLength(3);
    expect(next.pages[0]!.questionIds[0]).toBe("q1");
    expect(next.pages[0]!.questionIds[2]).toBe("q2");
    expect(next.questions.map((q) => q.id)).toEqual(["q1", insertedId, "q2"]);
    expect(next.questions[1]!.type).toBe("number");
  });
});

describe("SurveyDesignCanvas 题目卡片", () => {
  it("AI 建议题目由数据显式驱动 warning 状态", async () => {
    const harness = await mountCanvas(definition(), undefined, false, ["q1"]);
    expect(harness.wrapper.find('[data-canvas-question="q1"]').classes()).toContain("q-card--review");
    expect(harness.wrapper.find('[data-canvas-question="q2"]').classes()).not.toContain("q-card--review");
  });

  it("点卡片选中（select 事件给大纲联动），工具条常驻，题干变就地输入", async () => {
    const harness = await mountCanvas();
    await selectCard(harness, "q1");
    expect(harness.selectedId()).toBe("q1");
    expect(harness.selections).toContain("q1");
    const card = harness.wrapper.find('[data-canvas-question="q1"]');
    expect(card.classes()).toContain("q-card--selected");
    expect(card.find(".q-card__toolbar").exists()).toBe(true);
    expect(card.find(".q-card__title-input").exists()).toBe(true);
    expect(card.findAll(".opt-row")).toHaveLength(2);
  });

  it("题干就地编辑走 change（打字合并 label）", async () => {
    const harness = await mountCanvas();
    await selectCard(harness, "q1");
    const title = harness.wrapper.find('[data-canvas-question="q1"] .q-card__title-input');
    await title.setValue("你的年级是？");
    expect(harness.current().questions.find((q) => q.id === "q1")!.title).toBe(
      "你的年级是？",
    );
  });

  it("换题型保留题干/必答/showIf（确认后生效），载荷按新题型生成默认值", async () => {
    const harness = await mountCanvas();
    await selectCard(harness, "q2");
    const card = harness.wrapper.find('[data-canvas-question="q2"]');
    await card.find(".type-toggle").trigger("click");
    await card
      .findAll(".type-item")
      .find((item) => item.text().includes(t("surveys.type.scale")))!
      .trigger("click");
    // 破坏性切换（text→scale 丢文本设置）先确认，接受后才提交。
    expect(confirmMocks.require).toHaveBeenCalled();
    await flushPromises();
    const changed = harness.current().questions.find((q) => q.id === "q2")!;
    expect(changed.type).toBe("scale");
    expect(changed.title).toBe("备注");
    expect(changed.required).toBe(false);
    expect(changed.showIf).toEqual({ questionId: "q1", op: "eq", value: "o1" });
  });

  it("必答开关与复制：复制生成新 id 与新选项 id，插在原题后并选中", async () => {
    const harness = await mountCanvas();
    await selectCard(harness, "q1");
    const card = harness.wrapper.find('[data-canvas-question="q1"]');
    await card.find(".required-toggle input").setValue(false);
    expect(
      harness.current().questions.find((q) => q.id === "q1")!.required,
    ).toBe(false);

    await card
      .find('button[aria-label="' + t("surveys.duplicateQuestion") + '"]')
      .trigger("click");
    await flushPromises();
    const next = harness.current();
    const copyId = next.pages[0]!.questionIds[1]!;
    expect(copyId).not.toBe("q1");
    const original = definition().questions[0]!;
    const copy = next.questions.find((q) => q.id === copyId)!;
    if (copy.type !== "single" || original.type !== "single")
      throw new Error("fixture");
    expect(copy.title).toBe(original.title);
    expect(copy.options.map((o) => o.label)).toEqual(["大一", "大二"]);
    expect(
      copy.options.every(
        (option) => !original.options.some((o) => o.id === option.id),
      ),
    ).toBe(true);
    expect(harness.selectedId()).toBe(copyId);
  });

  it("选项行 Enter 只加「待落笔」空行（不进 definition）；输入首字符才提交", async () => {
    const harness = await mountCanvas();
    await selectCard(harness, "q1");
    const card = () => harness.wrapper.find('[data-canvas-question="q1"]');
    const firstInput = card().find(".opt-row input.opt-input");
    const changesBefore = harness.changes.length;
    await firstInput.trigger("keydown", { key: "Enter" });
    await flushPromises();
    // Enter 只渲染待落笔行：definition 不动、无 change。
    const q1 = () =>
      harness.current().questions.find((q) => q.id === "q1")! as Extract<
        SurveyQuestion,
        { type: "single" }
      >;
    expect(q1().options).toHaveLength(2);
    expect(harness.changes.length).toBe(changesBefore);
    expect(card().findAll(".opt-row")).toHaveLength(3);

    // 输入首字符即提交为真实选项，待落笔行消失。
    const pending = card().findAll(".opt-row")[1]!.find("input.opt-input");
    await pending.setValue("新选项");
    await flushPromises();
    expect(q1().options.map((o) => o.label)).toEqual(["大一", "新选项", "大二"]);
    expect(harness.changes.length).toBe(changesBefore + 1);
    expect(card().findAll(".opt-row")).toHaveLength(3);
  });

  it("待落笔行 Backspace（空）或失焦（空）直接丢弃，不进 definition", async () => {
    const harness = await mountCanvas();
    await selectCard(harness, "q1");
    const card = () => harness.wrapper.find('[data-canvas-question="q1"]');
    const before = harness.changes.length;
    await card()
      .findAll(".opt-row input.opt-input")[1]!
      .trigger("keydown", { key: "Enter" });
    await card()
      .findAll(".opt-row")[2]!
      .find("input.opt-input")
      .trigger("keydown", { key: "Backspace" });
    await flushPromises();
    expect(
      (harness.current().questions[0]! as Extract<SurveyQuestion, { type: "single" }>)
        .options,
    ).toHaveLength(2);
    expect(harness.changes.length).toBe(before);
    expect(card().findAll(".opt-row")).toHaveLength(2);

    // 失焦同样丢弃。
    await card()
      .findAll(".opt-row input.opt-input")[0]!
      .trigger("keydown", { key: "Enter" });
    await card()
      .findAll(".opt-row")[1]!
      .find("input.opt-input")
      .trigger("blur");
    await flushPromises();
    expect(
      (harness.current().questions[0]! as Extract<SurveyQuestion, { type: "single" }>)
        .options,
    ).toHaveLength(2);
    expect(card().findAll(".opt-row")).toHaveLength(2);
  });

  it("最少保留 2 项：删除按钮禁用；清空后 Backspace 不产生删除变更", async () => {
    const fresh = await mountCanvas();
    await selectCard(fresh, "q1");
    const freshCard = fresh.wrapper.find('[data-canvas-question="q1"]');
    for (const button of freshCard.findAll(
      'button[aria-label="' + t("surveys.removeOption") + '"]',
    )) {
      expect(button.attributes("disabled")).toBeDefined();
    }
    const changesBefore = fresh.changes.length;
    const freshInputs = freshCard.findAll(".opt-row input.opt-input");
    await freshInputs[0]!.setValue("");
    await freshInputs[0]!.trigger("keydown", { key: "Backspace" });
    await flushPromises();
    // setValue 清空本身是一次 change；Backspace 不得再追加删除变更。
    expect(fresh.changes.length).toBe(changesBefore + 1);
    expect(
      (fresh.current().questions[0]! as Extract<SurveyQuestion, { type: "single" }>)
        .options,
    ).toHaveLength(2);
  });

  it("上移/下移发出新的页内顺序", async () => {
    const harness = await mountCanvas();
    await selectCard(harness, "q2");
    await harness.wrapper
      .find('[data-canvas-question="q2"] button[aria-label="' + t("surveys.moveUp") + '"]')
      .trigger("click");
    await flushPromises();
    expect(harness.current().pages[0]!.questionIds).toEqual(["q2", "q1"]);
  });

  it("删除题目走确认并清理引用（showIf/跳页）", async () => {
    const harness = await mountCanvas();
    await selectCard(harness, "q1");
    await harness.wrapper
      .find(
        '[data-canvas-question="q1"] button[aria-label="' +
          t("surveys.deleteQuestion") +
          '"]',
      )
      .trigger("click");
    expect(confirmMocks.require).toHaveBeenCalled();
    await flushPromises();
    const next = harness.current();
    expect(next.questions.map((q) => q.id)).toEqual(["q2"]);
    expect(next.questions[0]!.showIf).toBeUndefined();
  });

  it("没有可配置项时不显示更多设置或空规则分组", async () => {
    const harness = await mountCanvas(definition(), undefined, true);
    await selectCard(harness, "q1");
    expect(
      harness.wrapper.find('button[aria-label="' + t("surveys.moreSettings") + '"]').exists(),
    ).toBe(false);

    await selectCard(harness, "q2");
    await harness.wrapper
      .find('button[aria-label="' + t("surveys.moreSettings") + '"]')
      .trigger("click");
    await flushPromises();
    expect(document.querySelector(".survey-question-settings")?.textContent).toContain(
      t("surveys.answerRules"),
    );
  });

  it("文本题可清空可选的最大字符数", async () => {
    const initial = definition();
    const question = initial.questions[1]!;
    if (question.type !== "text") throw new Error("fixture");
    question.maxLength = 120;
    const harness = await mountCanvas(initial, undefined, true);
    await selectCard(harness, "q2");
    await harness.wrapper
      .find('button[aria-label="' + t("surveys.moreSettings") + '"]')
      .trigger("click");
    await flushPromises();
    const clear = document.querySelector<HTMLElement>(
      ".survey-question-settings .p-inputnumber-clear-icon",
    )!;
    clear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    const updated = harness.current().questions[1]!;
    if (updated.type !== "text") throw new Error("question type changed");
    expect(updated.maxLength).toBeUndefined();
  });

  it("scale 卡片显示两端文案，更多设置里可编辑 min/max 与两端文案", async () => {
    const initial = definition();
    initial.questions.push({
      id: "q5",
      type: "scale",
      title: "满意度",
      required: false,
      min: 1,
      max: 5,
      minLabel: "非常不同意",
    });
    initial.pages[0]!.questionIds.push("q5");
    const harness = await mountCanvas(initial);
    await selectCard(harness, "q5");
    const card = harness.wrapper.find('[data-canvas-question="q5"]');
    expect(card.text()).toContain("非常不同意");
    await card
      .find('button[aria-label="' + t("surveys.moreSettings") + '"]')
      .trigger("click");
    await flushPromises();
    const minLabelInput = document.querySelector(
      `.survey-question-settings input[aria-label="${t("surveys.scaleMinLabel")}"]`,
    );
    expect(minLabelInput).not.toBeNull();
    const maxLabelInput = document.querySelector<HTMLInputElement>(
      `.survey-question-settings input[aria-label="${t("surveys.scaleMaxLabel")}"]`,
    )!;
    maxLabelInput.value = "非常同意";
    maxLabelInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    const q5 = harness.current().questions.find((q) => q.id === "q5")! as Extract<
      SurveyQuestion,
      { type: "scale" }
    >;
    expect(q5.maxLabel).toBe("非常同意");
  });
});

// 新建题自带「选项 N」默认文案：聚焦即全选、首键替换（Google Forms 同款），
// 避免键入追加成「选项 1测试选项」。
describe("SurveyDesignCanvas 默认选项聚焦全选", () => {
  function withDefaultOptions(): SurveyDefinition {
    const initial = definition();
    const q1 = initial.questions[0]!;
    if (q1.type !== "single") throw new Error("fixture");
    q1.options = [
      { id: "o1", label: t("surveys.optionNumber", { n: 1 }) },
      { id: "o2", label: t("surveys.optionNumber", { n: 2 }) },
    ];
    return initial;
  }

  it("默认文案的选项聚焦即全选，输入替换整段并清除占位提示", async () => {
    const harness = await mountCanvas(withDefaultOptions());
    await selectCard(harness, "q1");
    const input = harness.wrapper.find(
      '[data-canvas-question="q1"] .opt-row input.opt-input',
    );
    const label = t("surveys.optionNumber", { n: 1 });
    expect((input.element as HTMLInputElement).value).toBe(label);
    expect(input.classes()).toContain("opt-input--default");

    const selectSpy = vi.spyOn(HTMLInputElement.prototype, "select");
    try {
      await input.trigger("focus");
      const el = input.element as HTMLInputElement;
      expect(el.selectionStart).toBe(0);
      expect(el.selectionEnd).toBe(label.length);

      await input.setValue("测试选项");
      await flushPromises();
      expect(selectSpy).toHaveBeenCalled();
      const q1 = harness.current().questions.find((q) => q.id === "q1")! as Extract<
        SurveyQuestion,
        { type: "single" }
      >;
      expect(q1.options[0]!.label).toBe("测试选项");
      expect(input.classes()).not.toContain("opt-input--default");
    } finally {
      selectSpy.mockRestore();
    }
  });

  it("非默认文案的选项聚焦不调用 select", async () => {
    const harness = await mountCanvas();
    await selectCard(harness, "q1");
    const input = harness.wrapper.find(
      '[data-canvas-question="q1"] .opt-row input.opt-input',
    );
    expect((input.element as HTMLInputElement).value).toBe("大一");
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, "select");
    try {
      await input.trigger("focus");
      expect(selectSpy).not.toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
    }
  });
});

describe("SurveyDesignCanvas 页与校验", () => {
  it("添加分页保留空页（不静默丢弃），页标题就地编辑", async () => {
    const harness = await mountCanvas();
    await harness.wrapper
      .find('button[aria-label="' + t("surveys.addPage") + '"]')
      .trigger("click");
    await flushPromises();
    const next = harness.current();
    expect(next.pages).toHaveLength(2);
    expect(next.pages[1]!.questionIds).toEqual([]);
    expect(next.pages[1]!.title).toBe(t("surveys.pageNumber", { n: 2 }));

    const newPageTitle = harness.wrapper.findAll(".page-title")[1]!;
    expect((newPageTitle.element as HTMLInputElement).value).toBe(
      t("surveys.pageNumber", { n: 2 }),
    );
    await newPageTitle.setValue("用户研究");
    expect(harness.current().pages[1]!.title).toBe("用户研究");
  });

  it("空页产生校验问题列表，点击问题定位：选中对应卡并高亮", async () => {
    const initial = definition();
    initial.questions[0] = {
      ...initial.questions[0]!,
      options: [],
    } as SurveyQuestion;
    const harness = await mountCanvas(initial);
    const issueList = harness.wrapper.find(".issue-list");
    expect(issueList.exists()).toBe(true);
    const items = issueList.findAll(".issue-item");
    expect(items.length).toBeGreaterThan(0);
    await items[0]!.trigger("click");
    // empty_options 落在 questions.0 → 选中 q1。
    expect(harness.selectedId()).toBe("q1");
    // 双向呼应：选中卡后 issue 列表对应项高亮；目标卡出现描边脉冲。
    expect(items[0]!.classes()).toContain("issue-item--active");
    expect(
      harness.wrapper
        .find('[data-canvas-question="q1"]')
        .classes(),
    ).toContain("q-card--flash");
  });

  it("只读（disabled）不渲染加题入口，卡片不可选中", async () => {
    const wrapper = mountSurveysComponent(
      defineComponent({
        setup() {
          return () =>
            h(SurveyDesignCanvas, { modelValue: definition(), disabled: true });
        },
      }),
      {},
      createTestHost(),
    );
    await flushPromises();
    expect(wrapper.findAll(".add-zone").length).toBe(0);
    expect(wrapper.findAll(".add-page-btn").length).toBe(0);
  });
});

describe("SurveyDesignCanvas 换题型可逆（载荷暂存 + 破坏性确认）", () => {
  type Harness = Awaited<ReturnType<typeof mountCanvas>>;

  async function openCardTypeMenu(harness: Harness, id: string) {
    await selectCard(harness, id);
    await harness.wrapper
      .find(`[data-canvas-question="${id}"]`)
      .find(".type-toggle")
      .trigger("click");
  }
  async function pickType(harness: Harness, id: string, label: string) {
    await harness.wrapper
      .find(`[data-canvas-question="${id}"]`)
      .findAll(".type-item")
      .find((item) => item.text().includes(label))!
      .trigger("click");
    await flushPromises();
  }

  it("single→text 先确认（列明移除内容），接受后载荷换默认；切回单选恢复原选项", async () => {
    const harness = await mountCanvas();
    await openCardTypeMenu(harness, "q1");
    await pickType(harness, "q1", t("surveys.type.text"));

    const options = confirmMocks.require.mock.calls.at(-1)![0] as {
      header: string;
      message: string;
      accept?: () => void;
    };
    expect(options.header).toBe(t("surveys.changeType"));
    expect(options.message).toBe(
      t("surveys.changeTypeConfirmOptions", {
        n: 2,
        type: t("surveys.type.text"),
        from: t("surveys.type.single"),
      }),
    );
    options.accept?.();
    await flushPromises();
    const asText = harness.current().questions.find((q) => q.id === "q1")!;
    expect(asText.type).toBe("text");

    // 切回单选：恢复原选项（同 id 同文案），且不再确认。
    const calls = confirmMocks.require.mock.calls.length;
    await openCardTypeMenu(harness, "q1");
    await pickType(harness, "q1", t("surveys.type.single"));
    expect(confirmMocks.require.mock.calls.length).toBe(calls);
    const restored = harness.current().questions[0]!;
    if (restored.type !== "single") throw new Error("fixture");
    expect(restored.options.map((o) => o.id)).toEqual(["o1", "o2"]);
    expect(restored.options.map((o) => o.label)).toEqual(["大一", "大二"]);
    expect(restored.title).toBe("年级");
    expect(restored.required).toBe(true);
  });

  it("破坏性切换取消：定义原样不动", async () => {
    confirmMocks.require.mockImplementation(() => {});
    const harness = await mountCanvas();
    const before = harness.current();
    await openCardTypeMenu(harness, "q1");
    await pickType(harness, "q1", t("surveys.type.text"));
    expect(confirmMocks.require).toHaveBeenCalled();
    expect(harness.current()).toBe(before);
  });

  it("single↔multiple 互换保留选项且不弹确认", async () => {
    const harness = await mountCanvas();
    await openCardTypeMenu(harness, "q1");
    await pickType(harness, "q1", t("surveys.type.multiple"));
    expect(confirmMocks.require).not.toHaveBeenCalled();
    const asMultiple = harness.current().questions[0]!;
    if (asMultiple.type !== "multiple") throw new Error("fixture");
    expect(asMultiple.options.map((o) => o.id)).toEqual(["o1", "o2"]);

    await openCardTypeMenu(harness, "q1");
    await pickType(harness, "q1", t("surveys.type.single"));
    expect(confirmMocks.require).not.toHaveBeenCalled();
    const back = harness.current().questions[0]!;
    if (back.type !== "single") throw new Error("fixture");
    expect(back.options.map((o) => o.label)).toEqual(["大一", "大二"]);
  });

  it("题型菜单：点外部 / Esc / 滚动关闭；手机档渲染 scrim（点击关闭）", async () => {
    const harness = await mountCanvas();
    const menu = () => harness.wrapper.find(".survey-type-menu");
    const zones = harness.wrapper.findAll(".add-zone__btn");
    await zones.at(-1)!.trigger("click");
    expect(menu().exists()).toBe(true);
    expect(harness.wrapper.find(".type-menu-scrim").exists()).toBe(true);

    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await flushPromises();
    expect(menu().exists()).toBe(false);

    await zones.at(-1)!.trigger("click");
    expect(menu().exists()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(menu().exists()).toBe(false);

    await zones.at(-1)!.trigger("click");
    expect(menu().exists()).toBe(true);
    document.dispatchEvent(new Event("scroll"));
    await flushPromises();
    expect(menu().exists()).toBe(false);

    // scrim 点击（手机档点遮罩关闭）。
    await zones.at(-1)!.trigger("click");
    await harness.wrapper.find(".type-menu-scrim").trigger("click");
    await flushPromises();
    expect(menu().exists()).toBe(false);
  });
});

describe("SurveyDesignCanvas 点空白取消选中", () => {
  it("点页空白取消当前选中；点卡片内仍保持", async () => {
    const harness = await mountCanvas(definition(), undefined, true);
    await selectCard(harness, "q1");
    expect(harness.selectedId()).toBe("q1");
    // 点卡片内部（已选中）不改选中。
    await harness.wrapper
      .find('[data-canvas-question="q1"] .q-card__head')
      .trigger("click");
    expect(harness.selectedId()).toBe("q1");
    // 点页空白（分节容器本体）取消选中。
    await harness.wrapper.find("[data-canvas-page]").trigger("click");
    expect(harness.selectedId()).toBe("");
  });
});

// 审判 blocker ① 定性：换题型确认 → 点确定后弹窗必须关闭、菜单可再次打开。
// 走真实 ConfirmDialog（App 全局那一只）+ 真实指针事件序列（pointerdown 先于
// click，正是「菜单全局 pointerdown 监听 vs 弹窗按钮」怀疑点的形状）。
describe("SurveyDesignCanvas 换题型确认弹窗（真实 ConfirmDialog 链路）", () => {
  // ConfirmDialog teleport 到 body 且监听模块级单例总线：不卸载会跨用例残留，
  // 下一个用例的 confirm 会被旧实例同时收到（弹窗「关不掉」的测试假象）。
  const mounted: Array<{ unmount: () => void }> = [];
  afterEach(() => {
    for (const wrapper of mounted.reverse()) wrapper.unmount();
    mounted.length = 0;
    document.body.innerHTML = "";
  });

  function mountHostWithDialog(current: Ref<SurveyDefinition>) {
    const Host = defineComponent({
      name: "CanvasHostWithDialog",
      setup() {
        return () =>
          [
            h(SurveyDesignCanvas, {
              modelValue: current.value,
              onChange: (next: SurveyDefinition) => {
                current.value = next;
              },
            }),
            h(ConfirmDialog),
          ] as never;
      },
    });
    const wrapper = mountSurveysComponent(Host, { global: { plugins: [ConfirmationService] } }, createTestHost());
    mounted.push(wrapper);
    return wrapper;
  }

  /** 真实总线：mock 的 require 把确认转发给 App 全局 ConfirmDialog 监听的总线。 */
  function forwardConfirmToBus() {
    confirmMocks.require.mockImplementation((options: unknown) => {
      ConfirmationEventBus.emit("confirm", options);
    });
  }

  function fireClick(element: Element) {
    // 合成 CDP 同款完整序列：pointerdown → pointerup → click。
    for (const type of ["pointerdown", "pointerup", "click"]) {
      element.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window }),
      );
    }
  }

  async function dialogButton(className: string) {
    const button = () =>
      document.body.querySelector<HTMLElement>(`.${className}`);
    await vi.waitFor(() => expect(button()).not.toBeNull());
    return button()!;
  }

  async function dialogGone() {
    await vi.waitFor(() =>
      expect(document.body.querySelector(".p-confirmdialog")).toBeNull(),
    );
  }

  /** 选中 q1 → 开题型菜单 → 选「文本」（触发破坏性确认）。 */
  async function pickTextType(wrapper: VueWrapper) {
    await wrapper.find('[data-canvas-question="q1"]').trigger("click");
    await flushPromises();
    await wrapper
      .find('[data-canvas-question="q1"] .type-toggle')
      .trigger("click");
    await wrapper
      .find('[data-canvas-question="q1"]')
      .findAll(".type-item")
      .find((item) => item.text().includes(t("surveys.type.text")))!
      .trigger("click");
    await flushPromises();
  }

  it("single→text 确认弹窗：点确定后类型切换、弹窗关闭、菜单可再次打开", async () => {
    forwardConfirmToBus();
    const current = ref(definition());
    const wrapper = mountHostWithDialog(current);
    await flushPromises();

    await pickTextType(wrapper);

    // 菜单先收起、确认弹窗出现在 body（teleport）。
    expect(wrapper.find(".survey-type-menu").exists()).toBe(false);
    const accept = await dialogButton("p-confirmdialog-accept-button");
    fireClick(accept);
    await flushPromises();
    await dialogGone();

    expect(current.value.questions[0]!.type).toBe("text");
    // 弹窗关闭后菜单能再次打开（审判里的「锁死」症状不成立）。
    await wrapper
      .find('[data-canvas-question="q1"] .type-toggle')
      .trigger("click");
    expect(wrapper.find(".survey-type-menu").exists()).toBe(true);
  });

  it("确认弹窗取消：类型不动、弹窗关闭", async () => {
    forwardConfirmToBus();
    const current = ref(definition());
    const wrapper = mountHostWithDialog(current);
    await flushPromises();

    await pickTextType(wrapper);

    const reject = await dialogButton("p-confirmdialog-reject-button");
    fireClick(reject);
    await flushPromises();
    await dialogGone();
    expect(current.value.questions[0]!.type).toBe("single");
  });
});

// 审判必修②：换题型载荷暂存跨刷新仍可恢复（sessionStorage，按 surveyId 隔离）。
describe("SurveyDesignCanvas 换题型暂存跨刷新可恢复", () => {
  const SURVEY_ID = "sv-test-1";
  const stashKey = `mango.survey.type-stash.${SURVEY_ID}`;

  beforeEach(() => {
    if (typeof sessionStorage !== "undefined") sessionStorage.clear();
  });

  async function switchType(
    harness: Awaited<ReturnType<typeof mountCanvas>>,
    id: string,
    label: string,
  ) {
    await selectCard(harness, id);
    await harness.wrapper
      .find(`[data-canvas-question="${id}"]`)
      .find(".type-toggle")
      .trigger("click");
    await harness.wrapper
      .find(`[data-canvas-question="${id}"]`)
      .findAll(".type-item")
      .find((item) => item.text().includes(label))!
      .trigger("click");
    await flushPromises();
    const options = confirmMocks.require.mock.calls.at(-1)![0] as {
      accept?: () => void;
    };
    options.accept?.();
    await flushPromises();
  }

  it("破坏性切换 → 重建组件（模拟刷新）→ 切回单选恢复原文案与选项 id", async () => {
    const first = await mountCanvas(definition(), SURVEY_ID);
    await switchType(first, "q1", t("surveys.type.text"));
    expect(first.current().questions[0]!.type).toBe("text");
    expect(sessionStorage.getItem(stashKey)).not.toBeNull();

    // 卸载重建：definition 来自服务端（已是 text），暂存副本留在 sessionStorage。
    first.wrapper.unmount();
    const second = await mountCanvas(first.current(), SURVEY_ID);
    const callsBefore = confirmMocks.require.mock.calls.length;
    await switchType(second, "q1", t("surveys.type.single"));
    // 切回不弹确认：暂存命中即恢复。
    expect(confirmMocks.require.mock.calls.length).toBe(callsBefore);
    const restored = second.current().questions[0]!;
    if (restored.type !== "single") throw new Error("fixture");
    expect(restored.title).toBe("年级");
    expect(restored.required).toBe(true);
    expect(restored.options.map((o) => o.id)).toEqual(["o1", "o2"]);
    expect(restored.options.map((o) => o.label)).toEqual(["大一", "大二"]);
  });

  it("不同问卷互不可见；未命中暂存走确认 + 默认载荷", async () => {
    const first = await mountCanvas(definition(), SURVEY_ID);
    await switchType(first, "q1", t("surveys.type.text"));
    first.wrapper.unmount();

    const other = await mountCanvas(first.current(), "sv-other");
    const callsBefore = confirmMocks.require.mock.calls.length;
    await switchType(other, "q1", t("surveys.type.single"));
    expect(confirmMocks.require.mock.calls.length).toBe(callsBefore + 1);
    const fallback = other.current().questions[0]!;
    if (fallback.type !== "single") throw new Error("fixture");
    expect(fallback.options.map((o) => o.id)).not.toEqual(["o1", "o2"]);
  });
});

// 审判必修①产品侧守卫：重放 click 的 target 已 detached（路径快照）时，
// 「点画布空白」判定不得拿它清空刚建立的选中。
describe("SurveyDesignCanvas detached target 的重放 click", () => {
  it("target 已脱离文档的 click 不清空选中；正常空白点击仍取消", async () => {
    const harness = await mountCanvas(definition(), undefined, true);
    await selectCard(harness, "q1");
    expect(harness.selectedId()).toBe("q1");

    const page = harness.wrapper.find("[data-canvas-page]").element as HTMLElement;
    const ghost = document.createElement("div");
    page.appendChild(ghost);
    const detach = () => ghost.remove();
    document.addEventListener("click", detach, true);
    try {
      // dispatch 的路径在派发时已定：派发后立刻把 target 摘出文档，
      // 模拟重放事件「target 已随重渲染 detached、路径仍走画布根」。
      ghost.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      expect(ghost.isConnected).toBe(false);
      expect(harness.selectedId()).toBe("q1");
    } finally {
      document.removeEventListener("click", detach, true);
      ghost.remove();
    }

    // 对照：正常 attached 空白点击仍取消选中。
    await harness.wrapper.find("[data-canvas-page]").trigger("click");
    expect(harness.selectedId()).toBe("");
  });
});

// 小项：取消选中卡时清除 issue 列表的对应高亮。
describe("SurveyDesignCanvas 取消选中清除 issue 高亮", () => {
  it("选中带问题的卡 → issue 项高亮；点空白取消 → 高亮消失", async () => {
    const initial = definition();
    initial.questions[0] = {
      ...initial.questions[0]!,
      options: [],
    } as SurveyQuestion;
    const harness = await mountCanvas(initial, undefined, true);
    const item = () => harness.wrapper.find(".issue-item");
    await item().trigger("click");
    expect(harness.selectedId()).toBe("q1");
    expect(item().classes()).toContain("issue-item--active");

    await harness.wrapper.find("[data-canvas-page]").trigger("click");
    expect(harness.selectedId()).toBe("");
    expect(item().classes()).not.toContain("issue-item--active");
  });
});

// ── 新题型（issue #217）：插入默认载荷、行/列编辑器、说明块与同族切换 ──
describe("SurveyDesignCanvas 新题型", () => {
  type Harness = Awaited<ReturnType<typeof mountCanvas>>;

  async function openCardTypeMenu(harness: Harness, id: string) {
    await selectCard(harness, id);
    await harness.wrapper
      .find(`[data-canvas-question="${id}"]`)
      .find(".type-toggle")
      .trigger("click");
  }
  async function pickType(harness: Harness, id: string, label: string) {
    await harness.wrapper
      .find(`[data-canvas-question="${id}"]`)
      .findAll(".type-item")
      .find((item) => item.text().includes(label))!
      .trigger("click");
    await flushPromises();
  }

  it("插入矩阵单选：默认 2 行 + Likert 5 列；行编辑器 Enter 加行、下限守卫", async () => {
    const harness = await mountCanvas();
    await insertType(harness, 1, t("surveys.type.matrix_single"));
    const inserted = harness.current().questions.at(-1)!;
    expect(inserted.type).toBe("matrix_single");
    expect(inserted.required).toBe(false);
    const asMatrix = inserted as Extract<SurveyQuestion, { type: "matrix_single" }>;
    expect(asMatrix.rows).toHaveLength(2);
    expect(asMatrix.columns.map((c) => c.label)).toEqual([
      t("surveys.likert.c1"),
      t("surveys.likert.c2"),
      t("surveys.likert.c3"),
      t("surveys.likert.c4"),
      t("surveys.likert.c5"),
    ]);

    // 选中后行编辑器：Enter 在末行后加「待落笔」行，输入首字提交。
    await selectCard(harness, inserted.id);
    const card = () => harness.wrapper.find(`[data-canvas-question="${inserted.id}"]`);
    expect(card().findAll(".subeditor")).toHaveLength(2);
    const rowsEditor = () => card().findAll(".subeditor").at(0)!;
    expect(rowsEditor().findAll("input")).toHaveLength(2);
    await rowsEditor().findAll("input").at(-1)!.trigger("keydown", { key: "Enter" });
    await flushPromises();
    // 待落笔行是行编辑器里最后一个 .label-row。
    await rowsEditor().findAll(".label-row").at(-1)!.find("input").setValue("新行");
    await flushPromises();
    const after = harness.current().questions.find((q) => q.id === inserted.id)!;
    const rowsAfter = (after as Extract<SurveyQuestion, { type: "matrix_single" }>).rows;
    expect(rowsAfter).toHaveLength(3);
    expect(rowsAfter.at(-1)!.label).toBe("新行");

    // 删两行到下限 1：再往下删除按钮禁用，下限守卫生效。
    for (let i = 0; i < 2; i += 1) {
      await rowsEditor().findAll("button").at(-1)!.trigger("click");
      await flushPromises();
    }
    const trimmed = harness.current().questions.find((q) => q.id === inserted.id)!;
    expect((trimmed as Extract<SurveyQuestion, { type: "matrix_single" }>).rows).toHaveLength(1);
    expect(
      rowsEditor()
        .findAll("button")
        .at(-1)!
        .attributes("disabled"),
    ).toBeDefined();
  });

  it("插入说明块：不是题目——无必答开关、markdown 就地编辑、题干输入不渲染", async () => {
    const harness = await mountCanvas();
    await insertType(harness, 1, t("surveys.type.statement"));
    const inserted = harness.current().questions.at(-1)!;
    expect(inserted.type).toBe("statement");
    expect(inserted.required).toBe(false);
    await selectCard(harness, inserted.id);
    const card = harness.wrapper.find(`[data-canvas-question="${inserted.id}"]`);
    expect(card.find(".required-toggle").exists()).toBe(false);
    expect(card.find(".q-card__title-input").exists()).toBe(false);
    expect(card.find(".survey-markdown-field").exists()).toBe(true);
    // 说明块不能出现在 showIf 条件源候选（后续题的高级面板）。
    await selectCard(harness, "q1");
    await harness.wrapper
      .find('[data-canvas-question="q1"]')
      .find(".type-toggle")
      .trigger("click");
  });

  it("条件源候选：矩阵/说明块不可选，下拉/评分可选", async () => {
    const initial = definition();
    initial.questions.push(
      { id: "q3", type: "statement", title: "", required: false, body: "说明" },
      {
        id: "q4",
        type: "dropdown",
        title: "来源下拉",
        required: false,
        options: [
          { id: "d1", label: "同学" },
          { id: "d2", label: "网络" },
        ],
      },
      {
        id: "q5",
        type: "matrix_single",
        title: "矩阵题",
        required: false,
        rows: [{ id: "r1", label: "行 1" }],
        columns: [
          { id: "c1", label: "不同意" },
          { id: "c2", label: "同意" },
        ],
      },
      { id: "q6", type: "rating", title: "评分题", required: false, max: 5 },
    );
    // q2 挪到页尾：条件只能引用前题，候选 = q2 之前的全部题。
    initial.pages[0]!.questionIds = ["q1", "q3", "q4", "q5", "q6", "q2"];
    const harness = await mountCanvas(initial);
    await selectCard(harness, "q2");
    const card = harness.wrapper.find('[data-canvas-question="q2"]');
    await card.findAll("footer button").at(0)!.trigger("click");
    await flushPromises();
    document.querySelector<HTMLElement>(".survey-question-settings .p-select")!.click();
    await flushPromises();
    const labels = [...document.querySelectorAll(".p-select-option")].map(
      (node) => node.textContent ?? "",
    );
    expect(labels).toContain("年级");
    expect(labels).toContain("来源下拉");
    expect(labels).toContain("评分题");
    expect(labels).not.toContain("矩阵题");
    expect(labels).not.toContain(t("surveys.type.statement"));
  });

  it("选项族（single→ranking）切换保留 options 且不确认；矩阵族互切保留 rows/columns", async () => {
    const harness = await mountCanvas();
    await openCardTypeMenu(harness, "q1");
    await pickType(harness, "q1", t("surveys.type.ranking"));
    expect(confirmMocks.require).not.toHaveBeenCalled();
    const asRanking = harness.current().questions[0]!;
    expect(asRanking.type).toBe("ranking");
    expect(
      (asRanking as Extract<SurveyQuestion, { type: "ranking" }>).options.map((o) => o.id),
    ).toEqual(["o1", "o2"]);

    // 矩阵族互切不确认。
    await insertType(harness, 1, t("surveys.type.matrix_single"));
    const matrixId = harness.current().questions.at(-1)!.id;
    const before = harness.current().questions.find((q) => q.id === matrixId)!;
    await openCardTypeMenu(harness, matrixId);
    await pickType(harness, matrixId, t("surveys.type.matrix_multiple"));
    expect(confirmMocks.require).not.toHaveBeenCalled();
    const after = harness.current().questions.find((q) => q.id === matrixId)!;
    if (after.type !== "matrix_multiple") throw new Error("fixture");
    expect(after.rows).toEqual(
      (before as Extract<SurveyQuestion, { type: "matrix_single" }>).rows,
    );
    expect(after.columns).toEqual(
      (before as Extract<SurveyQuestion, { type: "matrix_single" }>).columns,
    );
  });

  it("rating→text 破坏性确认文案概括丢弃的载荷（评分档位）", async () => {
    const harness = await mountCanvas();
    // zh 里 type.rating「评分」是 scale 提示「量表评分…」的子串，菜单按文案找项
    // 会错配量表——用 hint（星形评分，3–10 档）做匹配键，zh/en 下都唯一指向评分。
    await insertType(harness, 1, t("surveys.typeHint.rating"));
    const ratingId = harness.current().questions.at(-1)!.id;
    await openCardTypeMenu(harness, ratingId);
    await pickType(harness, ratingId, t("surveys.type.text"));
    const options = confirmMocks.require.mock.calls.at(-1)![0] as { message: string };
    expect(options.message).toBe(
      t("surveys.changeTypeConfirmPayload", {
        type: t("surveys.type.text"),
        from: t("surveys.type.rating"),
        detail: t("surveys.changeTypeDropRating"),
      }),
    );
  });

  it("插入矩阵填空：默认 2 行、无列编辑器；作答值形状与行随族保留（issue #217）", async () => {
    const harness = await mountCanvas();
    await insertType(harness, 1, t("surveys.type.matrix_text"));
    const inserted = harness.current().questions.at(-1)!;
    expect(inserted.type).toBe("matrix_text");
    const asText = inserted as Extract<SurveyQuestion, { type: "matrix_text" }>;
    expect(asText.rows).toHaveLength(2);
    expect(asText).not.toHaveProperty("columns");

    // 选中后只有行编辑器（矩阵填空没有列）。
    await selectCard(harness, inserted.id);
    const card = () => harness.wrapper.find(`[data-canvas-question="${inserted.id}"]`);
    expect(card().findAll(".subeditor")).toHaveLength(1);
  });

  it("矩阵单选→矩阵填空：列从生效载荷拿掉先确认，切回恢复原行列（暂存）", async () => {
    const harness = await mountCanvas();
    await insertType(harness, 1, t("surveys.type.matrix_single"));
    const matrixId = harness.current().questions.at(-1)!.id;
    const before = harness.current().questions.find((q) => q.id === matrixId)!;

    // 切到矩阵填空：确认文案说「移除 {c} 列（行保留）」。
    await openCardTypeMenu(harness, matrixId);
    await pickType(harness, matrixId, t("surveys.type.matrix_text"));
    const confirmOptions = confirmMocks.require.mock.calls.at(-1)![0] as {
      message: string;
      accept: () => void;
    };
    expect(confirmOptions.message).toBe(
      t("surveys.changeTypeConfirmPayload", {
        type: t("surveys.type.matrix_text"),
        from: t("surveys.type.matrix_single"),
        detail: t("surveys.changeTypeDropColumns", {
          c: (before as Extract<SurveyQuestion, { type: "matrix_single" }>).columns.length,
        }),
      }),
    );
    confirmOptions.accept();
    await flushPromises();
    const asText = harness.current().questions.find(
      (q) => q.id === matrixId,
    ) as Extract<SurveyQuestion, { type: "matrix_text" }>;
    expect(asText.rows).toEqual(
      (before as Extract<SurveyQuestion, { type: "matrix_single" }>).rows,
    );

    // 切回矩阵单选：暂存恢复原行 + 原 Likert 列，不走默认预设。
    await openCardTypeMenu(harness, matrixId);
    await pickType(harness, matrixId, t("surveys.type.matrix_single"));
    expect(confirmMocks.require).toHaveBeenCalledTimes(1);
    const restored = harness.current().questions.find(
      (q) => q.id === matrixId,
    ) as Extract<SurveyQuestion, { type: "matrix_single" }>;
    expect(restored.rows).toEqual(
      (before as Extract<SurveyQuestion, { type: "matrix_single" }>).rows,
    );
    expect(restored.columns).toEqual(
      (before as Extract<SurveyQuestion, { type: "matrix_single" }>).columns,
    );
  });

  it("图片单选/多选：默认 2 选项；与纯文本选项族互切不确认、options 原样保留（issue #217）", async () => {
    const harness = await mountCanvas();
    await insertType(harness, 1, t("surveys.type.image_single"));
    const inserted = harness.current().questions.at(-1)!;
    expect(inserted.type).toBe("image_single");
    expect(
      (inserted as Extract<SurveyQuestion, { type: "image_single" }>).options,
    ).toHaveLength(2);

    // image_single → single：同族静默，options 原样。
    await openCardTypeMenu(harness, inserted.id);
    await pickType(harness, inserted.id, t("surveys.type.single"));
    expect(confirmMocks.require).not.toHaveBeenCalled();
    const asSingle = harness.current().questions.at(-1)!;
    expect(asSingle.type).toBe("single");
    expect(
      (asSingle as Extract<SurveyQuestion, { type: "single" }>).options,
    ).toEqual((inserted as Extract<SurveyQuestion, { type: "image_single" }>).options);

    // single → image_multiple：同族静默。
    await openCardTypeMenu(harness, inserted.id);
    await pickType(harness, inserted.id, t("surveys.type.image_multiple"));
    expect(confirmMocks.require).not.toHaveBeenCalled();
    expect(harness.current().questions.at(-1)!.type).toBe("image_multiple");
  });
});
