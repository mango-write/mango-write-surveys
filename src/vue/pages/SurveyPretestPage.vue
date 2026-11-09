<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "@mango-write/ui-vue/components/Button";
import Checkbox from "@mango-write/ui-vue/components/Checkbox";
import Message from "@mango-write/ui-vue/components/Message";
import Textarea from "@mango-write/ui-vue/components/Textarea";
import { AsyncSlot } from "@mango-write/ui-vue";
import { evaluateSurveyPath, pruneSurveyAnswers, validateSurveyAnswers, type SurveyAnswers, type SurveyDefinition } from "../../core/index.js";
import SurveyQuestionField from "../components/SurveyQuestionField.vue";
import { usePublicSurveysApi } from "../api.js";
import { useSurveysHost } from "../host.js";

const props = defineProps<{ token: string }>();
const { t } = useI18n();
const api = usePublicSurveysApi();
const { renderMarkdown } = useSurveysHost();
const definition = ref<SurveyDefinition | null>(null);
const loading = ref(true), busy = ref(false), error = ref(false), consent = ref(false), started = ref(false), finished = ref(false);
const answers = ref<SurveyAnswers>({});
const notes = ref<Record<string, string>>({});
const pageIndex = ref(0);
const invalidTitle = ref("");
const submissionToken = ref("");
const path = computed(() => definition.value ? evaluateSurveyPath(definition.value, answers.value) : { pageIds: [], questionIds: [] });
const pages = computed(() => definition.value?.pages.filter((page) => path.value.pageIds.includes(page.id)) ?? []);
const page = computed(() => pages.value[Math.min(pageIndex.value, pages.value.length - 1)]);
const questions = computed(() => page.value?.questionIds.flatMap((id) => {
  const question = definition.value?.questions.find((item) => item.id === id);
  return question && path.value.questionIds.includes(id) ? [question] : [];
}) ?? []);
const assetUrls = ref<Record<string, string>>({});
const assetError = ref(false);
const pendingAssets = new Set<string>();
let disposed = false;
const visibleAssetIds = computed(() => new Set(questions.value.flatMap((question) =>
  question.type === "image_single" || question.type === "image_multiple"
    ? question.options.flatMap((option) => option.imageFileId ? [option.imageFileId] : []) : [],
)));
const imagesReady = computed(() => [...visibleAssetIds.value].every((id) => !!assetUrls.value[id]));
const displayQuestions = computed(() => questions.value.map((question) => {
  if (question.type !== "image_single" && question.type !== "image_multiple") return question;
  return { ...question, options: question.options.map((option) => ({
    ...option,
    ...(option.imageFileId && assetUrls.value[option.imageFileId] ? { imageUrl: assetUrls.value[option.imageFileId] } : {}),
  })) };
}));
async function loadVisibleAssets() {
  assetError.value = false;
  for (const id of visibleAssetIds.value) {
    if (assetUrls.value[id] || pendingAssets.has(id)) continue;
    pendingAssets.add(id);
    try {
      const blob = await api.readPretestAsset(props.token, id);
      if (!disposed) assetUrls.value = { ...assetUrls.value, [id]: URL.createObjectURL(blob) };
    } catch {
      if (!disposed) assetError.value = true;
    } finally {
      pendingAssets.delete(id);
    }
  }
}
watch(questions, () => { if (started.value) void loadVisibleAssets(); });
watch(started, (value) => { if (value) void loadVisibleAssets(); });

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function load() {
  loading.value = true;
  error.value = false;
  try {
    definition.value = (await api.readPretest(props.token)).definition;
    submissionToken.value = newToken();
  } catch {
    definition.value = null;
  } finally {
    loading.value = false;
  }
}
function updateAnswer(id: string, value: SurveyAnswers[string] | undefined) {
  const next = { ...answers.value };
  if (value === undefined) delete next[id]; else next[id] = value;
  answers.value = definition.value ? pruneSurveyAnswers(definition.value, next) : next;
  invalidTitle.value = "";
}
function validateCurrent(all: boolean): boolean {
  if (!definition.value) return false;
  const ids = all ? path.value.questionIds : questions.value.map((question) => question.id);
  const issue = validateSurveyAnswers(definition.value, answers.value).find((entry) => ids.some((id) => entry.path === id || entry.path.startsWith(`${id}.`)));
  if (!issue) return true;
  const id = issue.path.split(".")[0];
  invalidTitle.value = definition.value.questions.find((question) => question.id === id)?.title ?? "";
  const index = pages.value.findIndex((candidate) => candidate.questionIds.includes(id ?? ""));
  if (index >= 0) pageIndex.value = index;
  return false;
}
function next() {
  if (validateCurrent(false)) pageIndex.value += 1;
}
async function submit() {
  if (!definition.value || !validateCurrent(true)) return;
  busy.value = true;
  error.value = false;
  try {
    const visible = new Set(path.value.questionIds);
    const feedback = Object.entries(notes.value).flatMap(([questionId, note]) =>
      visible.has(questionId) && note.trim() ? [{ questionId, note: note.trim(), aspect: "general" as const }] : [],
    );
    await api.submitPretest(props.token, submissionToken.value, answers.value, feedback);
    answers.value = {};
    notes.value = {};
    finished.value = true;
  } catch {
    error.value = true;
  } finally {
    busy.value = false;
  }
}
let referrerMeta: HTMLMetaElement | null = null;
let previousReferrer: string | null = null;
onMounted(() => {
  referrerMeta = document.querySelector('meta[name="referrer"]');
  if (!referrerMeta) {
    referrerMeta = document.createElement("meta");
    referrerMeta.name = "referrer";
    document.head.append(referrerMeta);
  }
  previousReferrer = referrerMeta.getAttribute("content");
  referrerMeta.setAttribute("content", "no-referrer");
  void load();
});
onBeforeUnmount(() => {
  disposed = true;
  for (const url of Object.values(assetUrls.value)) URL.revokeObjectURL(url);
  if (previousReferrer === null) referrerMeta?.remove();
  else referrerMeta?.setAttribute("content", previousReferrer);
});
</script>

<template>
  <main class="pretest-page tw:bg-canvas">
    <div class="pretest-paper tw:bg-surface tw:text-default">
      <p class="tw:text-muted">MangoWrite · {{ t("surveys.pretestPublic.title") }}</p>
      <AsyncSlot :status="loading ? 'loading' : !definition ? 'error' : 'ready'" skeleton="text"
        error-title="surveys.pretestPublic.unavailable" error-hint="surveys.pretestPublic.unavailableHint" @retry="load">
        <template v-if="definition">
          <div class="pretest-content">
          <h1>{{ definition.title }}</h1>
          <template v-if="finished">
            <Message severity="success" :closable="false">{{ t("surveys.pretestPublic.received") }}</Message>
          </template>
          <template v-else-if="!started">
            <div v-if="definition.description" class="mw-md" v-html="renderMarkdown(definition.description)" />
            <div v-if="definition.consent" class="mw-md" v-html="renderMarkdown(definition.consent)" />
            <p>{{ t("surveys.pretestPublic.notice") }}</p>
            <label class="pretest-consent"><Checkbox v-model="consent" binary /><span>{{ t("surveys.pretestPublic.consent") }}</span></label>
            <Button :label="t('surveys.start')" :disabled="!consent" @click="started = true" />
          </template>
          <template v-else>
            <p class="tw:text-muted">{{ t("surveys.pageProgress", { current: pageIndex + 1, total: pages.length }) }}</p>
            <h2 v-if="page?.title">{{ page.title }}</h2>
            <Message v-if="assetError" severity="warn" :closable="false">
              {{ t("surveys.pretestPublic.imageLoadFailed") }}
              <Button :label="t('surveys.pretestPublic.retryImages')" text @click="loadVisibleAssets" />
            </Message>
            <p v-else-if="!imagesReady">{{ t("surveys.pretestPublic.imagesLoading") }}</p>
            <div v-for="question in displayQuestions" :key="question.id" class="pretest-question">
              <SurveyQuestionField :question="question" :model-value="answers[question.id]" :disabled="busy || !imagesReady" @update:model-value="updateAnswer(question.id, $event)" />
              <details v-if="question.type !== 'statement'">
                <summary>{{ t("surveys.pretestPublic.feedback") }}</summary>
                <Textarea v-model="notes[question.id]" :aria-label="t('surveys.pretestPublic.feedbackFor', { title: question.title })" :maxlength="1000" rows="2" fluid />
              </details>
            </div>
            <Message v-if="invalidTitle" severity="warn" :closable="false">{{ t("surveys.pretestPublic.checkAnswer", { title: invalidTitle }) }}</Message>
            <Message v-if="error" severity="error" :closable="false">{{ t("surveys.submitFailed") }}</Message>
            <div class="pretest-actions">
              <Button v-if="pageIndex > 0" :label="t('surveys.previous')" severity="secondary" :disabled="busy" @click="pageIndex--; invalidTitle = ''" />
              <Button v-if="pageIndex < pages.length - 1" :label="t('surveys.next')" :disabled="!imagesReady" @click="next" />
              <Button v-else :label="t('surveys.submit')" :disabled="!imagesReady" :loading="busy" @click="submit" />
            </div>
          </template>
          </div>
        </template>
      </AsyncSlot>
    </div>
  </main>
</template>

<style scoped>
.pretest-page { min-height: 100dvh; padding: var(--layout-card-padding-lg); display: flex; justify-content: center; align-items: flex-start; }
.pretest-paper { width: 100%; max-width: 44rem; padding: var(--layout-card-padding-lg); border: 1px solid var(--border); border-radius: var(--radius-lg); display: grid; gap: var(--layout-card-padding); align-content: start; }
.pretest-content { display: grid; gap: var(--layout-card-padding); }
.pretest-content h1 { font-size: var(--font-size-title-md); font-weight: 600; }
.pretest-content h2 { font-size: var(--font-size-title-sm); font-weight: 600; }
.pretest-consent { display: flex; gap: var(--space-2); align-items: center; }
.pretest-question { display: grid; gap: var(--space-2); }
.pretest-question details { color: var(--color-text-muted); }
.pretest-question summary { cursor: pointer; padding-block: var(--space-2); }
.pretest-actions { display: flex; justify-content: space-between; gap: var(--space-2); }
</style>
