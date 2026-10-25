<script setup lang="ts">
// 公开作答页：宿主只传 slug（路由形态由宿主持有），其余能力经包地基注入
// （transport 认证/baseUrl、renderMarkdown 安全口径）。移动端触控与 safe-area
// 行为（viewport-fit=cover、touch-action、44px 命中区）原样保留。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import Message from "primevue/message";
import ProgressBar from "primevue/progressbar";
import type {
  PublicSurvey,
  SurveySession,
  SurveyAnswers,
  SurveyReceipt,
  SurveyQuestion,
} from "../../contracts/index.js";
import {
  SurveyAnswersSchema,
  evaluateSurveyPath,
  pruneSurveyAnswers,
  validateSurveyAnswers,
} from "../../core/index.js";
import { SurveysApiError, useSurveysHost } from "../host.js";
import { AsyncSlot } from "@mango-write/ui";
import SurveyQuestionField from "../components/SurveyQuestionField.vue";
import { usePublicSurveysApi } from "../api.js";
const props = defineProps<{ slug: string }>();
const { t } = useI18n();
const { renderMarkdown } = useSurveysHost();
const publicSurveysApi = usePublicSurveysApi();
const survey = ref<PublicSurvey | null>(null),
  session = ref<SurveySession | null>(null),
  answers = ref<SurveyAnswers>({}),
  receipt = ref<SurveyReceipt | null>(null);
const loading = ref(true),
  busy = ref(false),
  error = ref(false),
  invalid = ref(false),
  consent = ref(false),
  pageIndex = ref(0),
  honeypot = ref("");
const errorCode = ref("");
function fail(cause: unknown) {
  error.value = true;
  // transport 把非 2xx 归一为 SurveysApiError，code 即服务端错误码。
  errorCode.value = cause instanceof SurveysApiError ? cause.code : "";
  if (errorCode.value === "survey_closed" && survey.value)
    survey.value.status = "closed";
}
const slug = computed(() => props.slug);
const storageKey = computed(() => `mango-survey:${slug.value}`);
const definition = computed(
  () => session.value?.definition ?? survey.value?.definition,
);
const path = computed(() =>
  definition.value
    ? evaluateSurveyPath(definition.value, answers.value)
    : { pageIds: [], questionIds: [] },
);
const pages = computed(
  () =>
    definition.value?.pages.filter((p) => path.value.pageIds.includes(p.id)) ??
    [],
);
const page = computed(
  () => pages.value[Math.min(pageIndex.value, pages.value.length - 1)],
);
const questions = computed(
  () =>
    page.value?.questionIds.flatMap((id) => {
      const q = definition.value?.questions.find((q) => q.id === id);
      return q && path.value.questionIds.includes(id) ? [q] : [];
    }) ?? [],
);
function persist() {
  try {
    if (session.value)
      localStorage.setItem(
        storageKey.value,
        JSON.stringify({
          sessionToken: session.value.sessionToken,
          revisionId: session.value.revisionId,
          answers: answers.value,
          pageIndex: pageIndex.value,
          receipt: receipt.value,
        }),
      );
  } catch {}
}
function updateAnswer(id: string, value: SurveyAnswers[string] | undefined) {
  const next = { ...answers.value };
  if (value === undefined) delete next[id];
  else next[id] = value;
  answers.value = definition.value
    ? pruneSurveyAnswers(definition.value, next)
    : next;
  invalid.value = false;
  invalidText.value = "";
  invalidQuestionId.value = "";
  invalidRowId.value = "";
  pageIndex.value = Math.min(
    pageIndex.value,
    Math.max(0, pages.value.length - 1),
  );
  persist();
}
// 必答拦截要指出是哪道题：第一条未通过 issue 的题干摘要 + 视口滚到该题。
// 矩阵/多项填空的 issue path 带行/项 id（qid.rowId）：文案指名行/项，
// 就地标红也精确到行卡，不让用户在长矩阵里逐格找。
const invalidText = ref("");
const invalidRowId = ref("");
function requiredText(q: SurveyQuestion, subId: string | undefined): string {
  if (
    subId &&
    (q.type === "matrix_single" ||
      q.type === "matrix_multiple" ||
      q.type === "matrix_text")
  ) {
    const row = q.rows.find((r) => r.id === subId);
    if (row)
      return t("surveys.answerRequiredRow", { title: q.title, label: row.label });
  }
  if (subId && q.type === "multi_text") {
    const item = q.items.find((i) => i.id === subId);
    if (item)
      return t("surveys.answerRequiredItem", { title: q.title, label: item.label });
  }
  if (q.type === "ranking") return t("surveys.rankingRequired", { title: q.title });
  return t("surveys.answerRequired", { title: q.title });
}
function firstInvalidText(scopeIds: string[]): string {
  const def = definition.value;
  if (!def) return t("surveys.validationFailed");
  const issues = validateSurveyAnswers(def, answers.value);
  const onScope = issues.filter((x) =>
    scopeIds.some((id) => x.path === id || x.path.startsWith(id + ".")),
  );
  const target = onScope[0] ?? issues[0];
  const [qid, subId] = target?.path.split(".") ?? [];
  const q = def.questions.find((item) => item.id === qid);
  if (!target || !q) return t("surveys.validationFailed");
  return target.code === "required_missing"
    ? requiredText(q, subId)
    : t("surveys.checkQuestion", { title: q.title });
}
function revealQuestion(qid: string) {
  if (typeof document === "undefined" || !qid) return;
  document
    .querySelector(`[data-public-question="${CSS.escape(qid)}"]`)
    ?.scrollIntoView({ block: "center" });
}
// 必答拦截的就地标红：长页下光靠按钮旁文案找不到目标题。
const invalidQuestionId = ref("");
let generation = 0;
async function begin(resumeToken?: string) {
  const own = generation,
    target = slug.value;
  busy.value = true;
  error.value = false;
  errorCode.value = "";
  try {
    if (!resumeToken) {
      answers.value = {};
      pageIndex.value = 0;
      receipt.value = null;
    }
    const result = await publicSurveysApi.start(target, resumeToken);
    if (own !== generation) return;
    session.value = result;
    receipt.value = result.receipt ?? null;
    pageIndex.value = Math.max(
      0,
      Math.min(pageIndex.value, pages.value.length - 1),
    );
    persist();
  } catch (cause) {
    if (own === generation) fail(cause);
  } finally {
    if (own === generation) busy.value = false;
  }
}
async function load() {
  const own = ++generation,
    target = slug.value;
  loading.value = true;
  busy.value = false;
  error.value = false;
  errorCode.value = "";
  try {
    const result = await publicSurveysApi.get(target);
    if (own !== generation) return;
    survey.value = result;
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey.value) ?? "null");
    } catch {}
    if (saved?.sessionToken) {
      answers.value = SurveyAnswersSchema.safeParse(saved.answers).data ?? {};
      pageIndex.value =
        Number.isInteger(saved.pageIndex) && saved.pageIndex >= 0
          ? saved.pageIndex
          : 0;
      receipt.value = null;
      await begin(saved.sessionToken);
    }
  } catch (cause) {
    if (own === generation) fail(cause);
  } finally {
    if (own === generation) loading.value = false;
  }
}
function next() {
  if (!definition.value) return;
  const issues = validateSurveyAnswers(definition.value, answers.value);
  const ids = questions.value.map((q) => q.id);
  const blocked = issues.find((x) =>
    ids.some((id) => x.path === id || x.path.startsWith(id + ".")),
  );
  if (blocked) {
    invalidText.value = firstInvalidText(ids);
    invalid.value = true;
    const [qid, subId] = blocked.path.split(".");
    invalidQuestionId.value = qid ?? "";
    invalidRowId.value = subId ?? "";
    revealQuestion(qid ?? "");
    return;
  }
  invalid.value = false;
  invalidQuestionId.value = "";
  invalidRowId.value = "";
  pageIndex.value++;
  persist();
}
async function submit() {
  if (!definition.value || !session.value || survey.value?.status === "closed")
    return;
  const issues = validateSurveyAnswers(definition.value, answers.value);
  if (issues.length) {
    invalidText.value = firstInvalidText(
      definition.value.pages.flatMap((p) => p.questionIds),
    );
    invalid.value = true;
    const [qid, subId] = issues[0]!.path.split(".");
    invalidQuestionId.value = qid ?? "";
    invalidRowId.value = subId ?? "";
    revealQuestion(qid ?? "");
    return;
  }
  const own = generation,
    target = slug.value;
  busy.value = true;
  error.value = false;
  errorCode.value = "";
  try {
    const result = await publicSurveysApi.submit(
      target,
      session.value.sessionToken,
      answers.value,
      honeypot.value,
    );
    if (own !== generation) return;
    receipt.value = result;
    persist();
  } catch (cause) {
    if (own === generation) fail(cause);
  } finally {
    if (own === generation) busy.value = false;
  }
}
function restart() {
  try {
    localStorage.removeItem(storageKey.value);
  } catch {}
  session.value = null;
  receipt.value = null;
  answers.value = {};
  pageIndex.value = 0;
  consent.value = false;
  void load();
}
// 安全区（PWA/全面屏）：env(safe-area-inset-*) 只在 viewport-fit=cover 时非零。
// 作答页是移动端主要收集面，动态把 cover 加在 /s/:slug 上、离开恢复原值，
// 不改变工作台等其他页面的视口行为。
let viewportPrev: string | null = null;
function coverViewport() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta || viewportPrev !== null) return;
  viewportPrev = meta.getAttribute("content");
  meta.setAttribute("content", `${viewportPrev ?? ""}, viewport-fit=cover`);
}
function restoreViewport() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta && viewportPrev !== null) meta.setAttribute("content", viewportPrev);
  viewportPrev = null;
}
onBeforeUnmount(() => {
  restoreViewport();
  generation++;
});
onMounted(() => {
  coverViewport();
  load();
});
watch(slug, () => {
  survey.value = null;
  consent.value = false;
  session.value = null;
  answers.value = {};
  receipt.value = null;
  pageIndex.value = 0;
  void load();
});
</script>
<template>
  <main class="survey-public tw:bg-canvas">
    <div class="public-paper tw:bg-surface tw:text-default">
      <div class="tw:text-muted tw:text-sm">
        MangoWrite · {{ t("surveys.researchSurvey") }}
      </div>
      <AsyncSlot
        :status="loading ? 'loading' : !survey ? 'error' : 'ready'"
        skeleton="text"
        error-title="surveys.unavailable"
        error-hint="surveys.unavailableHint"
        @retry="load"
      >
        <template v-if="definition">
          <h1>{{ definition.title }}</h1>
          <template v-if="receipt"
            ><Message severity="success" :closable="false">{{
              t("surveys.received")
            }}</Message>
            <p class="tw:text-muted">{{ t("surveys.receivedHint") }}</p>
            <small class="tw:text-muted">{{
              receipt.responseId
            }}</small></template
          >
          <template v-else-if="!session">
            <!-- 说明类字段按 markdown 渲染（breaks: true，老纯文本的单换行仍成行）。 -->
            <div
              v-if="definition.description"
              class="mw-md description-preview"
              v-html="renderMarkdown(definition.description)"
            />
            <div
              v-if="definition.consent"
              class="mw-md description-preview"
              v-html="renderMarkdown(definition.consent)"
            />
            <label class="consent"
              ><Checkbox v-model="consent" binary /><span>{{
                t("surveys.consent")
              }}</span></label
            >
            <Message v-if="error" severity="error" :closable="false">{{
              t(
                errorCode === "session_expired"
                  ? "surveys.sessionExpired"
                  : "surveys.requestFailed",
              )
            }}</Message>
            <Button
              :label="t('surveys.start')"
              :disabled="
                !consent ||
                survey?.status !== 'published' ||
                survey?.quotaReached
              "
              :loading="busy"
              @click="begin()"
            />
            <!-- 预提示对齐暂停态：发放落地页在开始前就告知不可作答及原因。 -->
            <p v-if="survey?.status !== 'published'" class="tw:text-muted">
              {{ t("surveys.collectionStopped") }}
            </p>
            <p v-else-if="survey?.quotaReached" class="tw:text-muted">
              {{ t("surveys.quotaFullLanding") }}
            </p>
          </template>
          <template v-else>
            <div class="public-progress">
              <span class="tw:text-muted">{{
                t("surveys.pageProgress", {
                  current: pageIndex + 1,
                  total: pages.length,
                })
              }}</span
              ><ProgressBar
                :value="
                  pages.length ? ((pageIndex + 1) / pages.length) * 100 : 0
                "
                :show-value="false"
              />
            </div>
            <h2 v-if="page?.title">{{ page.title }}</h2>
            <div
              v-if="page?.description"
              class="mw-md description-preview"
              v-html="renderMarkdown(page.description)"
            />
            <div class="question-list">
              <div
                v-for="q in questions"
                :key="q.id"
                class="question-slot"
                :class="{ 'question-slot--invalid': q.id === invalidQuestionId }"
                :data-public-question="q.id"
              >
                <SurveyQuestionField
                  :question="q"
                  :model-value="answers[q.id]"
                  :disabled="busy || survey?.status === 'closed'"
                  :invalid-row="q.id === invalidQuestionId ? invalidRowId : ''"
                  @update:model-value="updateAnswer(q.id, $event)"
                />
              </div>
            </div>
            <input
              v-model="honeypot"
              class="honeypot"
              tabindex="-1"
              aria-hidden="true"
              autocomplete="off"
              name="website"
            />
            <Message v-if="invalid" severity="warn" :closable="false">{{
              invalidText || t("surveys.validationFailed")
            }}</Message>
            <Message
              v-if="survey?.status === 'closed'"
              severity="warn"
              :closable="false"
              >{{ t("surveys.collectionClosed") }}</Message
            >
            <Message v-if="error" severity="error" :closable="false">{{
              t(
                errorCode === "session_expired"
                  ? "surveys.sessionExpired"
                  : errorCode === "response_limit_reached"
                    ? "surveys.quotaFull"
                    : "surveys.submitFailed",
              )
            }}</Message>
            <Button
              v-if="errorCode === 'session_expired'"
              :label="t('surveys.restart')"
              severity="secondary"
              :disabled="busy"
              @click="restart"
            />
            <div class="public-actions">
              <Button
                v-if="pageIndex > 0"
                :label="t('surveys.previous')"
                severity="secondary"
                :disabled="busy"
                @click="
                  pageIndex--;
                  invalid = false;
                  persist();
                "
              /><span class="tw:text-muted tw:text-sm">{{
                t("surveys.savedLocally")
              }}</span
              ><Button
                v-if="pageIndex < pages.length - 1"
                :label="t('surveys.next')"
                @click="next"
              /><Button
                v-else
                :label="t('surveys.submit')"
                :disabled="
                  survey?.status === 'closed' || errorCode === 'session_expired'
                "
                :loading="busy"
                @click="submit"
              />
            </div>
          </template>
        </template>
      </AsyncSlot>
    </div>
  </main>
</template>
<style scoped>
.survey-public {
  height: 100dvh;
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  /* 双击缩放误触：作答页高频点选，manipulation 只禁双击缩放、保留平移与捏合。 */
  touch-action: manipulation;
  /* 安全区：顶/底让开刘海与手势条，进度条与底部主按钮不被遮挡
    （cover 由本页动态开启；浏览器标签页里 env 为 0，等价于原 padding）。 */
  padding:
    calc(var(--layout-card-padding-lg) + env(safe-area-inset-top))
    calc(var(--layout-card-padding-lg) + env(safe-area-inset-right))
    calc(var(--layout-card-padding-lg) + max(env(safe-area-inset-bottom), 12px))
    calc(var(--layout-card-padding-lg) + env(safe-area-inset-left));
}
.public-paper {
  width: 100%;
  max-width: 44rem;
  border-radius: var(--radius-lg);
  padding: var(--layout-card-padding-lg);
  display: grid;
  gap: var(--layout-card-padding);
  border: 1px solid var(--border);
}
/* 触控目标 ≥44px：视觉可以紧凑，命中区不能小（作答页专属，编辑器画布不受影响）。 */
.public-paper :deep(.question-option),
.public-paper :deep(.mx-cell),
.public-paper :deep(.scale-choice),
.public-paper :deep(.consent),
.public-paper :deep(.nps-cell),
.public-paper :deep(.p-datepicker) {
  min-height: 2.75rem;
  -webkit-tap-highlight-color: transparent;
}
.public-paper :deep(.rating-star) {
  min-width: 2.75rem;
  min-height: 2.75rem;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}
.public-paper :deep(.image-option) {
  -webkit-tap-highlight-color: transparent;
}
/* 排序按钮视觉 28px，命中区经伪元素外扩到 ≥44px（不吃布局）。 */
.public-paper :deep(.ranking-btn) {
  position: relative;
}
.public-paper :deep(.ranking-btn)::after {
  content: "";
  position: absolute;
  inset: -8px;
}
/* 输入控件在作答面统一 44px 高（多行文本不设，保持 auto-resize）。 */
.public-paper :deep(input.p-inputtext),
.public-paper :deep(.p-select) {
  min-height: 2.75rem;
}
/* 主操作按钮：PrimeVue 标准 40px，作答页提到 44px（Message 关闭钮不是
   .p-button，不受影响）。 */
.public-paper :deep(.p-button) {
  min-height: 2.75rem;
}
h1 {
  font-size: var(--font-size-title-md);
  margin: 0;
  overflow-wrap: anywhere;
}
h2 {
  font-size: var(--font-size-title-sm);
}
.description-preview {
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.description-preview :deep(p) {
  margin: 0 0 0.6em;
}
.description-preview :deep(p:last-child) {
  margin-bottom: 0;
}
.question-slot {
  border-radius: var(--radius-md);
  transition: box-shadow var(--motion-duration-fast, 150ms) ease;
}
.question-slot--invalid {
  box-shadow: 0 0 0 2px var(--color-danger-500);
  padding: 8px;
  margin: -8px;
}
.consent,
.public-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.public-actions {
  justify-content: space-between;
}
.question-list {
  display: grid;
  gap: calc(var(--layout-card-padding-lg) * 1.5);
  padding-block: var(--layout-card-padding);
}
.public-progress {
  display: grid;
  gap: 0.5rem;
}
.honeypot {
  display: none;
}
@media (max-width: 767.98px) {
  .survey-public {
    padding:
      calc(var(--layout-card-padding-compact) + env(safe-area-inset-top))
      calc(var(--layout-card-padding-compact) + env(safe-area-inset-right))
      calc(var(--layout-card-padding-compact) + max(env(safe-area-inset-bottom), 12px))
      calc(var(--layout-card-padding-compact) + env(safe-area-inset-left));
  }
  .public-paper {
    padding: var(--layout-card-padding);
    /* 窄屏短页（引导页等）垂直居中，不再贴顶留整屏空白；
       内容超屏时 auto margin 归零，长页仍从顶部起排。 */
    margin-block: auto;
  }
  .public-actions > span {
    flex-basis: 100%;
    order: 2;
  }
}
</style>
