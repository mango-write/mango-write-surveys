<script setup lang="ts">
// 问卷工作区（issue #217）：SurveyWorkbenchShell 三岛工作台。左岛 = 大纲 /
// 版本两 tab（回收上限在发放段内联编辑）；中岛顶部是生命周期轨道（设计 →
// 发放 → 数据 → 分析），未发布时后三段锁定，发布成功后自动落到发放段。
// 编辑模型：中岛画布就地编辑，所有变更走 useSurveyDraftHistory.commit
// 同一入口；自动保存防抖 PATCH（expectedVersion 乐观锁），顶栏只有保存状态与
// 撤销/重做——冲突是终态，必须重新加载，绝不覆盖其他窗口。Copilot 右岛由
// 宿主按路由 scope（survey:{surveyId}）常驻：survey_edit 交付帧在本地当前
// 草稿上重放 ops（与手工编辑同一历史栈，撤销同源），survey_create 帧导航。
// 导航出口一律 host.navigate；vue-router 只用于读路由参数与离开守卫。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter, type RouteLocationNormalized } from "vue-router";
import { useI18n } from "vue-i18n";
import { useConfirm } from "primevue/useconfirm";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Message from "primevue/message";
import Tag from "primevue/tag";
import { Eye, History, List, Redo2, Undo2 } from "lucide-vue-next";
import type {
  SurveyDetail,
  SurveyPretestItemFeedback,
  SurveyStatus,
  ToolSurveyDelivery,
} from "../../contracts/index.js";
import {
  applySurveyOps,
  canonicalContentJson,
  canonicalSurveyJson,
  sha256Hex,
  validateSurveyDefinition,
} from "../../core/index.js";

import { AsyncSlot } from "@mango-write/ui";
import SurveyWorkbenchShell, {
  type SurveyShellTab,
} from "../components/SurveyWorkbenchShell.vue";
import {
  SurveysApiError,
  useSurveysHost,
  type SurveysCopilotSurface,
  type SurveysCopilotSurfacePresentation,
} from "../host.js";
import { useSurveysNotify } from "../notify.js";
import { useSurveysApi } from "../api.js";
import SurveyDesignCanvas from "../components/SurveyDesignCanvas.vue";
import SurveyDataAnalysis from "../components/SurveyDataAnalysis.vue";
import SurveyLifecycleTrack from "../components/SurveyLifecycleTrack.vue";
import SurveyOutlinePanel from "../components/SurveyOutlinePanel.vue";
import SurveyVersionsPanel from "../components/SurveyVersionsPanel.vue";
import SurveyDistributePanel from "../components/SurveyDistributePanel.vue";
import SurveyPreviewOverlay from "../components/SurveyPreviewOverlay.vue";
import SurveyPretestPanel from "../components/SurveyPretestPanel.vue";
import SurveyResearchDesignSummary from "../components/SurveyResearchDesignSummary.vue";
import SurveySwitcher from "../components/SurveySwitcher.vue";
import SurveyInlineReview from "../components/SurveyInlineReview.vue";
import SurveyStageNavigation from "../components/SurveyStageNavigation.vue";
import type { SurveyStageNavigation as SurveyStageNavigationModel } from "../workspace-navigation.js";
import {
  takeAiCreatedSurveyHandoff,
  setAiCreatedSurveyHandoff,
  type AiCreatedSurveyHandoff,
} from "../lib/ai-created-handoff.js";
import { useSurveyAutosave } from "../composables/useSurveyAutosave.js";
import {
  useSurveyDraftHistory,
  type SurveyDraftState,
} from "../composables/useSurveyDraftHistory.js";
import { useSurveyReviewSession } from "../composables/useSurveyReviewSession.js";

type Stage = "design" | "distribute" | "data" | "analysis";

const { t } = useI18n();
const route = useRoute(),
  router = useRouter(),
  confirm = useConfirm();
const host = useSurveysHost();
const notify = useSurveysNotify();
const surveysApi = useSurveysApi();

const survey = ref<SurveyDetail | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
function stageFromRoute(): Stage {
  if (typeof route.query.run === "string") return "analysis";
  const value = route.query.stage;
  return value === "distribute" || value === "data" || value === "analysis" ? value : "design";
}
const stage = ref<Stage>(stageFromRoute());
const workspaceRevisionId = ref(
  typeof route.query.revisionId === "string" ? route.query.revisionId : "",
);
const selectedQuestionId = ref("");
const previewOpen = ref(false);
const mobileNavigationOpen = ref(false);
const canvasRef = ref<InstanceType<typeof SurveyDesignCanvas> | null>(null);
const dataAnalysisRef = ref<InstanceType<typeof SurveyDataAnalysis> | null>(null);
const stageNavigation = ref<SurveyStageNavigationModel | null>(null);

const surveyId = computed(() =>
  typeof route.params.surveyId === "string" ? route.params.surveyId : "",
);

const leftTabs = computed<SurveyShellTab[]>(() => {
  if (stage.value === "data") return [{ id: "data", label: t("surveys.dataViewLabel"), icon: List }];
  if (stage.value === "analysis") return [{ id: "analysis", label: t("surveys.savedAnalysis"), icon: List }];
  if (stage.value === "distribute") return [{ id: "versions", label: t("surveys.versionsTab"), icon: History }];
  return [
    { id: "outline", label: t("surveys.outlineTab"), icon: List },
    { id: "versions", label: t("surveys.versionsTab"), icon: History },
  ];
});
function updateWorkspaceQuery(patch: Record<string, string | undefined>) {
  void router.replace({ query: { ...route.query, ...patch } });
}

// ── 草稿状态：历史栈 + 自动保存 ──────────────────────────────────────────
const history = useSurveyDraftHistory({
  definition: {
    version: 1,
    title: "",
    description: "",
    consent: "",
    questions: [],
    pages: [],
  },
  responseLimit: 5000,
});
const definition = computed(() => history.current.value.definition);
const responseLimit = computed(() => history.current.value.responseLimit);
const draftVersion = ref(1);

const autosave = useSurveyAutosave({
  getState: () => history.current.value,
  getVersion: () => draftVersion.value,
  setVersion: (version) => (draftVersion.value = version),
  save: async (state: SurveyDraftState, expectedVersion: number) => {
    const next = await surveysApi.save(
      survey.value!.id,
      expectedVersion,
      state.definition,
      state.responseLimit,
    );
    // 工作副本是唯一真相：服务端回包只更新外壳字段，不回写 definition。
    survey.value = {
      ...next,
      definition: history.current.value.definition,
      responseLimit: history.current.value.responseLimit,
    };
    return next.draftVersion;
  },
  // pagehide 瞬间的同步落盘（keepalive）：不等响应。认证/租户头由宿主 beacon 持有。
  beacon: (state, expectedVersion) => {
    const target = survey.value;
    if (!target) return;
    host.transport.beacon?.(`/api/surveys/${target.id}`, {
      expectedVersion,
      definition: state.definition,
      responseLimit: state.responseLimit,
    });
  },
  enabled: () => !!survey.value?.canWrite,
});

/** 所有编辑（画布、设置面板、发放页的回收上限）的唯一变更入口。 */
function commit(next: SurveyDraftState, label?: string) {
  history.commit(next, { source: "user", label });
  autosave.schedule();
}
function commitDefinition(next: SurveyDetail["definition"], label?: string) {
  commit({ ...history.current.value, definition: next }, label);
}
function onReviewApply(next: SurveyDetail, label: string) {
  survey.value = next;
  draftVersion.value = next.draftVersion;
  history.commit(
    { definition: next.definition, responseLimit: next.responseLimit },
    { source: "assistant", label },
  );
  autosave.settled();
}
function onReviewDismiss(next: SurveyDetail) {
  survey.value = next;
  draftVersion.value = next.draftVersion;
}
// 撤销/重做改写历史：先把在途保存落盘，保证 PATCH 的 expectedVersion 以
// 落盘后的版本为基点单调、最终落盘内容 = 当前画布内容；否则撤销后的保存与
// 在途保存竞速，刷新窗口可能把撤销前的正文留成服务端正本。防抖未发的
// pending 不必先发：schedule() 会以撤销后的快照重新计时，一发即最新。
async function undo() {
  if (autosave.status.value === "saving") await autosave.flush();
  if (history.undo()) autosave.schedule();
}
async function redo() {
  if (autosave.status.value === "saving") await autosave.flush();
  if (history.redo()) autosave.schedule();
}

// ── Copilot 桥（issue #217）：survey_edit 交付帧 → 本地重放 ops ─────────────
// 撤销与手工编辑共用同一条历史栈（source:"assistant" 不参与合并）；帧只经
// 活流到达一次，应用前先 flush 在途保存（PATCH 基点单调，与撤销同一做法）。
// 新鲜度闸（#223 §6）：交付带 baseDraftVersion（服务端校验 ops 的草稿版本），
// 与本地已落盘版本不一致或本地有未保存编辑时不自动重放——推理期间的人工
// 改动不能被迟到的结果覆盖，转横幅让用户决定。
type SurveyEditDelivery = Extract<ToolSurveyDelivery, { type: "survey_edit" }>;
const aiStaleDelivery = ref<SurveyEditDelivery | null>(null);
const {
  report: reviewReport,
  busy: reviewBusy,
  applying: reviewApplying,
  plan: reviewPlan,
  stale: reviewStale,
  receive: receiveReview,
  discard: discardReview,
  discardFinding,
  request: askResearch,
  applyFinding,
} = useSurveyReviewSession({
  surveyId: () => surveyId.value,
  canWrite: () => !!survey.value?.canWrite,
  draftVersion: () => draftVersion.value,
  history,
  autosave,
  api: surveysApi,
  onApply: onReviewApply,
  onDismiss: onReviewDismiss,
  copilot: host.copilot,
  notify,
  t,
});
const reviewQuestionIds = computed(() => [
  ...new Set((reviewReport.value?.findings ?? []).flatMap((finding) => finding.questionId ? [finding.questionId] : [])),
]);
const reviewAdditions = computed(() => (reviewReport.value?.findings ?? []).flatMap((finding) =>
  (finding.suggestedOps ?? []).flatMap((op) => {
    if (op.op !== "add_question" || typeof op.question.id !== "string") return [];
    const page = definition.value.pages.find((item) => item.id === op.pageId);
    const index = op.index ?? page?.questionIds.length ?? 0;
    return [{
      questionId: op.question.id,
      pageId: op.pageId,
      afterId: index > 0 && page && index < page.questionIds.length ? page.questionIds[index - 1]! : null,
      beforeQuestionId: index === 0 ? page?.questionIds[0] : undefined,
    }];
  }),
));
// AI 建卷落地提示（issue #217）：survey_create 帧载荷经一次性单槽带进工作区，
// load 成功后取走展示——生成会话是 global scope，落进右岛的新 survey 会话是
// 空的，这张卡补上「AI 刚建了什么」。取走即清，刷新不重复。
const aiCreatedCard = ref<AiCreatedSurveyHandoff | null>(null);

function applyEditDelivery(delivery: SurveyEditDelivery) {
  const result = applySurveyOps(history.current.value.definition, delivery.appliedOps);
  if (result.definition !== history.current.value.definition) {
    history.commit(
      { ...history.current.value, definition: result.definition },
      { source: "assistant", label: delivery.summary },
    );
    autosave.schedule();
    notify.success(t("surveys.copilot.applied", { n: result.applied.length }));
  }
  if (result.rejected.length > 0) {
    notify.warn(t("surveys.copilot.rejected", { n: result.rejected.length }));
  }
}

async function applySurveyDelivery(delivery: ToolSurveyDelivery) {
  if (delivery.type === "survey_review") {
    receiveReview(delivery);
    return;
  }
  if (delivery.type !== "survey_edit") {
    setAiCreatedSurveyHandoff(delivery);
    notify.success(t("surveys.copilot.created", { title: delivery.title }));
    host.navigate({ name: "surveys.detail", surveyId: delivery.surveyId });
    return;
  }
  if (delivery.surveyId !== surveyId.value) return;
  if (!survey.value?.canWrite) {
    notify.warn(t("surveys.copilot.readOnly"));
    return;
  }
  if (autosave.status.value === "saving") await autosave.flush();
  const settled = autosave.status.value === "idle" || autosave.status.value === "saved";
  if (!settled || delivery.baseDraftVersion !== draftVersion.value) {
    aiStaleDelivery.value = delivery;
    return;
  }
  applyEditDelivery(delivery);
}

function confirmStaleDelivery() {
  const delivery = aiStaleDelivery.value;
  aiStaleDelivery.value = null;
  if (delivery) applyEditDelivery(delivery);
}

const copilotSurface = (): SurveysCopilotSurface | null =>
  surveyId.value ? { kind: "survey", id: surveyId.value } : null;
const unregisterCopilotHandlers = host.copilot?.registerHandlers(
  { onSurveyDeliveryFrame: (delivery) => void applySurveyDelivery(delivery) },
  { surface: copilotSurface },
);

// 上下文引用：当前选中题目（id + 题干摘要）与所在页——「把这道题改成多选」
// 的可解析锚点。ambient refs（非选区形态），随每轮消息注入 ephemeral 上下文。
const copilotContextRefs = computed(() => {
  const current = survey.value;
  const selectedId = selectedQuestionId.value;
  if (!current || !selectedId) return [];
  const question = definition.value.questions.find((candidate) => candidate.id === selectedId);
  if (!question) return [];
  const page = definition.value.pages.find((candidate) => candidate.questionIds.includes(selectedId));
  const requiredMark = question.required ? t("surveys.copilot.contextRequired") : "";
  return [
    ...(page
      ? [{
          kind: "survey-page" as const,
          refId: page.id,
          snippet: t("surveys.copilot.contextPage", { title: page.title.slice(0, 30) }),
        }]
      : []),
    {
      kind: "survey-question" as const,
      refId: question.id,
      snippet: t("surveys.copilot.contextQuestion", {
        title: question.title.slice(0, 40),
        type: question.type,
        required: requiredMark,
      }),
    },
  ];
});
watch(
  copilotContextRefs,
  (refs) => {
    host.copilot?.setContextRefs(refs);
  },
  { immediate: true },
);

// Copilot 面板呈现（issue #224 M2）：诊断由面板动作经 Skill 发起，题目旁的
// 修改建议是主要阅读位置；卸载后的 surface 清理归 releasePageState。
const copilotPresentation = computed<SurveysCopilotSurfacePresentation | null>(() => {
  if (!host.copilot?.setSurfacePresentation || !survey.value) return null;
  const selected = definition.value.questions.find(
    (question) => question.id === selectedQuestionId.value,
  );
  return {
    title: t("surveys.copilot.surfaceTitle"),
    description:
      stage.value !== "design"
        ? t("surveys.copilot.surfaceStageDescription")
        : selected
          ? t("surveys.copilot.surfaceQuestionDescription", { title: selected.title.slice(0, 40) })
          : t("surveys.copilot.surfaceDescription"),
    composerPlaceholder:
      stage.value === "data" || stage.value === "analysis"
        ? t("surveys.copilot.surfaceAnalysisPlaceholder")
        : selected
          ? t("surveys.copilot.surfaceQuestionPlaceholder", { title: selected.title.slice(0, 40) })
          : t("surveys.copilot.surfacePlaceholder"),
    actions:
      stage.value === "design" && survey.value.canWrite
        ? [{ id: "survey-review", label: t("surveys.assistant.review"), primary: true, run: askResearch }]
        : stage.value === "data" || stage.value === "analysis"
          ? [{
              id: "survey-analysis",
              label: t("surveys.assistant.analyze"),
              primary: true,
              prompt: t("surveys.assistant.analysisRequest"),
              skillId: "survey-analysis",
              toolNames: ["research_read", "research_analyze", "research_run_read"],
            }]
          : [],
  };
});
watch(
  copilotPresentation,
  (value) => {
    host.copilot?.setSurfacePresentation?.(value ?? undefined);
  },
  { immediate: true },
);

const canUndo = computed(
  () => history.canUndo.value && stage.value === "design" && !!survey.value?.canWrite,
);
const canRedo = computed(
  () => history.canRedo.value && stage.value === "design" && !!survey.value?.canWrite,
);

// Cmd/Ctrl+Z / Shift+Z：焦点在输入框/contenteditable 内时让原生（含 tiptap
// 自身撤销）生效，不劫持。
function onKeydown(event: KeyboardEvent) {
  if (
    !(event.metaKey || event.ctrlKey) ||
    event.key.toLowerCase() !== "z" ||
    stage.value !== "design" ||
    !survey.value?.canWrite
  )
    return;
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  )
    return;
  event.preventDefault();
  if (event.shiftKey) redo();
  else undo();
}

const hasRevision = computed(() => !!survey.value?.currentRevisionId);
const currentRevisionNumber = computed(
  () =>
    survey.value?.revisions.find(
      (revision) => revision.id === survey.value?.currentRevisionId,
    )?.revision ?? null,
);
const currentRevision = computed(() => {
  const detail = survey.value;
  const revisionId = detail?.currentRevisionId;
  if (!detail || !revisionId) return null;
  return detail.revisions.find((revision) => revision.id === revisionId) ?? null;
});

// 「设计段有未发布修改」按内容指纹判定：发布版本带 contentFingerprint（剥掉
// researchDesign.pretest 的 canonical 摘要）时比对指纹——仅补试填记录不算改卷，
// 状态保持「与发布版本一致」；旧宿主缺席指纹时回退整卷 contentHash 对比。
const definitionDirty = ref(false);
let dirtyEpoch = 0;
async function refreshDirty() {
  const current = survey.value;
  const revision = currentRevision.value;
  if (!current || !revision) {
    definitionDirty.value = false;
    return;
  }
  const epoch = ++dirtyEpoch;
  try {
    const dirty = revision.contentFingerprint
      ? (await sha256Hex(canonicalContentJson(definition.value))) !==
        revision.contentFingerprint
      : (await sha256Hex(canonicalSurveyJson(definition.value))) !==
        revision.contentHash;
    if (epoch === dirtyEpoch) definitionDirty.value = dirty;
  } catch {
    if (epoch === dirtyEpoch) definitionDirty.value = false;
  }
}
watch(definition, refreshDirty, { immediate: true });
watch(currentRevision, refreshDirty);

const definitionIssues = computed(() => validateSurveyDefinition(definition.value));

function errorCodeOf(cause: unknown): string | undefined {
  return cause instanceof SurveysApiError ? cause.code : undefined;
}
function errorMessage(cause: unknown) {
  const code = errorCodeOf(cause);
  return t(
    code === "survey_version_conflict" || code === "version_conflict"
      ? "surveys.conflict"
      : code === "unbound_media"
        ? "surveys.unboundMedia"
        : "surveys.requestFailed",
  );
}

let generation = 0;
async function load() {
  const own = ++generation;
  forceLeave = false;
  discardReview();
  loading.value = true;
  error.value = "";
  try {
    const next = await surveysApi.get(surveyId.value);
    if (own !== generation) return;
    survey.value = next;
    draftVersion.value = next.draftVersion;
    history.reset({
      definition: next.definition,
      responseLimit: next.responseLimit,
    });
    dataBadgeCount.value = null;
    aiCreatedCard.value = takeAiCreatedSurveyHandoff(surveyId.value);
    autosave.settled();
    if (next.review) receiveReview(next.review);
  } catch (e) {
    if (own === generation) error.value = errorMessage(e);
  } finally {
    if (own === generation) loading.value = false;
  }
}

// 数据段答卷列表加载后同步徽标口径（规格：数据徽标与数据段口径同步）：
// 徽标跟随「数据段当前加载版本」的答卷数；已回收数（completedCount，发放段
// 回收进度的口径）只认当前采集版本的加载结果，旧版本计数不回写。
const dataBadgeCount = ref<number | null>(null);
function onResponsesLoaded(info: { revisionId: string; count: number }) {
  const current = survey.value;
  if (!current) return;
  dataBadgeCount.value = info.count;
  if (info.revisionId !== current.currentRevisionId) return;
  if (current.completedCount === info.count) return;
  survey.value = { ...current, completedCount: info.count };
}

async function action(fn: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await fn();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

// 发布：先 flush 未完成的自动保存；客户端校验不过不发请求（不弹无信息量的
// 通用错误），直接定位到第一条问题。确认走发布前检查视图（issue #224 M3）：
// 只陈述基本事实与提醒（待确认事项/试填/未采纳 review），不宣称「全部通过」，
// 结构校验仍是唯一阻断；失败保留对话框与错误反馈。
const publishOpen = ref(false);
const publishError = ref("");
const publishNextRevision = computed(
  () => (survey.value?.revisions[0]?.revision ?? 0) + 1,
);
const publishDesign = computed(() => definition.value.researchDesign ?? null);
// 「有研究设计」的发布侧判据：保存试填反馈会在无设计草稿上合成空基底，
// 只看 researchDesign 存在会把空设计当成「没有待确认事项」的绿色事实。
const publishDesignUsable = computed(() => {
  const design = definition.value.researchDesign;
  return !!design && !!design.researchQuestion.trim();
});
// 试填记录（作者自报）：唯一数据是 definition.researchDesign.pretest；工作台
// 顶栏直达面板（复制提纲 + 按题反馈），发布确认只留聚合摘要。保存走
// commitDefinition 同一历史/自动保存链路，不新增服务器路由。
const pretestOpen = ref(false);
function openPretestFromPublish() {
  publishOpen.value = false;
  pretestOpen.value = true;
}
function savePretest(payload: {
  participantCount: number;
  notes: string;
  revisionId?: string;
  itemFeedback: SurveyPretestItemFeedback[];
}) {
  if (!survey.value?.canWrite) return;
  // 冲突是终态：不再提交任何变更，提示与全局冲突横幅一致，不给「已记录」假成功。
  if (autosave.status.value === "conflict") {
    notify.warn(t("surveys.conflict"));
    return;
  }
  commitDefinition(
    {
      ...definition.value,
      researchDesign: {
        // 草稿尚无研究设计时按 schema 基底补全，避免缺字段对象流入模板/发布。
        researchQuestion: "",
        population: "",
        recruitment: "",
        purpose: "describe",
        timeBudgetMinutes: 5,
        constructs: [],
        analysisPlan: "",
        assumptions: [],
        pendingDecisions: [],
        ...publishDesign.value,
        pretest: {
          ...payload,
          recordedAt: new Date().toISOString(),
        },
      },
    },
    "pretest",
  );
  pretestOpen.value = false;
  notify.success(t("surveys.pretestPanel.saved"));
}
// 发布确认的聚合口径：按题反馈条数与四类分布，从已保存记录即时汇总。
const pretestAspectCounts = computed<Record<SurveyPretestItemFeedback["aspect"], number>>(() => {
  const counts = { comprehension: 0, recall: 0, judgment: 0, response: 0 };
  for (const item of publishDesign.value?.pretest?.itemFeedback ?? []) counts[item.aspect] += 1;
  return counts;
});
const pretestRevisionLine = computed(() => {
  // 人读版本序数（发布框同款口径）：从 revisions 列表把 id 换成第 n 版。
  const revisionId = publishDesign.value?.pretest?.revisionId;
  const ordinal = revisionId
    ? survey.value?.revisions.find((revision) => revision.id === revisionId)?.revision
    : undefined;
  return ordinal
    ? t("surveys.publishCheck.pretestRevision", { n: ordinal })
    : t("surveys.publishCheck.pretestRevisionNone");
});
const pendingReview = computed(() =>
  reviewReport.value && reviewPlan.value
    ? {
        summary: reviewReport.value.summary,
        findings: reviewReport.value.findings.length,
        stale: reviewStale.value,
      }
    : null,
);

// 「题目数」口径：只数真实题目（页序展开），说明块单独陈述，避免发布事实
// 与提纲「共 N 题」互相矛盾。AI 建卷提示卡用同一口径。
const answerableCount = computed(() => {
  let questions = 0;
  let statements = 0;
  for (const page of definition.value.pages)
    for (const id of page.questionIds) {
      const question = definition.value.questions.find((item) => item.id === id);
      if (!question) continue;
      if (question.type === "statement") statements += 1;
      else questions += 1;
    }
  return { questions, statements };
});
// en 的单复数分支（repo 门禁禁止消息里的裸 |），键在调用点按数选：
// 题目短语先拼好再入句，说明块单独一句。
const publishFactsLine = computed(() => {
  const pages = definition.value.pages.length;
  const questionPhrase =
    answerableCount.value.questions === 1
      ? t("surveys.publishCheck.factsQuestionOne")
      : t("surveys.publishCheck.factsQuestionMany", { n: answerableCount.value.questions });
  const line =
    pages === 1
      ? t("surveys.publishCheck.factsOne", { questions: questionPhrase })
      : t("surveys.publishCheck.factsMany", { questions: questionPhrase, pages });
  if (!answerableCount.value.statements) return line;
  return `${line} ${
    answerableCount.value.statements === 1
      ? t("surveys.publishCheck.factsStatementOne")
      : t("surveys.publishCheck.factsStatementMany", { n: answerableCount.value.statements })
  }`;
});

async function publish() {
  const target = survey.value;
  if (!target) return;
  if (definitionIssues.value.length) {
    // 非 design 段画布未挂载：先切回设计段等 canvas 就绪再定位第一条问题，
    // 保证用户看得见要修什么。
    stage.value = "design";
    await nextTick();
    canvasRef.value?.locateIssue(0);
    return;
  }
  if (!(await autosave.flush())) {
    notify.warn(t("surveys.assistant.saveFirst"));
    return;
  }
  publishError.value = "";
  publishOpen.value = true;
}

async function confirmPublish() {
  const target = survey.value;
  if (!target || busy.value) return;
  await action(async () => {
    // 对话框内可能刚记录了试填：确认发布前必须再落盘一次，保证版本与记录
    // 一起进历史，失败则留在确认视图给错误反馈。
    if (!(await autosave.flush())) {
      publishError.value = t("surveys.assistant.saveFirst");
      return;
    }
    survey.value = await surveysApi.publish(target.id);
    // 发布生成不可变版本，落发放段：发布后的下一步动作就是发链接。
    publishOpen.value = false;
    stage.value = "distribute";
  });
  if (error.value) publishError.value = error.value;
}

async function setStatus(status: "published" | "paused") {
  await action(async () => {
    survey.value = await surveysApi.status(survey.value!.id, status);
  });
}

async function closeCollection() {
  await action(async () => {
    survey.value = await surveysApi.status(survey.value!.id, "closed");
  });
}

function closeSurvey() {
  confirm.require({
    header: t("surveys.close"),
    message: t("surveys.closeConfirm"),
    acceptLabel: t("surveys.close"),
    rejectLabel: t("surveys.cancel"),
    rejectProps: { severity: "secondary", text: true },
    acceptProps: { severity: "danger" },
    accept: () => void closeCollection(),
  });
}

function removeSurvey() {
  confirm.require({
    header: t("surveys.deleteSurvey"),
    message: t("surveys.deleteSurveyConfirm"),
    accept: () =>
      void action(async () => {
        await surveysApi.remove(survey.value!.id);
        // 问卷已删，本地未落盘修改随之而去，别再触发离开确认。
        forceLeave = true;
        host.navigate({ name: "surveys.list" });
      }),
  });
}

async function locateQuestion(id: string) {
  stage.value = "design";
  await nextTick();
  await canvasRef.value?.locateQuestion(id);
}

function severity(status: SurveyStatus) {
  return status === "published"
    ? "success"
    : status === "paused"
      ? "warn"
      : "secondary";
}

const savedAtText = computed(() => {
  const savedAt = autosave.savedAt.value;
  if (!savedAt) return "";
  return `${String(savedAt.getHours()).padStart(2, "0")}:${String(savedAt.getMinutes()).padStart(2, "0")}`;
});

onMounted(() => {
  void load();
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("pagehide", onPageHide);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("beforeunload", onBeforeUnload);
  window.removeEventListener("pagehide", onPageHide);
  unregisterCopilotHandlers?.();
  host.copilot?.releasePageState();
});
// pagehide 覆盖 beforeunload 管不到的卸载路径（bfcache、移动端切走）：
// keepalive 发出即返回，不等响应。
function onPageHide() {
  autosave.flushBeacon();
}
watch(surveyId, () => {
  mobileNavigationOpen.value = false;
  stage.value = stageFromRoute();
  workspaceRevisionId.value = typeof route.query.revisionId === "string" ? route.query.revisionId : "";
  selectedQuestionId.value = "";
  void load();
});

watch(stage, (value, previous) => {
  if (value !== "data" && value !== "analysis") dataBadgeCount.value = null;
  if (value === previous) return;
  stageNavigation.value = null;
  updateWorkspaceQuery({
    stage: value === "design" ? undefined : value,
    run: value === "analysis" ? route.query.run as string | undefined : undefined,
    revisionId: value === "data" || value === "analysis" ? workspaceRevisionId.value || undefined : undefined,
  });
});
watch(
  () => [route.query.stage, route.query.run, route.query.revisionId],
  () => {
    const next = stageFromRoute();
    if (stage.value !== next) stage.value = next;
    workspaceRevisionId.value = typeof route.query.revisionId === "string" ? route.query.revisionId : "";
  },
);

// ── 离开保护：有未落盘内容先落盘后放行；落不了盘（失败/冲突）才拦 ────────
let forceLeave = false;
async function guardNavigation(to: RouteLocationNormalized) {
  if (forceLeave || (!autosave.hasUnsaved() && autosave.status.value !== "saving")) return true;
  const flushed = await autosave.flush();
  if (flushed) return true;
  confirm.require({
    header: t("surveys.leaveHeader"),
    message: t("surveys.leaveMessage"),
    accept: () => {
      forceLeave = true;
      void router.push(to);
    },
  });
  return false;
}
onBeforeRouteLeave(guardNavigation);
onBeforeRouteUpdate((to, from) => to.params.surveyId === from.params.surveyId ? true : guardNavigation(to));
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!autosave.hasUnsaved() && autosave.status.value !== "saving") return;
  event.preventDefault();
  event.returnValue = "";
}
</script>
<template>
  <div class="survey-workbench">
    <SurveyWorkbenchShell :tabs="leftTabs">
      <template #left="{ activeTab }">
        <Button v-if="!host.workbenchShell" class="mobile-survey-toggle" :label="t('surveys.leftPanel')" :icon="mobileNavigationOpen ? 'pi pi-chevron-up' : 'pi pi-bars'" :aria-expanded="mobileNavigationOpen" text severity="secondary" @click="mobileNavigationOpen = !mobileNavigationOpen" />
        <div class="survey-left-content" :class="{ 'is-open': !!host.workbenchShell || mobileNavigationOpen, 'is-standalone': !host.workbenchShell }">
        <SurveyStageNavigation
          v-if="stageNavigation && (stage === 'data' || stage === 'analysis')"
          :model="stageNavigation"
          @select="dataAnalysisRef?.selectStageNavigation($event)"
        />
        <SurveyOutlinePanel
          v-if="activeTab === 'outline' && survey && stage === 'design'"
          :definition="definition"
          :selected-id="selectedQuestionId"
          @select="locateQuestion"
          @cover="canvasRef?.locateCover()"
        />
        <SurveyVersionsPanel
          v-if="activeTab === 'versions' && survey"
          :revisions="survey.revisions"
          :current-revision-id="survey.currentRevisionId"
          :status="survey.status"
          :can-write="survey.canWrite"
          :can-delete="survey.canDelete"
          :busy="busy"
          @change="setStatus($event)"
          @close="closeSurvey"
          @remove="removeSurvey"
        />
        </div>
      </template>
      <template #center>
        <main class="survey-stage">
          <header class="stage-topbar">
            <div class="topbar-title">
              <!-- 跨卷切换：返回箭头 + 标题即切换入口，按需拉取，不常驻第二份列表。 -->
              <SurveySwitcher v-if="survey" :current-id="surveyId" :current-title="definition.title || survey.title" />
              <h1 v-else>{{ definition.title || t("surveys.heading") }}</h1>
              <!-- 状态唯一展示位：设计段 muted 状态字，非设计段同位置换 Tag；不与轨道徽标重复。 -->
              <span v-if="survey && stage === 'design'" class="draft-state tw:text-muted tw:text-xs"
                v-tooltip.bottom="t('surveys.revisionHint')">{{ t(!hasRevision ? 'surveys.draftUnpublished' : definitionDirty ? 'surveys.draftUnpublishedChanges' : 'surveys.draftMatchesPublished') }}</span>
              <Tag
                v-else-if="survey"
                :value="t(`surveys.status.${survey.status}`)"
                :severity="severity(survey.status)"
              />
            </div>
            <SurveyLifecycleTrack
              v-if="survey"
              :stage="stage"
              :has-revision="hasRevision"
              :status="survey.status"
              :completed-count="dataBadgeCount ?? survey.completedCount"
              :dirty="definitionDirty"
              @change="stage = $event as Stage"
            />
            <div v-if="survey" class="topbar-actions">
              <div
                v-if="survey.canWrite"
                class="save-state"
                :data-status="autosave.status.value"
                aria-live="polite"
              >
                <span
                  v-if="
                    autosave.status.value === 'saving' ||
                    autosave.status.value === 'pending'
                  "
                  class="save-state__text"
                  >{{ t("surveys.saving") }}</span
                >
                <span
                  v-else-if="autosave.status.value === 'saved' && savedAtText"
                  class="save-state__text"
                  >{{ t("surveys.savedAt", { time: savedAtText }) }}</span
                >
                <Button
                  v-else-if="autosave.status.value === 'error'"
                  severity="danger"
                  variant="text"
                  :aria-label="t('surveys.saveRetry')"
                  @click="autosave.retry()"
                  >{{ t("surveys.saveRetry") }}</Button
                >
              </div>
              <!-- tooltip 挂外层 span：禁用按钮吃不掉指针事件，历史说明在禁用态也能看到。 -->
              <span class="history-action" v-tooltip.bottom="t('surveys.undoHint')">
                <Button
                  severity="secondary"
                  variant="text"
                  :aria-label="t('surveys.undo')"
                  :disabled="!canUndo"
                  @click="undo"
                >
                  <template #icon><Undo2 :size="16" /></template>
                </Button>
              </span>
              <span class="history-action" v-tooltip.bottom="t('surveys.redoHint')">
                <Button
                  severity="secondary"
                  variant="text"
                  :aria-label="t('surveys.redo')"
                  :disabled="!canRedo"
                  @click="redo"
                >
                  <template #icon><Redo2 :size="16" /></template>
                </Button>
              </span>
              <Button
                severity="secondary"
                variant="text"
                :aria-label="t('surveys.preview')"
                v-tooltip.bottom="t('surveys.preview')"
                @click="previewOpen = true"
              >
                <template #icon><Eye :size="17" /></template>
              </Button>
              <Button
                v-if="survey.canWrite"
                severity="secondary"
                variant="text"
                :label="t('surveys.pretestPanel.open')"
                v-tooltip.bottom="t('surveys.pretestPanel.open')"
                @click="pretestOpen = true"
              />
              <Button
                :label="t('surveys.publish')"
                icon="pi pi-send"
                :loading="busy"
                :disabled="
                  !survey.canWrite ||
                  survey.status === 'closed' ||
                  !!definitionIssues.length
                "
                @click="publish"
              />
            </div>
          </header>
          <!-- AI 建卷落地提示：独立于下方错误/编辑横幅链，不互相挤占。 -->
          <Message
            v-if="aiCreatedCard"
            severity="info"
            :closable="true"
            @close="aiCreatedCard = null"
          >
            {{
              t("surveys.copilot.aiCreated", {
                title: aiCreatedCard.title,
                pages: definition.pages.length,
                questions: answerableCount.questions,
              })
            }}{{ aiCreatedCard.issues?.length
              ? " " +
                t("surveys.copilot.aiCreatedIssues", {
                  n: aiCreatedCard.issues.length,
                })
              : ""
            }}</Message
          >
          <Message
            v-if="autosave.status.value === 'conflict'"
            severity="error"
            :closable="false"
            >{{ t("surveys.conflictBanner")
            }}<Button :label="t('surveys.reload')" text @click="load"
          /></Message>
          <Message
            v-else-if="aiStaleDelivery"
            severity="warn"
            :closable="true"
            @close="aiStaleDelivery = null"
          >
            {{ t("surveys.copilot.staleDelivery") }}<Button
              :label="t('surveys.copilot.staleApply')"
              text
              severity="warn"
              @click="confirmStaleDelivery"
            /><Button
              :label="t('surveys.copilot.staleDiscard')"
              text
              severity="secondary"
              @click="aiStaleDelivery = null"
          /></Message>
          <Message v-else-if="error" severity="error" :closable="false"
            >{{ error }}<Button :label="t('surveys.reload')" text @click="load"
          /></Message>
          <AsyncSlot
            class="stage-body"
            :status="
              loading ? 'loading' : error && !survey ? 'error' : 'ready'
            "
            skeleton="list"
            error-title="surveys.requestFailed"
            @retry="load"
          >
            <template v-if="survey">
              <SurveyResearchDesignSummary
                v-if="stage === 'design'"
                :design="publishDesign"
                :definition="definition"
              />
              <SurveyDesignCanvas
                v-if="stage === 'design'"
                ref="canvasRef"
                :model-value="definition"
                :disabled="!survey.canWrite"
                :active-question-id="selectedQuestionId"
                :survey-id="surveyId"
                :review-question-ids="reviewQuestionIds"
                @select="selectedQuestionId = $event"
                @change="(next, label) => commitDefinition(next, label)"
              >
                <template #cover-review>
                  <SurveyInlineReview v-if="reviewReport" :definition="definition" :report="reviewReport"
                    :stale="reviewStale" :applying="reviewApplying" :disabled="!survey.canWrite"
                    @apply="applyFinding" @dismiss="discardFinding" />
                </template>
                <template #question-review="{ questionId }">
                  <SurveyInlineReview v-if="reviewReport" :question-id="questionId" :definition="definition"
                    :report="reviewReport" :stale="reviewStale" :applying="reviewApplying" :disabled="!survey.canWrite"
                    @apply="applyFinding" @dismiss="discardFinding" />
                  <SurveyInlineReview v-for="addition in reviewAdditions.filter((item) => item.beforeQuestionId === questionId)"
                    :key="addition.questionId" :question-id="addition.questionId" :definition="definition"
                    :report="reviewReport!" :stale="reviewStale" :applying="reviewApplying" :disabled="!survey.canWrite"
                    @apply="applyFinding" @dismiss="discardFinding" />
                </template>
                <template #insert-review="{ pageId, afterId }">
                  <SurveyInlineReview v-for="addition in reviewAdditions.filter((item) => item.pageId === pageId && item.afterId === afterId && !item.beforeQuestionId)"
                    :key="addition.questionId" :question-id="addition.questionId" :definition="definition"
                    :report="reviewReport!" :stale="reviewStale" :applying="reviewApplying" :disabled="!survey.canWrite"
                    @apply="applyFinding" @dismiss="discardFinding" />
                </template>
              </SurveyDesignCanvas>
              <SurveyDistributePanel
                v-if="stage === 'distribute'"
                :slug="survey.slug"
                :status="survey.status"
                :completed-count="survey.completedCount"
                :started-count="survey.startedCount"
                :response-limit="responseLimit"
                :can-write="survey.canWrite"
                :busy="busy"
                @update:response-limit="
                  commit({ ...history.current.value, responseLimit: $event })
                "
                @change="setStatus($event)"
                @close="closeSurvey"
              />
              <SurveyDataAnalysis
                v-else-if="stage === 'data' || stage === 'analysis'"
                ref="dataAnalysisRef"
                :key="survey.id"
                :survey="survey"
                :mode="stage === 'data' ? 'data' : 'analysis'"
                :revision-id="workspaceRevisionId"
                @responses-loaded="onResponsesLoaded"
                @revision-change="workspaceRevisionId = $event; updateWorkspaceQuery({ revisionId: $event || undefined })"
                @navigation-change="stageNavigation = $event"
                @run-change="updateWorkspaceQuery({ stage: 'analysis', run: $event || undefined })"
              />
            </template>
          </AsyncSlot>
        </main>
      </template>
    </SurveyWorkbenchShell>
    <SurveyPreviewOverlay
      v-if="survey"
      :definition="definition"
      :visible="previewOpen"
      :survey-id="surveyId"
      @update:visible="previewOpen = $event"
    />
    <SurveyPretestPanel
      v-if="survey"
      :visible="pretestOpen"
      :definition="definition"
      :pretest="publishDesign?.pretest ?? null"
      :revision-id="survey.currentRevisionId ?? ''"
      :revision-number="currentRevisionNumber"
      :busy="busy"
      @save="savePretest"
      @update:visible="pretestOpen = $event"
    />
    <!-- 发布前确认（issue #224 M3）：结构校验在打开前已完成并通过，这里只
         陈述事实与提醒，区分「建议确认」与「结构阻断」，不虚构全部通过。 -->
    <Dialog
      v-model:visible="publishOpen"
      modal
      :header="t('surveys.publish')"
      class="survey-dialog publish-dialog"
    >
      <div class="publish-check">
        <p class="publish-intro">
          {{ t("surveys.publishConfirm", { n: publishNextRevision }) }}
        </p>
        <p class="publish-facts">{{ publishFactsLine }}</p>
        <div class="publish-reminders" role="list">
          <p class="publish-reminders-title">{{ t("surveys.publishCheck.remindersTitle") }}</p>
          <div v-if="!publishDesignUsable" role="listitem" class="publish-reminder">
            <i class="pi pi-exclamation-triangle" aria-hidden="true" />
            <span>{{ t("surveys.publishCheck.noDesign") }}</span>
          </div>
          <template v-else>
            <div v-if="publishDesign?.pendingDecisions.length" role="listitem" class="publish-reminder">
              <i class="pi pi-exclamation-triangle" aria-hidden="true" />
              <span>
                {{ t("surveys.publishCheck.pendingDecisions", { n: publishDesign.pendingDecisions.length }) }}
                <span class="publish-reminder-detail">
                  <span v-for="note in publishDesign.pendingDecisions" :key="note" class="publish-decision">{{ note }}</span>
                </span>
              </span>
            </div>
            <div v-else role="listitem" class="publish-reminder is-ok">
              <i class="pi pi-check" aria-hidden="true" />
              <span>{{ t("surveys.publishCheck.noPending") }}</span>
            </div>
          </template>
          <div role="listitem" class="publish-reminder" :class="{ 'is-ok': !!publishDesign?.pretest }">
            <i class="pi" :class="publishDesign?.pretest ? 'pi-check' : 'pi-exclamation-triangle'" aria-hidden="true" />
            <span>
              {{ publishDesign?.pretest
                ? t("surveys.publishCheck.pretestDone", { n: publishDesign.pretest.participantCount })
                : t("surveys.publishCheck.noPretest") }}
            </span>
          </div>
          <div v-if="pendingReview" role="listitem" class="publish-reminder" :class="{ 'is-stale': pendingReview.stale }">
            <i class="pi pi-exclamation-triangle" aria-hidden="true" />
            <span>
              {{ pendingReview.stale
                ? t("surveys.publishCheck.staleReview", { n: pendingReview.findings })
                : t("surveys.publishCheck.pendingReview", { n: pendingReview.findings }) }}
              <span class="publish-reminder-detail">{{ pendingReview.summary }}</span>
            </span>
          </div>
        </div>
        <!-- 试填聚合摘要（issue #224 阶段4）：记录入口在工作台顶栏，这里只陈述
             已保存的事实（作者自报口径），需要补充时跳转面板。 -->
        <details v-if="survey?.canWrite" class="publish-pretest">
          <summary>{{ t("surveys.assistant.trialTitle") }}</summary>
          <template v-if="publishDesign?.pretest">
            <p class="publish-pretest-hint">{{ t("surveys.publishCheck.pretestDone", { n: publishDesign.pretest.participantCount }) }}</p>
            <p class="publish-pretest-hint">{{ t("surveys.publishCheck.pretestFeedback", { n: publishDesign.pretest.itemFeedback?.length ?? 0 }) }}</p>
            <p class="publish-pretest-hint">{{ t("surveys.publishCheck.pretestAspects", pretestAspectCounts) }}</p>
            <p class="publish-pretest-hint">{{ pretestRevisionLine }}</p>
            <p class="publish-pretest-hint">{{ t("surveys.assistant.trialRecorded") }}</p>
          </template>
          <template v-else>
            <p class="publish-pretest-hint">{{ t("surveys.publishCheck.noPretest") }}</p>
            <p class="publish-pretest-hint">{{ t("surveys.publishCheck.pretestHint") }}</p>
          </template>
          <Button :label="t('surveys.pretestPanel.open')" severity="secondary" @click="openPretestFromPublish" />
        </details>
        <p class="publish-disclaimer">{{ t("surveys.publishCheck.disclaimer") }}</p>
        <Message v-if="publishError" severity="error" :closable="false">
          {{ publishError }}
        </Message>
      </div>
      <template #footer>
        <Button
          :label="t('surveys.cancel')"
          text
          severity="secondary"
          :disabled="busy"
          @click="publishOpen = false"
        />
        <Button
          :label="t('surveys.publish')"
          icon="pi pi-send"
          :loading="busy"
          @click="confirmPublish"
        />
      </template>
    </Dialog>
  </div>
</template>
<style scoped>
.survey-left-content { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.mobile-survey-toggle { display: none; }
@media (max-width: 767.98px) {
  .mobile-survey-toggle { display: flex; width: 100%; justify-content: space-between; }
  .survey-left-content { display: none; }
  .survey-left-content.is-standalone { max-height: 45vh; overflow-y: auto; }
  .survey-left-content.is-open { display: block; }
}

.survey-workbench {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.survey-stage {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.stage-topbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px 12px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-surface-base);
}
.topbar-title {
  display: flex;
  align-items: center;
  gap: .4rem;
  min-width: 0;
}
.draft-state { white-space: nowrap; }
.topbar-title h1 {
  margin: 0;
  font-size: var(--font-size-title-sm, 14px);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 14rem;
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}
.history-action {
  display: inline-flex;
}
/* 禁用按钮吞指针事件会让 tooltip 失效：跳过按钮，让外层 span 收到 hover。 */
.history-action :deep(.p-button:disabled) {
  pointer-events: none;
}
.save-state {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}
.save-state__text {
  font-size: 12px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.stage-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--layout-card-padding-lg);
  display: flex;
  flex-direction: column;
  gap: var(--layout-card-padding-lg);
}
@media (max-width: 767.98px) {
  .stage-topbar {
    gap: 8px;
    padding: 8px;
  }
  .topbar-actions {
    width: 100%;
    justify-content: flex-end;
  }
  .stage-body {
    padding: var(--layout-card-padding);
  }
}
.publish-check {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.publish-intro,
.publish-facts {
  margin: 0;
  color: var(--color-text-primary);
}
.publish-facts {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}
.publish-reminders {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--layout-card-radius, 0.5rem);
  padding: 0.75rem 0.9rem;
}
.publish-reminders-title {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
}
.publish-reminder {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--color-text-primary);
}
.publish-reminder > i {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}
.publish-reminder.is-ok > i {
  color: var(--color-success-600);
}
.publish-decision {
  display: block;
}
.publish-reminder-detail {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
  overflow-wrap: anywhere;
}
.publish-disclaimer {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text-tertiary);
}
.publish-pretest {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-top: 1px solid var(--color-border-subtle);
  padding-top: 0.6rem;
}
.publish-pretest summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 0.85rem;
}
.publish-pretest-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
  line-height: 1.6;
}
</style>
