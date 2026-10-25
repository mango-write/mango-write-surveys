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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter, type RouteLocationNormalized } from "vue-router";
import { useI18n } from "vue-i18n";
import { useConfirm } from "primevue/useconfirm";
import Button from "primevue/button";
import Message from "primevue/message";
import Tag from "primevue/tag";
import { Eye, History, List, Redo2, Undo2 } from "lucide-vue-next";
import type {
  SurveyDetail,
  SurveyStatus,
  ToolSurveyDelivery,
} from "../../contracts/index.js";
import {
  applySurveyOps,
  buildSurveyReviewPlan,
  canonicalSurveyJson,
  validateSurveyDefinition,
} from "../../core/index.js";

import { AsyncSlot } from "@mango-write/ui";
import SurveyWorkbenchShell, {
  type SurveyShellTab,
} from "../components/SurveyWorkbenchShell.vue";
import {
  SurveysApiError,
  useSurveysHost,
  useSurveysLayoutPrefs,
  type SurveysCopilotSurface,
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
import SurveyNavigator from "../components/SurveyNavigator.vue";
import SurveyInlineReview from "../components/SurveyInlineReview.vue";
import SurveyResearchAssistant from "../components/SurveyResearchAssistant.vue";
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
const stage = ref<Stage>(
  typeof route.query.run === "string" ? "analysis" : "design",
);
const selectedQuestionId = ref("");
const previewOpen = ref(false);
const mobileNavigationOpen = ref(false);
const canvasRef = ref<InstanceType<typeof SurveyDesignCanvas> | null>(null);

const surveyId = computed(() =>
  typeof route.params.surveyId === "string" ? route.params.surveyId : "",
);

useSurveysLayoutPrefs({
  activeLeftTab: "outline",
  leftRailWidth: 300,
  rightRailWidth: 360,
});
const leftTabs = computed<SurveyShellTab[]>(() => [
  { id: "outline", label: t("surveys.outlineTab"), icon: List },
  { id: "versions", label: t("surveys.versionsTab"), icon: History },
]);

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
  aiEditBanner.value = null;
}
function commitDefinition(next: SurveyDetail["definition"], label?: string) {
  commit({ ...history.current.value, definition: next }, label);
}
// 撤销/重做改写历史：先把在途保存落盘，保证 PATCH 的 expectedVersion 以
// 落盘后的版本为基点单调、最终落盘内容 = 当前画布内容；否则撤销后的保存与
// 在途保存竞速，刷新窗口可能把撤销前的正文留成服务端正本。防抖未发的
// pending 不必先发：schedule() 会以撤销后的快照重新计时，一发即最新。
async function undo() {
  if (autosave.status.value === "saving") await autosave.flush();
  if (history.undo()) autosave.schedule();
  aiEditBanner.value = null;
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
const aiEditBanner = ref<{ applied: number; summary: string; rejected: number } | null>(null);
type SurveyEditDelivery = Extract<ToolSurveyDelivery, { type: "survey_edit" }>;
const aiStaleDelivery = ref<SurveyEditDelivery | null>(null);
type SurveyReviewDelivery = Extract<ToolSurveyDelivery, { type: "survey_review" }>;
const reviewReport = ref<SurveyReviewDelivery | null>(null);
const reviewBusy = ref(false);
const reviewApplying = ref(false);
const reviewPlan = computed(() => reviewReport.value
  ? buildSurveyReviewPlan(definition.value, reviewReport.value.findings)
  : null);
const reviewAddedQuestions = computed(() => reviewPlan.value?.candidateDefinition?.questions.filter(q => !definition.value.questions.some(original => original.id === q.id)) ?? []);
const reviewStale = computed(() => !!reviewReport.value && (
  reviewReport.value.baseDraftVersion !== draftVersion.value || !["idle", "saved"].includes(autosave.status.value)
));
async function askResearch(kind: "review" | "design") {
  if (reviewBusy.value || !survey.value?.canWrite) return;
  if (!await autosave.flush()) {
    notify.warn(t("surveys.assistant.saveFirst"));
    return;
  }
  const prompt = t(`surveys.assistant.${kind === "review" ? "reviewPrompt" : "designPrompt"}`);
  if (!host.copilot?.sendPrompt) {
    host.copilot?.fillComposer?.(prompt);
    host.copilot?.focusComposer?.();
    return;
  }
  reviewBusy.value = true;
  try {
    await host.copilot.sendPrompt(prompt, kind === "review" ? ["survey_read", "survey_review"] : ["survey_read", "survey_edit"]);
  } catch {
    notify.error(t("surveys.assistant.requestFailed"));
  } finally {
    reviewBusy.value = false;
  }
}
async function applyReviewPlan() {
  const plan = reviewPlan.value;
  if (!plan || plan.status !== "ready" || !plan.candidateDefinition || reviewStale.value ||
    reviewApplying.value || !survey.value?.canWrite) return;
  reviewApplying.value = true;
  try {
    history.commit(
      { ...history.current.value, definition: plan.candidateDefinition },
      { source: "assistant", label: reviewReport.value?.summary },
    );
    autosave.schedule();
    notify.success(t("surveys.assistant.applied"));
    if (!await autosave.flush()) {
      notify.warn(t("surveys.assistant.saveFirst"));
      return;
    }
    reviewReport.value = null;
  } finally {
    reviewApplying.value = false;
  }
}
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
  }
  aiEditBanner.value = {
    applied: result.applied.length,
    summary: delivery.summary,
    rejected: result.rejected.length,
  };
  if (result.rejected.length > 0) {
    notify.warn(t("surveys.copilot.rejected", { n: result.rejected.length }));
  }
}

async function applySurveyDelivery(delivery: ToolSurveyDelivery) {
  if (delivery.type === "survey_review") {
    if (delivery.surveyId === surveyId.value) reviewReport.value = delivery;
    return;
  }
  if (delivery.type !== "survey_edit") {
    // survey_create：导航到新问卷工作区（列表页与工作区共用同一入口语义）。
    setAiCreatedSurveyHandoff(delivery);
    notify.success(t("surveys.copilot.created", { title: delivery.title }));
    host.navigate({ name: "surveys.detail", surveyId: delivery.surveyId });
    return;
  }
  if (delivery.surveyId !== surveyId.value || !survey.value?.canWrite || stage.value !== "design") return;
  if (autosave.status.value === "saving") await autosave.flush();
  const settled =
    autosave.status.value === "idle" || autosave.status.value === "saved";
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

function undoAiEdit() {
  aiEditBanner.value = null;
  void undo();
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
const currentRevision = computed(() => {
  const detail = survey.value;
  const revisionId = detail?.currentRevisionId;
  if (!detail || !revisionId) return null;
  return detail.revisions.find((revision) => revision.id === revisionId) ?? null;
});

// 「设计段有未发布修改」= 草稿 definition 的 canonical 哈希 ≠ 当前采集版本
// 的 contentHash。canonical 形式唯一来源在 surveys 包 core，与 api 发布时同一份。
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
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonicalSurveyJson(definition.value)),
    );
    if (epoch !== dirtyEpoch) return;
    const hash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    definitionDirty.value = hash !== revision.contentHash;
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
  reviewReport.value = null;
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
// 通用错误），直接定位到第一条问题。
async function publish() {
  const target = survey.value;
  if (!target) return;
  if (definitionIssues.value.length) {
    canvasRef.value?.locateIssue(0);
    return;
  }
  if (!(await autosave.flush())) return;
  const nextRevision = (target.revisions[0]?.revision ?? 0) + 1;
  confirm.require({
    header: t("surveys.publish"),
    message: t("surveys.publishConfirm", { n: nextRevision }),
    accept: () =>
      void action(async () => {
        survey.value = await surveysApi.publish(target.id);
        // 发布生成不可变版本，落发放段：发布后的下一步动作就是发链接。
        stage.value = "distribute";
      }),
  });
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
  stage.value = typeof route.query.run === "string" ? "analysis" : "design";
  selectedQuestionId.value = "";
  void load();
});

// 离开数据/分析段后徽标回到采集口径（数据段的版本选择随组件卸载重置）。
watch(stage, (value) => {
  if (value !== "data" && value !== "analysis") dataBadgeCount.value = null;
});

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
        <Button class="mobile-survey-toggle" :label="t('surveys.navigation.list')" :icon="mobileNavigationOpen ? 'pi pi-chevron-up' : 'pi pi-bars'" :aria-expanded="mobileNavigationOpen" text severity="secondary" @click="mobileNavigationOpen = !mobileNavigationOpen" />
        <div class="survey-left-content" :class="{ 'is-open': mobileNavigationOpen }">
        <SurveyNavigator :current-id="surveyId" :current-title="definition.title" />
        <SurveyOutlinePanel
          v-if="activeTab === 'outline' && survey && stage === 'design'"
          :definition="definition"
          :selected-id="selectedQuestionId"
          @select="selectedQuestionId = $event"
        />
        <SurveyVersionsPanel
          v-else-if="activeTab === 'versions' && survey"
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
              <h1>{{ definition.title || survey?.title || t("surveys.heading") }}</h1>
              <Tag
                v-if="survey"
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
                questions: definition.questions.length,
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
          <Message
            v-else-if="aiEditBanner"
            severity="info"
            :closable="true"
            @close="aiEditBanner = null"
          >
            {{ t("surveys.copilot.applied", { n: aiEditBanner.applied }) }}：{{ aiEditBanner.summary
            }}<Button
              :label="t('surveys.copilot.undoAiEdit')"
              text
              :disabled="!canUndo"
              @click="undoAiEdit"
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
              <SurveyResearchAssistant
                v-if="stage === 'design'"
                :design="definition.researchDesign"
                :definition="definition"
                :questions="definition.questions"
                :report="reviewReport"
                :plan="reviewPlan"
                :stale="reviewStale"
                :busy="reviewBusy || reviewApplying"
                :disabled="!survey.canWrite"
                :has-copilot="!!host.copilot"
                @update:design="commitDefinition({ ...definition, researchDesign: $event })"
                @review="askResearch('review')"
                @design-request="askResearch('design')"
                @apply="applyReviewPlan"
                @locate="selectedQuestionId = $event"
                @preview="previewOpen = true"
              />
              <Message
                v-if="survey.currentRevisionId && stage === 'design'"
                severity="info"
                :closable="false"
                >{{ t("surveys.revisionHint") }}</Message
              >
              <SurveyDesignCanvas
                v-if="stage === 'design'"
                ref="canvasRef"
                :model-value="definition"
                :disabled="!survey.canWrite"
                :active-question-id="selectedQuestionId"
                :survey-id="surveyId"
                @select="selectedQuestionId = $event"
                @change="(next, label) => commitDefinition(next, label)"
              >
                <template #question-review="{ questionId }">
                  <SurveyInlineReview v-if="reviewReport && reviewPlan" :question-id="questionId" :definition="definition" :report="reviewReport" :plan="reviewPlan" :disabled="!survey.canWrite || reviewStale || reviewBusy || reviewApplying" @apply="applyReviewPlan" />
                </template>
              </SurveyDesignCanvas>
              <div v-if="stage === 'design' && reviewReport && reviewPlan && reviewAddedQuestions.length" class="review-additions">
                <SurveyInlineReview v-for="question in reviewAddedQuestions" :key="question.id" :question-id="question.id" :definition="definition" :report="reviewReport" :plan="reviewPlan" :disabled="!survey.canWrite || reviewStale || reviewBusy || reviewApplying" @apply="applyReviewPlan" />
              </div>
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
                :key="survey.id"
                :survey="survey"
                :mode="stage === 'data' ? 'data' : 'analysis'"
                @responses-loaded="onResponsesLoaded"
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
  </div>
</template>
<style scoped>
.mobile-survey-toggle { display: none; }
@media (max-width: 767.98px) {
  .mobile-survey-toggle { display: flex; width: 100%; justify-content: space-between; }
  .survey-left-content { display: none; max-height: 45vh; overflow-y: auto; }
  .survey-left-content.is-open { display: block; }
}

.review-additions { width: 100%; max-width: 46rem; align-self: center; }
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
  gap: var(--layout-card-padding);
  flex-wrap: wrap;
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-surface-base);
}
.topbar-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
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
</style>
