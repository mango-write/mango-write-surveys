// 问卷诊断会话：活流只负责通知，SurveyDetail.review 是刷新后的事实源。
// 应用与忽略由服务端逐条处理；本 composable 只在回包后对齐页面，不在本地
// 先改报告。过期判定与发布侧同口径：报告带内容指纹时比对指纹（仅补试填
// 记录不作废建议），旧报告回退版本号对比；自动保存未落定一律 stale。
import { computed, ref, watch, type ComputedRef, type Ref } from "vue";

import {
  canonicalContentJson,
  buildSurveyReviewPlan,
  sha256Hex,
  type SurveyReviewPlan,
} from "../../core/index.js";
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
  // 当前草稿的内容指纹（异步现算；空串 = 尚未算出，按不匹配处理，宁严勿松）。
  const draftContentFingerprint = ref("");
  watch(
    () => options.history.current.value.definition,
    (definition) => {
      sha256Hex(canonicalContentJson(definition))
        .then((fingerprint) => {
          if (options.history.current.value.definition === definition)
            draftContentFingerprint.value = fingerprint;
        })
        .catch(() => {});
    },
    { immediate: true },
  );
  const stale = computed(() => {
    if (!report.value) return false;
    if (!["idle", "saved"].includes(options.autosave.status.value)) return true;
    if (report.value.baseContentFingerprint)
      return draftContentFingerprint.value !== report.value.baseContentFingerprint;
    return report.value.baseDraftVersion !== options.draftVersion();
  });

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
