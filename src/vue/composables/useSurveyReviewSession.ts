// 问卷诊断会话：活流只负责通知，SurveyDetail.review 是刷新后的事实源。
// 应用与忽略由服务端逐条处理；本 composable 只在回包后对齐页面，不在本地
// 先改报告。版本不齐或自动保存未落定即 stale，失败保留建议供重试或忽略。
import { computed, ref, type ComputedRef, type Ref } from "vue";

import { buildSurveyReviewPlan, type SurveyReviewPlan } from "../../core/index.js";
import type {
  SurveyDetail,
  SurveyReviewDelivery,
} from "../../contracts/index.js";
import type { SurveysApi } from "../api.js";
import type { SurveysCopilotHost } from "../host.js";
import { useSurveysNotify } from "../notify.js";
import type { SurveySaveStatus } from "./useSurveyAutosave.js";
import type { SurveyDraftState } from "./useSurveyDraftHistory.js";

export type { SurveyReviewDelivery };

export interface SurveyReviewSessionOptions {
  surveyId: () => string;
  canWrite: () => boolean;
  draftVersion: () => number;
  history: { current: Ref<SurveyDraftState> };
  autosave: {
    status: Ref<SurveySaveStatus>;
    flush(): Promise<boolean>;
  };
  api: Pick<SurveysApi, "applyReviewFinding" | "dismissReviewFinding">;
  onApply: (detail: SurveyDetail, label: string) => void;
  onDismiss: (detail: SurveyDetail) => void;
  copilot: Pick<SurveysCopilotHost, "sendPrompt" | "fillComposer" | "focusComposer"> | undefined;
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

  function receive(delivery: SurveyReviewDelivery): void {
    if (delivery.surveyId !== options.surveyId()) return;
    report.value = delivery;
  }

  function discard(): void {
    report.value = null;
  }

  async function discardFinding(findingId: string): Promise<void> {
    const current = report.value;
    if (!current || applying.value || !options.canWrite()) return;
    applying.value = true;
    try {
      const detail = await options.api.dismissReviewFinding(options.surveyId(), findingId);
      options.onDismiss(detail);
      if (report.value === current) report.value = detail.review ?? null;
    } catch {
      options.notify.warn(options.t("surveys.assistant.requestFailed"));
    } finally {
      applying.value = false;
    }
  }

  async function request(): Promise<void> {
    if (busy.value || !options.canWrite()) return;
    busy.value = true;
    try {
      if (!await options.autosave.flush()) {
        options.notify.warn(options.t("surveys.assistant.saveFirst"));
        return;
      }
      const prompt = options.t("surveys.assistant.reviewRequest");
      if (!options.copilot?.sendPrompt) {
        options.copilot?.fillComposer(prompt);
        options.copilot?.focusComposer();
        return;
      }
      await options.copilot.sendPrompt(prompt, ["survey_read", "survey_review"], { skillId: "survey-review" });
    } catch {
      options.notify.error(options.t("surveys.assistant.requestFailed"));
    } finally {
      busy.value = false;
    }
  }

  async function applyFinding(findingId: string): Promise<void> {
    const applied = report.value;
    if (!applied || stale.value || applying.value || !options.canWrite()) return;
    const finding = applied.findings.find((item) => item.id === findingId);
    if (!finding?.suggestedOps?.length) return;
    applying.value = true;
    try {
      const detail = await options.api.applyReviewFinding(
        options.surveyId(),
        findingId,
        options.draftVersion(),
      );
      options.onApply(detail, finding.title);
      if (report.value === applied) report.value = detail.review ?? null;
      options.notify.success(options.t("surveys.assistant.applied"));
    } catch {
      options.notify.warn(options.t("surveys.assistant.planUnavailable"));
    } finally {
      applying.value = false;
    }
  }

  return { report, busy, applying, plan, addedQuestions, stale, receive, discard, discardFinding, request, applyFinding };
}
