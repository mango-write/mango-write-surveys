<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import InputNumber from "primevue/inputnumber";
import Message from "primevue/message";
import Tag from "primevue/tag";
import type {
  SurveyDefinition,
  SurveyQuestion,
  SurveyResearchDesign,
  SurveyReviewPlan,
  SurveyReviewPlanGroup,
} from "../../core/index.js";
import type { SurveyReviewFinding, ToolSurveyDelivery } from "../../contracts/index.js";
import { SOURCES, STANDARDS_CHECKS } from "../../standards/index.js";

type Review = Extract<ToolSurveyDelivery, { type: "survey_review" }>;
const props = defineProps<{
  design?: SurveyResearchDesign;
  definition?: SurveyDefinition;
  report: Review | null;
  plan: SurveyReviewPlan | null;
  stale: boolean;
  busy: boolean;
  disabled: boolean;
  hasCopilot: boolean;
  questions?: Pick<SurveyQuestion, "id" | "title">[];
}>();
const emit = defineEmits<{
  "update:design": [design: SurveyResearchDesign];
  review: [];
  "design-request": [];
  apply: [];
  locate: [id: string];
  preview: [];
}>();
const { t } = useI18n();
const trialNotes = ref("");
const trialCount = ref<number | null>(null);
watch(() => props.design?.pretest, (value) => {
  trialNotes.value = value?.notes ?? "";
  trialCount.value = value?.participantCount ?? null;
}, { immediate: true });
function recordTrial() {
  if (!props.design || props.disabled || !trialNotes.value.trim() || !trialCount.value) return;
  emit("update:design", { ...props.design, pretest: {
    notes: trialNotes.value.trim(), participantCount: trialCount.value, recordedAt: new Date().toISOString(),
  } });
}
const checks = new Map(STANDARDS_CHECKS.map((check) => [check.id, check]));
const findings = computed(() => props.report?.findings ?? []);
const findingById = computed(() => new Map(findings.value.map((finding) => [finding.id, finding])));
const deferredFindings = computed(() => props.plan?.deferred.flatMap((item) => {
  const finding = findingById.value.get(item.findingId);
  return finding ? [finding] : [];
}) ?? []);
function update(field: "researchQuestion" | "population" | "recruitment" | "analysisPlan", value: string) {
  if (props.design && !props.disabled) emit("update:design", { ...props.design, [field]: value });
}
function sources(checkId?: string) {
  return (checkId ? checks.get(checkId) : undefined)?.citations.map((citation) => SOURCES[citation.source]) ?? [];
}
function questionLabel(id: string) {
  const current = props.questions ?? [];
  const candidate = props.plan?.candidateDefinition?.questions ?? [];
  const index = current.findIndex((question) => question.id === id);
  const candidateIndex = candidate.findIndex((question) => question.id === id);
  const resolved = index >= 0 ? index : candidateIndex;
  return resolved < 0 ? t("surveys.assistant.unmapped") : t("surveys.assistant.questionIndex", { n: resolved + 1 });
}
function groupFindings(group: SurveyReviewPlanGroup): SurveyReviewFinding[] {
  return group.findingIds.flatMap((id) => {
    const finding = findingById.value.get(id);
    return finding ? [finding] : [];
  });
}
function groupQuestionIds(group: SurveyReviewPlanGroup) {
  return [...new Set(groupFindings(group).flatMap((finding) => finding.questionId ? [finding.questionId] : []))];
}
function conditionValue(questionId: string, value: unknown) {
  const source = props.definition?.questions.find((question) => question.id === questionId);
  const options = source && "options" in source ? source.options : undefined;
  const option = options?.find((item) => item.id === String(value));
  return formatValue(option?.label ?? value);
}
function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return t("surveys.assistant.unchangedValue");
  if (typeof value === "boolean") return t(value ? "surveys.assistant.yes" : "surveys.assistant.no");
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join("、");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.label === "string") return record.label;
    if (typeof record.questionId === "string") {
      return t("surveys.assistant.conditionSummary", {
        question: questionLabel(record.questionId), value: conditionValue(record.questionId, record.value),
      });
    }
    return JSON.stringify(value);
  }
  return String(value);
}
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])];
  return keys.every((key) => sameValue(leftRecord[key], rightRecord[key]));
}
const fieldLabelKeys: Record<string, string> = {
  title: "surveys.questionTitle",
  type: "surveys.questionType",
  required: "surveys.required",
  options: "surveys.assistant.options",
  showIf: "surveys.showCondition",
  min: "surveys.minimum",
  max: "surveys.maximum",
  minLabel: "surveys.scaleMinLabel",
  maxLabel: "surveys.scaleMaxLabel",
  rows: "surveys.matrixRows",
  columns: "surveys.matrixColumns",
};
interface ReviewChangeRow {
  key: string;
  questionId?: string;
  field: string;
  before: string;
  after: string;
}
const designFieldLabelKeys: Record<string, string> = {
  researchQuestion: "surveys.assistant.question",
  population: "surveys.assistant.population",
  recruitment: "surveys.assistant.recruitment",
  analysisPlan: "surveys.assistant.analysis",
  assumptions: "surveys.assistant.assumptions",
  pendingDecisions: "surveys.assistant.pending",
};
function changeRows(group: SurveyReviewPlanGroup): ReviewChangeRow[] {
  const candidate = props.plan?.candidateDefinition;
  if (!props.definition || !candidate) return [];
  const original = props.definition;
  const ids = new Set<string>(groupQuestionIds(group));
  for (const op of group.ops) {
    if ("questionId" in op) ids.add(op.questionId);
    if (op.op === "add_question" && typeof op.question.id === "string") ids.add(op.question.id);
  }
  const questionRows: ReviewChangeRow[] = [...ids].flatMap((id) => {
    const before = original.questions.find((question) => question.id === id) as Record<string, unknown> | undefined;
    const after = candidate.questions.find((question) => question.id === id) as Record<string, unknown> | undefined;
    if (!before || !after) {
      const question = before ?? after;
      return [{ key: id, questionId: id, field: t("surveys.questionTitle"),
        before: before ? formatValue(question?.title) : t("surveys.assistant.unchangedValue"),
        after: after ? formatValue(question?.title) : t("surveys.assistant.unchangedValue") }];
    }
    const rows: ReviewChangeRow[] = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((field) => field !== "id" && !sameValue(before[field], after[field]))
      .map((field) => ({
        key: `${id}:${field}`, questionId: id,
        field: fieldLabelKeys[field] ? t(fieldLabelKeys[field]) : field,
        before: formatValue(before[field]), after: formatValue(after[field]),
      }));
    const beforeIndex = original.questions.findIndex((question) => question.id === id);
    const afterIndex = candidate.questions.findIndex((question) => question.id === id);
    if (beforeIndex !== afterIndex) rows.push({
      key: `${id}:position`, questionId: id, field: t("surveys.assistant.position"),
      before: String(beforeIndex + 1), after: String(afterIndex + 1),
    });
    return rows;
  });
  const metaRows: ReviewChangeRow[] = group.ops.flatMap((op) => {
    if (op.op !== "set_meta") return [];
    const rows: ReviewChangeRow[] = [];
    for (const [field, labelKey] of [["title", "surveys.title"], ["description", "surveys.description"], ["consent", "surveys.consent"]] as const) {
      if (op[field] !== undefined && !sameValue(original[field], candidate[field])) rows.push({
        key: `meta:${field}`, field: t(labelKey), before: formatValue(original[field]), after: formatValue(candidate[field]),
      });
    }
    if (op.researchDesign !== undefined) {
      const before = (original.researchDesign ?? {}) as Record<string, unknown>;
      const after = (candidate.researchDesign ?? {}) as Record<string, unknown>;
      const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((field) => !sameValue(before[field], after[field]));
      rows.push(...fields.map((field) => ({
        key: `meta:researchDesign.${field}`,
        field: designFieldLabelKeys[field] ? t(designFieldLabelKeys[field]) : t("surveys.assistant.design"),
        before: formatValue(before[field]), after: formatValue(after[field]),
      })));
    }
    return rows;
  });
  return [...questionRows, ...metaRows];
}
</script>

<template>
  <section class="research-assistant" :aria-label="t('surveys.assistant.title')">
    <header class="assistant-header">
      <div>
        <h2>{{ t("surveys.assistant.title") }}</h2>
        <p>{{ t("surveys.assistant.subtitle") }}</p>
      </div>
      <Button
        v-if="hasCopilot"
        :label="t('surveys.assistant.review')"
        icon="pi pi-sparkles"
        
        :loading="busy"
        :disabled="disabled || busy"
        @click="emit('review')"
      />
    </header>
    <details :open="!design">
      <summary>{{ t("surveys.assistant.design") }}</summary>
      <template v-if="design">
        <div class="design-fields">
          <label>
            {{ t("surveys.assistant.question") }}
            <Textarea :model-value="design.researchQuestion" :disabled="disabled" rows="2" auto-resize
              @change="update('researchQuestion', ($event.target as HTMLTextAreaElement).value)" />
          </label>
          <label>
            {{ t("surveys.assistant.population") }}
            <InputText :model-value="design.population" :disabled="disabled"
              @change="update('population', ($event.target as HTMLInputElement).value)" />
          </label>
          <label>
            {{ t("surveys.assistant.recruitment") }}
            <InputText :model-value="design.recruitment" :disabled="disabled"
              @change="update('recruitment', ($event.target as HTMLInputElement).value)" />
          </label>
          <label>
            {{ t("surveys.assistant.analysis") }}
            <Textarea :model-value="design.analysisPlan" :disabled="disabled" rows="2" auto-resize
              @change="update('analysisPlan', ($event.target as HTMLTextAreaElement).value)" />
          </label>
        </div>
        <div v-if="design.constructs.length" class="constructs">
          <div v-for="construct in design.constructs" :key="construct.id">
            <strong>{{ construct.label }}</strong>
            <span>{{ construct.definition }}</span>
            <div class="question-links">
              <Button v-for="id in construct.questionIds" :key="id" :label="questionLabel(id)" text
                :disabled="!questions?.some((question) => question.id === id)"
                @click="emit('locate', id)" />
            </div>
          </div>
        </div>
        <p v-if="design.assumptions.length" class="assistant-note">
          {{ t("surveys.assistant.assumptions") }} {{ design.assumptions.join('；') }}
        </p>
        <Message v-if="design.pendingDecisions.length" severity="warn" :closable="false">
          {{ t("surveys.assistant.pending") }} {{ design.pendingDecisions.join('；') }}
        </Message>
      </template>
      <div v-else class="design-empty">
        <p>{{ t("surveys.assistant.designEmpty") }}</p>
        <Button v-if="hasCopilot" :label="t('surveys.assistant.addDesign')" severity="secondary" 
          :disabled="disabled || busy" @click="emit('design-request')" />
      </div>
    </details>
    <details class="trial-record">
      <summary>{{ t("surveys.assistant.trialTitle") }}</summary>
      <p class="assistant-note">{{ t("surveys.assistant.trialHint") }}</p>
      <Button :label="t('surveys.preview')"  severity="secondary" @click="emit('preview')" />
      <template v-if="design">
        <label class="trial-field">
          {{ t("surveys.assistant.trialCount") }}
          <InputNumber v-model="trialCount" :min="1" :max="10000" :disabled="disabled" show-buttons />
        </label>
        <label class="trial-field">
          {{ t("surveys.assistant.trialNotes") }}
          <Textarea v-model="trialNotes" :maxlength="2000" rows="3" auto-resize :disabled="disabled" />
        </label>
        <Button :label="t('surveys.assistant.recordTrial')"  severity="secondary"
          :disabled="disabled || !trialCount || !trialNotes.trim()" @click="recordTrial" />
        <p v-if="design.pretest" class="assistant-note">{{ t("surveys.assistant.trialRecorded") }}</p>
      </template>
    </details>
    <div v-if="report && plan" class="review-results" aria-live="polite">
      <div v-if="plan.groups.length" class="review-summary">
        <strong>{{ t("surveys.assistant.planSummary", { n: plan.groups.length }) }}</strong>
        <span class="assistant-note">{{ report.summary }}</span>
      </div>
      <Message v-if="stale" severity="warn" :closable="false">{{ t("surveys.assistant.stale") }}</Message>
      <Message v-if="plan.status === 'blocked'" severity="warn" :closable="false">
        {{ t("surveys.assistant.planUnavailable") }}
      </Message>
      <p v-if="plan.status === 'empty'">{{ t("surveys.assistant.noFindings") }}</p>
      <p v-if="plan.status === 'manual-only'">{{ t("surveys.assistant.noAutoFix") }}</p>
      <Button v-if="plan.status === 'ready'" class="apply-plan" :label="t('surveys.assistant.applyPlan', { n: plan.groups.length })"
        icon="pi pi-check" :disabled="disabled || stale || busy" @click="emit('apply')" />
      <article v-for="group in plan.groups" :key="group.id" class="finding">
        <div class="finding-title">
          <Tag :value="t(`surveys.assistant.severity.${group.severity}`)"
            :severity="group.severity === 'minor' ? 'info' : 'warn'" />
          <strong>{{ group.title }}</strong>
        </div>
        <div class="question-links">
          <Button v-for="id in groupQuestionIds(group)" :key="id" :label="questionLabel(id)" text
            @click="emit('locate', id)" />
        </div>
        <div v-for="finding in groupFindings(group)" :key="finding.id" class="finding-explanation">
          <p>{{ finding.reason }}</p>
          <p>{{ finding.recommendation }}</p>
          <p v-if="!finding.checkId" class="assistant-note">{{ t("surveys.assistant.uncatalogued") }}</p>
        </div>
        <details v-if="plan.status === 'ready'" class="change-preview">
          <summary>{{ t("surveys.assistant.previewChanges") }}</summary>
          <div class="change-head">
            <span />
            <strong>{{ t("surveys.assistant.before") }}</strong>
            <strong>{{ t("surveys.assistant.after") }}</strong>
          </div>
          <div v-for="row in changeRows(group)" :key="row.key" class="change-row">
            <button v-if="row.questionId" type="button" class="change-location" @click="emit('locate', row.questionId)">
              {{ questionLabel(row.questionId) }} · {{ row.field }}
            </button>
            <strong v-else>{{ row.field }}</strong>
            <p><strong class="change-mobile-label">{{ t("surveys.assistant.before") }}：</strong>{{ row.before }}</p>
            <p><strong class="change-mobile-label">{{ t("surveys.assistant.after") }}：</strong>{{ row.after }}</p>
          </div>
          <div class="finding-actions">
            <template v-for="finding in groupFindings(group)" :key="finding.id">
              <a v-for="source in sources(finding.checkId)" :key="source.url" :href="source.url"
                target="_blank" rel="noopener noreferrer">{{ source.label }}</a>
            </template>
          </div>
        </details>
      </article>
      <details v-if="plan.manual.length" class="manual-findings" :open="plan.status === 'manual-only'">
        <summary>{{ t("surveys.assistant.manualTitle") }}</summary>
        <article v-for="item in plan.manual" :key="item.findingId" class="finding">
          <div class="finding-title">
            <Tag :value="t(`surveys.assistant.severity.${item.severity}`)"
              :severity="item.severity === 'minor' ? 'info' : 'warn'" />
            <strong>{{ item.title }}</strong>
          </div>
          <p>{{ item.reason }}</p>
          <p>{{ item.recommendation }}</p>
          <p v-if="!item.checkId" class="assistant-note">{{ t("surveys.assistant.uncatalogued") }}</p>
          <div class="finding-actions">
            <Button v-if="findingById.get(item.findingId)?.questionId" :label="t('surveys.assistant.locate')" text
              @click="emit('locate', findingById.get(item.findingId)!.questionId!)" />
            <a v-for="source in sources(item.checkId)" :key="source.url" :href="source.url"
              target="_blank" rel="noopener noreferrer">{{ source.label }}</a>
          </div>
        </article>
      </details>
      <details v-if="deferredFindings.length" class="manual-findings">
        <summary>{{ t("surveys.assistant.remainingTitle") }}</summary>
        <article v-for="finding in deferredFindings" :key="finding.id" class="finding">
          <strong>{{ finding.title }}</strong>
          <p>{{ finding.reason }}</p>
          <p>{{ finding.recommendation }}</p>
        </article>
      </details>
      <p class="assistant-note">{{ t("surveys.assistant.evidenceNote") }}</p>
    </div>
  </section>
</template>

<style scoped>
.research-assistant { flex: none; width: 100%; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg, 12px); padding: 1rem; margin-bottom: 1rem; background: var(--color-surface-base); }
.assistant-header, .finding-title, .finding-actions { display: flex; gap: .65rem; align-items: center; flex-wrap: wrap; }
.assistant-header { justify-content: space-between; margin-bottom: .8rem; }
h2 { font-size: 1rem; margin: 0; }
p { margin: .4rem 0; line-height: 1.6; }
.assistant-header p, .assistant-note, .finding-actions a { color: var(--color-text-tertiary); font-size: .8rem; }
summary { cursor: pointer; font-weight: 600; padding: .35rem 0; }
.design-fields { display: grid; grid-template-columns: 1fr 1fr; gap: .7rem; margin: .7rem 0; }
.design-fields label { display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; }
.design-fields label:first-child, .design-fields label:last-child { grid-column: 1 / -1; }
.constructs > div { padding: .5rem 0; border-top: 1px solid var(--color-border-subtle); }
.constructs span { margin-left: .5rem; font-size: .85rem; }
.question-links { display: inline-flex; flex-wrap: wrap; }
.review-results { border-top: 1px solid var(--color-border-subtle); margin-top: .8rem; padding-top: .8rem; }
.review-summary { display: grid; gap: .35rem; margin-bottom: .6rem; }
.finding { padding: .8rem 0; border-bottom: 1px solid var(--color-border-subtle); }
.finding p { font-size: .875rem; }
.finding-actions a { text-decoration: underline; }
.finding-explanation + .finding-explanation { border-top: 1px dashed var(--color-border-subtle); }
.change-preview { margin-top: .55rem; }
.change-head, .change-row { display: grid; grid-template-columns: minmax(7rem, .8fr) 1fr 1fr; gap: .65rem; padding: .45rem 0; }
.change-head { color: var(--color-text-tertiary); font-size: .8rem; }
.change-row { border-top: 1px solid var(--color-border-subtle); }
.change-row p { overflow-wrap: anywhere; }
.change-mobile-label { display: none; color: var(--color-text-tertiary); font-weight: 400; }
.change-location { border: 0; padding: 0; background: transparent; color: var(--color-brand-600); text-align: left; cursor: pointer; }
.apply-plan { width: 100%; margin-top: .8rem; }
.manual-findings { margin-top: .7rem; }
.trial-record { border-top: 1px solid var(--color-border-subtle); margin-top: .6rem; padding-top: .5rem; }
.trial-field { display: flex; flex-direction: column; gap: .3rem; margin: .6rem 0; font-size: .85rem; }
@media (max-width: 600px) {
  .design-fields { grid-template-columns: 1fr; }
  .change-head, .change-row { grid-template-columns: 1fr; gap: .2rem; }
  .change-head { display: none; }
  .change-mobile-label { display: inline; }
}
</style>
