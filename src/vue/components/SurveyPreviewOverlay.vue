<script setup lang="ts">
// 预览弹层（issue #217）：真实分页流程（引导页 consent → 逐页（按路径求值）
// → 完成态），桌面 / 手机（390px 机身框 + 状态栏暗示）切换。不建会话、不计入
// 回收；说明类字段走宿主 renderMarkdown 渲染，与作答页同一口径。每次打开或
// 「重新预览」都从头开始（consent / 第一页，答案清空）。
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import Dialog from "primevue/dialog";
import Message from "primevue/message";
import ProgressBar from "primevue/progressbar";
import SelectButton from "primevue/selectbutton";
import { Monitor, Smartphone } from "lucide-vue-next";

import type {
  SurveyAnswers,
  SurveyDefinition,
  SurveyQuestion,
} from "../../contracts/index.js";
import {
  evaluateSurveyPath,
  pruneSurveyAnswers,
  validateSurveyAnswers,
} from "../../core/index.js";
import { useSurveysHost } from "../host.js";
import { useSurveysApi } from "../api.js";

import SurveyQuestionField from "./SurveyQuestionField.vue";

const props = defineProps<{
  definition: SurveyDefinition;
  visible: boolean;
  /** 草稿期选项图地址前缀（作者认证侧）；缺省按定义里的 imageUrl 解析。 */
  surveyId?: string;
}>();
const emit = defineEmits<{ "update:visible": [value: boolean] }>();
const { t } = useI18n();
const { renderMarkdown } = useSurveysHost();
const api = useSurveysApi();
// 草稿期选项图地址前缀经包 API 的 mediaUrl 工厂取同一口径（fileId 传空串去尾斜杠）。
const mediaUrlBase = computed(() =>
  props.surveyId ? api.mediaUrl(props.surveyId, "").replace(/\/$/, "") : undefined,
);

type Device = "desktop" | "mobile";
const deviceOptions = computed(() => [
  { value: "desktop" as Device, label: t("surveys.previewDesktop"), icon: Monitor },
  { value: "mobile" as Device, label: t("surveys.previewMobile"), icon: Smartphone },
]);
const device = ref<Device>("desktop");

// 预览流程状态：consent 引导页（勾选同意 → 点「开始填写」）→ pageIndex → done。
// 引导页的显隐挂在 started 上，不挂在勾选态——否则勾选即跳页，开始按钮永不可达
// （与作答页 SurveyPublicPage 的 !session 门同一两步流程）。
const consent = ref(false);
const started = ref(false);
const answers = ref<SurveyAnswers>({});
const pageIndex = ref(0);
const finished = ref(false);
const invalidText = ref("");

watch(
  () => props.visible,
  (open) => {
    if (open) reset();
  },
);
function reset() {
  consent.value = false;
  started.value = false;
  answers.value = {};
  pageIndex.value = 0;
  finished.value = false;
  invalidText.value = "";
}

const path = computed(() =>
  evaluateSurveyPath(props.definition, answers.value),
);
const pages = computed(() =>
  props.definition.pages.filter((p) => path.value.pageIds.includes(p.id)),
);
const page = computed(
  () => pages.value[Math.min(pageIndex.value, pages.value.length - 1)],
);
const questions = computed(
  () =>
    page.value?.questionIds.flatMap((id) => {
      const q = props.definition.questions.find((item) => item.id === id);
      return q && path.value.questionIds.includes(id) ? [q] : [];
    }) ?? [],
);

function updateAnswer(id: string, value: SurveyAnswers[string] | undefined) {
  const next = { ...answers.value };
  if (value === undefined) delete next[id];
  else next[id] = value;
  answers.value = pruneSurveyAnswers(props.definition, next);
  invalidText.value = "";
}

// 与作答页同一拦截口径：矩阵（含矩阵填空）/多项填空指名未答的行/项，排序题
// 说「完成排序」。
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
  const issues = validateSurveyAnswers(props.definition, answers.value);
  const onScope = issues.filter((x) =>
    scopeIds.some((id) => x.path === id || x.path.startsWith(id + ".")),
  );
  const target = onScope[0] ?? issues[0];
  const [qid, subId] = target?.path.split(".") ?? [];
  const q = props.definition.questions.find((item) => item.id === qid);
  if (!target || !q) return t("surveys.validationFailed");
  return target.code === "required_missing"
    ? requiredText(q, subId)
    : t("surveys.checkQuestion", { title: q.title });
}

function next(): boolean {
  const blocked = validateSurveyAnswers(
    props.definition,
    answers.value,
  ).find((x) =>
    questions.value.some((q) => x.path === q.id || x.path.startsWith(q.id + ".")),
  );
  if (blocked) {
    invalidText.value = firstInvalidText(questions.value.map((q) => q.id));
    return false;
  }
  invalidText.value = "";
  pageIndex.value++;
  return true;
}
function previous() {
  invalidText.value = "";
  pageIndex.value = Math.max(0, pageIndex.value - 1);
}
</script>
<template>
  <Dialog
    :visible="visible"
    modal
    :header="t('surveys.preview')"
    class="survey-preview-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="preview-toolbar">
      <p class="preview-hint tw:text-muted">{{ t("surveys.previewHint") }}</p>
      <div class="preview-toolbar__actions">
        <SelectButton
          v-model="device"
          :options="deviceOptions"
          option-value="value"
          option-label="label"
          :allow-empty="false"
          :aria-label="t('surveys.previewDevice')"
        >
          <template #option="{ option }">
            <component :is="option.icon" :size="14" />
            <span>{{ option.label }}</span>
          </template>
        </SelectButton>
        <Button
          severity="secondary"
          variant="text"
          :label="t('surveys.previewRestart')"
          icon="pi pi-refresh"
          :aria-label="t('surveys.previewRestart')"
          @click="reset"
        />
      </div>
    </div>
    <div class="preview-stage" :class="`preview-stage--${device}`">
      <div class="preview-device" :class="{ 'preview-device--phone': device === 'mobile' }">
        <div v-if="device === 'mobile'" class="preview-device__statusbar" aria-hidden="true">
          <span class="preview-device__time">9:41</span>
          <span class="preview-device__notch" />
          <span class="preview-device__battery" />
        </div>
        <div class="preview-paper" :class="{ 'preview-paper--phone': device === 'mobile' }">
        <template v-if="finished">
          <Message severity="success" :closable="false">{{ t("surveys.received") }}</Message>
          <p class="tw:text-muted">{{ t("surveys.receivedHint") }}</p>
        </template>
        <template v-else-if="!started">
          <h1>{{ definition.title }}</h1>
          <div
            v-if="definition.description"
            class="mw-md preview-md"
            v-html="renderMarkdown(definition.description)"
          />
          <div
            v-if="definition.consent"
            class="mw-md preview-md"
            v-html="renderMarkdown(definition.consent)"
          />
          <label class="consent-row"
            ><Checkbox v-model="consent" binary /><span>{{
              t("surveys.consent")
            }}</span></label
          >
          <Button
            :label="t('surveys.start')"
            :disabled="!consent"
            @click="started = true"
          />
        </template>
        <template v-else>
          <div class="preview-progress">
            <span class="tw:text-muted">{{
              t("surveys.pageProgress", {
                current: pageIndex + 1,
                total: pages.length,
              })
            }}</span>
            <ProgressBar
              :value="pages.length ? ((pageIndex + 1) / pages.length) * 100 : 0"
              :show-value="false"
            />
          </div>
          <h2 v-if="page?.title">{{ page.title }}</h2>
          <div
            v-if="page?.description"
            class="mw-md preview-md"
            v-html="renderMarkdown(page.description)"
          />
          <div class="preview-questions">
            <SurveyQuestionField
              v-for="q in questions"
              :key="q.id"
              :question="q"
              :model-value="answers[q.id]"
              :media-url-base="mediaUrlBase"
              @update:model-value="updateAnswer(q.id, $event)"
            />
          </div>
          <Message v-if="invalidText" severity="warn" :closable="false">{{ invalidText }}</Message>
          <div class="preview-actions">
            <Button
              v-if="pageIndex > 0"
              :label="t('surveys.previous')"
              severity="secondary"
              @click="previous"
            />
            <Button
              v-if="pageIndex < pages.length - 1"
              :label="t('surveys.next')"
              @click="next"
            />
            <Button
              v-else
              :label="t('surveys.submit')"
              @click="if (next()) finished = true;"
            />
          </div>
        </template>
        </div>
      </div>
    </div>
  </Dialog>
</template>
<style scoped>
.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}
.preview-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.preview-hint {
  margin: 0;
  font-size: 13px;
}
.preview-stage {
  overflow: auto;
  display: flex;
  justify-content: center;
  background: var(--color-bg-soft);
  border-radius: var(--radius-md, 10px);
  padding: 1rem;
}
.preview-device {
  width: 100%;
  max-width: 44rem;
}
/* 手机档：固定 390 机身（圆角 + 边框 + 状态栏暗示），与桌面档一眼可辨。 */
.preview-device--phone {
  flex: none;
  width: 390px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  padding: 6px 10px 10px;
  border: 1px solid var(--color-border-strong);
  border-radius: calc(var(--radius-lg, 12px) + 10px);
  background: var(--color-surface-muted);
  box-shadow: var(--shadow-md);
}
.preview-device__statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.preview-device__notch {
  width: 72px;
  height: 14px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-pill, 999px);
  background: var(--color-surface-base);
}
.preview-device__battery {
  width: 20px;
  height: 10px;
  border: 1px solid var(--color-text-tertiary);
  border-radius: var(--radius-xs, 4px);
  background:
    linear-gradient(to right, var(--color-text-tertiary) 70%, transparent 70%);
}
.preview-paper {
  width: 100%;
  max-width: 44rem;
  background: var(--color-surface-base);
  border-radius: var(--radius-lg, 14px);
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: var(--layout-card-padding);
}
.preview-paper--phone {
  flex: 1;
  min-width: 0;
  max-width: none;
  border: 1px solid var(--color-border-subtle);
}
.preview-paper h1 {
  margin: 0;
  font-size: var(--font-size-title-md);
  overflow-wrap: anywhere;
}
.preview-paper h2 {
  margin: 0;
  font-size: var(--font-size-title-sm);
}
.preview-md {
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.preview-md :deep(p) {
  margin: 0 0 0.5em;
}
.preview-md :deep(p:last-child) {
  margin-bottom: 0;
}
.consent-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
}
.preview-progress {
  display: grid;
  gap: 0.5rem;
}
.preview-questions {
  display: grid;
  gap: calc(var(--layout-card-padding-lg) * 1.2);
}
.preview-actions {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}
@media (max-width: 767.98px) {
  .preview-stage {
    padding: 0.5rem;
  }
  .preview-paper {
    padding: 1rem;
  }
}
</style>
<style>
:global(.survey-preview-dialog) {
  width: min(56rem, calc(100vw - 2rem));
}
</style>
