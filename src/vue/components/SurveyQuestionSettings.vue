<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import DatePicker from "primevue/datepicker";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";

import type { SurveyCondition, SurveyQuestion } from "../../contracts/index.js";

const props = defineProps<{
  visible: boolean;
  question: SurveyQuestion;
  number: number;
  conditionSources: SurveyQuestion[];
  hasAnswerRules: boolean;
}>();
const emit = defineEmits<{
  "update:visible": [value: boolean];
  change: [next: SurveyQuestion, label?: string];
}>();
const { t } = useI18n();

const conditionSource = computed(() =>
  props.conditionSources.find((question) => question.id === props.question.showIf?.questionId),
);
const conditionOptions = computed(() =>
  conditionSource.value &&
  (conditionSource.value.type === "single" ||
    conditionSource.value.type === "image_single" ||
    conditionSource.value.type === "multiple" ||
    conditionSource.value.type === "image_multiple" ||
    conditionSource.value.type === "dropdown")
    ? conditionSource.value.options
    : [],
);

function setShowIf(questionId: string | null) {
  if (!questionId) {
    if (!props.question.showIf) return;
    const next = { ...props.question };
    delete next.showIf;
    emit("change", next);
    return;
  }
  const source = props.conditionSources.find((question) => question.id === questionId);
  if (!source) return;
  const value: string | number =
    source.type === "single" ||
    source.type === "image_single" ||
    source.type === "multiple" ||
    source.type === "image_multiple" ||
    source.type === "dropdown"
      ? (source.options[0]?.id ?? "")
      : source.type === "scale"
        ? source.min
        : source.type === "rating"
          ? 1
          : 0;
  const showIf: SurveyCondition = {
    questionId,
    op: source.type === "multiple" || source.type === "image_multiple" ? "contains" : "eq",
    value,
  };
  emit("change", { ...props.question, showIf });
}
function setConditionValue(value: string | number | null) {
  if (!props.question.showIf || value === null) return;
  emit("change", {
    ...props.question,
    showIf: { ...props.question.showIf, value },
  });
}
function setMultiline(multiline: boolean) {
  if (props.question.type !== "text") return;
  emit("change", { ...props.question, multiline });
}
function setMaxLength(value: number | null) {
  if (props.question.type !== "text") return;
  const next = { ...props.question };
  if (value === null) delete next.maxLength;
  else next.maxLength = value;
  emit("change", next);
}
function setNumberBound(bound: "min" | "max", value: number | null) {
  if (props.question.type !== "number" || value === null) return;
  emit("change", { ...props.question, [bound]: value });
}
function setScaleBound(bound: "min" | "max", value: number | null) {
  if (props.question.type !== "scale" || value === null) return;
  emit("change", { ...props.question, [bound]: value });
}
function setScaleLabel(bound: "minLabel" | "maxLabel", value: string | undefined) {
  if (props.question.type !== "scale") return;
  emit("change", { ...props.question, [bound]: value ?? "" }, `q:${props.question.id}:${bound}`);
}
function setRatingMax(value: number | null) {
  if (props.question.type !== "rating" || value === null) return;
  emit("change", { ...props.question, max: value });
}
function setNpsLabel(bound: "minLabel" | "maxLabel", value: string | undefined) {
  if (props.question.type !== "nps") return;
  emit("change", { ...props.question, [bound]: value ?? "" }, `q:${props.question.id}:${bound}`);
}
function setDateBound(bound: "min" | "max", value: unknown) {
  if (props.question.type !== "date") return;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    const next = { ...props.question };
    delete next[bound];
    emit("change", next);
    return;
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  emit("change", { ...props.question, [bound]: date });
}
function dateBoundary(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="t('surveys.questionSettings')"
    class="survey-question-settings"
    :style="{ width: '42rem' }"
    @update:visible="emit('update:visible', $event)"
    @click.stop
  >
    <div class="settings-context">
      {{ t("surveys.questionSettingsContext", { n: number, type: t(`surveys.type.${question.type}`) }) }}
    </div>
    <div class="settings-body">
      <section v-if="conditionSources.length" class="settings-group">
        <h3>{{ t("surveys.displayRules") }}</h3>
        <div class="settings-grid">
          <label class="settings-field">
            <span>{{ t("surveys.conditionQuestion") }}</span>
            <Select
              :model-value="question.showIf?.questionId ?? null"
              :options="conditionSources"
              option-label="title"
              option-value="id"
              :placeholder="t('surveys.alwaysShow')"
              show-clear
              fluid
              :aria-label="t('surveys.showCondition')"
              @update:model-value="setShowIf"
            />
          </label>
          <label v-if="question.showIf" class="settings-field">
            <span>{{ t("surveys.conditionValue") }}</span>
            <Select
              v-if="conditionOptions.length"
              :model-value="String(question.showIf.value)"
              :options="conditionOptions"
              option-label="label"
              option-value="id"
              fluid
              :aria-label="t('surveys.conditionValue')"
              @update:model-value="setConditionValue($event as string)"
            />
            <InputNumber
              v-else
              :model-value="Number(question.showIf.value)"
              fluid
              :aria-label="t('surveys.conditionValue')"
              @update:model-value="setConditionValue"
            />
          </label>
        </div>
      </section>

      <section v-if="hasAnswerRules" class="settings-group">
        <h3>{{ t("surveys.answerRules") }}</h3>
        <div class="settings-grid">
          <template v-if="question.type === 'text'">
            <label class="settings-field settings-field--check">
              <Checkbox
                binary
                :model-value="!!question.multiline"
                @update:model-value="setMultiline"
              />
              <span>{{ t("surveys.multiline") }}</span>
            </label>
            <label class="settings-field">
              <span>{{ t("surveys.maxLength") }}</span>
              <InputNumber
                :model-value="question.maxLength ?? null"
                :min="1"
                :max="2000"
                :use-grouping="false"
                show-clear
                fluid
                :aria-label="t('surveys.maxLength')"
                @update:model-value="setMaxLength"
              />
            </label>
          </template>
          <template v-else-if="question.type === 'number' || question.type === 'scale'">
            <label class="settings-field">
              <span>{{ t("surveys.minimum") }}</span>
              <InputNumber
                :model-value="question.min ?? null"
                :use-grouping="false"
                fluid
                :aria-label="t('surveys.minimum')"
                @update:model-value="question.type === 'number' ? setNumberBound('min', $event) : setScaleBound('min', $event)"
              />
            </label>
            <label class="settings-field">
              <span>{{ t("surveys.maximum") }}</span>
              <InputNumber
                :model-value="question.max ?? null"
                :use-grouping="false"
                fluid
                :aria-label="t('surveys.maximum')"
                @update:model-value="question.type === 'number' ? setNumberBound('max', $event) : setScaleBound('max', $event)"
              />
            </label>
          </template>
          <template v-else-if="question.type === 'rating'">
            <label class="settings-field">
              <span>{{ t("surveys.ratingMax") }}</span>
              <InputNumber
                :model-value="question.max"
                :min="3"
                :max="10"
                :use-grouping="false"
                fluid
                :aria-label="t('surveys.ratingMax')"
                @update:model-value="setRatingMax"
              />
            </label>
          </template>
          <template v-else-if="question.type === 'date'">
            <label class="settings-field">
              <span>{{ t("surveys.dateMin") }}</span>
              <DatePicker
                :model-value="dateBoundary(question.min)"
                :max-date="dateBoundary(question.max)"
                date-format="yy-mm-dd"
                show-icon
                fluid
                :aria-label="t('surveys.dateMin')"
                @update:model-value="setDateBound('min', $event)"
              />
            </label>
            <label class="settings-field">
              <span>{{ t("surveys.dateMax") }}</span>
              <DatePicker
                :model-value="dateBoundary(question.max)"
                :min-date="dateBoundary(question.min)"
                date-format="yy-mm-dd"
                show-icon
                fluid
                :aria-label="t('surveys.dateMax')"
                @update:model-value="setDateBound('max', $event)"
              />
            </label>
          </template>
        </div>
        <div v-if="question.type === 'scale' || question.type === 'nps'" class="settings-grid">
          <label class="settings-field">
            <span>{{ t(question.type === 'scale' ? 'surveys.scaleMinLabel' : 'surveys.npsMinLabel') }}</span>
            <InputText
              :model-value="question.minLabel ?? ''"
              maxlength="200"
              fluid
              :placeholder="t(question.type === 'scale' ? 'surveys.scaleMinLabelPlaceholder' : 'surveys.npsMinLabelPlaceholder')"
              :aria-label="t(question.type === 'scale' ? 'surveys.scaleMinLabel' : 'surveys.npsMinLabel')"
              @update:model-value="question.type === 'scale' ? setScaleLabel('minLabel', $event) : setNpsLabel('minLabel', $event)"
            />
          </label>
          <label class="settings-field">
            <span>{{ t(question.type === 'scale' ? 'surveys.scaleMaxLabel' : 'surveys.npsMaxLabel') }}</span>
            <InputText
              :model-value="question.maxLabel ?? ''"
              maxlength="200"
              fluid
              :placeholder="t(question.type === 'scale' ? 'surveys.scaleMaxLabelPlaceholder' : 'surveys.npsMaxLabelPlaceholder')"
              :aria-label="t(question.type === 'scale' ? 'surveys.scaleMaxLabel' : 'surveys.npsMaxLabel')"
              @update:model-value="question.type === 'scale' ? setScaleLabel('maxLabel', $event) : setNpsLabel('maxLabel', $event)"
            />
          </label>
        </div>
      </section>
    </div>
    <template #footer>
      <Button :label="t('surveys.done')" @click="emit('update:visible', false)" />
    </template>
  </Dialog>
</template>

<style scoped>
.settings-context {
  margin-bottom: 20px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
}
.settings-body,
.settings-group {
  display: grid;
  gap: 20px;
}
.settings-group h3 {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
  font-weight: 600;
}
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.settings-field {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
}
.settings-field > span:first-child {
  font-weight: 500;
}
.settings-field--check {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding-top: 24px;
}
@media (max-width: 767.98px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
  .settings-field--check {
    padding-top: 0;
  }
}
</style>
