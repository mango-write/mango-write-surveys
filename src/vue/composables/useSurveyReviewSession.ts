// 问卷诊断会话（issue #224 stage1）：survey_review 帧的状态机。report 是唯一
// 持有物——request 发起检查、receive 收帧（同卷才收）、apply 整批写入草稿
// 历史（一次撤销步骤）且保存成功才清 report；草稿已变（版本不齐或自动保存
// 未落定）即 stale，应用被拒、方案保留给用户自行判断。草稿历史、自动保存与
// Copilot 发话能力经显式参数注入；本 composable 不碰布局偏好——诊断到达只
// 落状态，展示位置永远跟随用户当前视图。
import { computed, ref, type ComputedRef, type Ref } from "vue";

import { buildSurveyReviewPlan, type SurveyDefinition, type SurveyReviewPlan } from "../../core/index.js";
import type { ToolSurveyDelivery } from "../../contracts/index.js";
import type { SurveysCopilotHost } from "../host.js";
import { useSurveysNotify } from "../notify.js";
import type { SurveySaveStatus } from "./useSurveyAutosave.js";
import type { SurveyDraftState } from "./useSurveyDraftHistory.js";

export type SurveyReviewDelivery = Extract<ToolSurveyDelivery, { type: "survey_review" }>;
export type SurveyReviewRequestKind = "review" | "design";

export interface SurveyReviewSessionOptions {
  /** 当前工作区问卷 id：别的问卷的诊断帧不串场。 */
  surveyId: () => string;
  canWrite: () => boolean;
  /** 本地已落盘草稿版本：stale 判定与过期拒绝的基点。 */
  draftVersion: () => number;
  history: {
    current: Ref<SurveyDraftState>;
    commit(next: SurveyDraftState, options: { source: "assistant"; label?: string }): void;
  };
  autosave: {
    status: Ref<SurveySaveStatus>;
    flush(): Promise<boolean>;
    schedule(): void;
  };
  copilot: Pick<SurveysCopilotHost, "sendPrompt" | "fillComposer" | "focusComposer"> | undefined;
  /** 页面的 useSurveysNotify() 实例：warn 未实现时已回落 error，警示不静默丢。 */
  notify: ReturnType<typeof useSurveysNotify>;
  t: (key: string) => string;
}

export function useSurveyReviewSession(options: SurveyReviewSessionOptions) {
  const report = ref<SurveyReviewDelivery | null>(null);
  const busy = ref(false);
  const applying = ref(false);
  const plan: ComputedRef<SurveyReviewPlan | null> = computed(() =>
    report.value
      ? buildSurveyReviewPlan(options.history.current.value.definition, report.value.findings)
      : null,
  );
  const addedQuestions = computed(() =>
    plan.value?.candidateDefinition?.questions.filter(
      (question) => !options.history.current.value.definition.questions.some((original) => original.id === question.id),
    ) ?? [],
  );
  const stale = computed(
    () =>
      !!report.value &&
      (report.value.baseDraftVersion !== options.draftVersion() ||
        !["idle", "saved"].includes(options.autosave.status.value)),
  );

  /** survey_review 帧到达：只收同卷的帧，不切换任何视图状态。 */
  function receive(delivery: SurveyReviewDelivery): void {
    if (delivery.surveyId !== options.surveyId()) return;
    report.value = delivery;
  }

  /** 丢弃当前诊断（换卷重载 / 用户关闭）。应用成功落盘后的清理不走这里。 */
  function discard(): void {
    report.value = null;
  }

  async function request(kind: SurveyReviewRequestKind): Promise<void> {
    if (busy.value || !options.canWrite()) return;
    busy.value = true;
    try {
      if (!await options.autosave.flush()) {
        options.notify.warn(options.t("surveys.assistant.saveFirst"));
        return;
      }
      const prompt = options.t(kind === "review" ? "surveys.assistant.reviewPrompt" : "surveys.assistant.designPrompt");
      if (!options.copilot?.sendPrompt) {
        options.copilot?.fillComposer(prompt);
        options.copilot?.focusComposer();
        return;
      }
      await options.copilot.sendPrompt(
        prompt,
        kind === "review" ? ["survey_read", "survey_review"] : ["survey_read", "survey_edit"],
      );
    } catch {
      options.notify.error(options.t("surveys.assistant.requestFailed"));
    } finally {
      busy.value = false;
    }
  }

  async function apply(): Promise<void> {
    // 入口捕获本次应用的方案：保存期间新 report 到达时只清旧的那份。
    const applied = report.value;
    const current = plan.value;
    if (!applied || !current || current.status !== "ready" || !current.candidateDefinition || stale.value ||
      applying.value || !options.canWrite()) return;
    applying.value = true;
    try {
      // 整批一次 commit：一个撤销步骤，绝不逐组落历史。
      options.history.commit(
        { ...options.history.current.value, definition: current.candidateDefinition },
        { source: "assistant", label: applied.summary },
      );
      options.autosave.schedule();
      // 保存失败（含冲突）时方案保留：用户还得靠它知道刚才改了什么、为何没落盘；
      // 成功提示在落盘确认后才发，不虚报。
      if (!await options.autosave.flush()) {
        options.notify.warn(options.t("surveys.assistant.saveFirst"));
        return;
      }
      options.notify.success(options.t("surveys.assistant.applied"));
      if (report.value === applied) discard();
    } finally {
      applying.value = false;
    }
  }

  return { report, busy, applying, plan, addedQuestions, stale, receive, discard, request, apply };
}
