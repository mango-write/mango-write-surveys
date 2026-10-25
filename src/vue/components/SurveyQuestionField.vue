<script setup lang="ts">
import { computed } from "vue";
import type { SurveyAnswers, SurveyOption, SurveyQuestion } from "../../contracts/index.js";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import InputNumber from "primevue/inputnumber";
import RadioButton from "primevue/radiobutton";
import Checkbox from "primevue/checkbox";
import Select from "primevue/select";
import { Image as ImageIcon, Star } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { useSurveysHost } from "../host.js";
const props = defineProps<{
  question: SurveyQuestion;
  modelValue?: SurveyAnswers[string];
  disabled?: boolean;
  /** 卡片预览用：题干由卡片自己画，这里只渲染控件。 */
  hideTitle?: boolean;
  /** 必答拦截的行/项级定位（矩阵行 id 或多项填空项 id）：对应行卡就地标红。 */
  invalidRow?: string;
  /** 草稿期选项图地址前缀（作者认证侧）：编辑器/预览用；公开页走 imageUrl。 */
  mediaUrlBase?: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: SurveyAnswers[string] | undefined];
}>();
const { t, locale } = useI18n();
const { renderMarkdown } = useSurveysHost();
const scales = computed(() =>
  props.question.type === "scale"
    ? Array.from(
        { length: props.question.max - props.question.min + 1 },
        (_, i) =>
          props.question.type === "scale" ? props.question.min + i : 0,
      )
    : [],
);
function numberInput(value: unknown) {
  emit(
    "update:modelValue",
    typeof value === "number" && Number.isFinite(value) ? value : undefined,
  );
}
function toggleOption(id: string, selected: boolean) {
  const question = props.question;
  if (question.type !== "multiple" && question.type !== "image_multiple") return;
  const option = question.options.find((o) => o.id === id);
  const old = Array.isArray(props.modelValue) ? props.modelValue : [];
  const next = selected
    ? option?.exclusive
      ? [id]
      : [
          ...old.filter(
            (v) => !question.options.find((o) => o.id === v)?.exclusive,
          ),
          id,
        ]
    : old.filter((v) => v !== id);
  emit("update:modelValue", next.length ? next : undefined);
}

// ── 图片单选/多选：选项带缩略图，点图选择；无图选项合法（图文混排）。────
function imageSrcOf(option: SurveyOption): string | undefined {
  if (option.imageUrl) return option.imageUrl;
  // 草稿期没有 imageUrl（那是公开投影的派生输出），经作者认证侧端点解析。
  if (option.imageFileId && props.mediaUrlBase)
    return `${props.mediaUrlBase}/${option.imageFileId}`;
  return undefined;
}
const imageQuestion = computed(() =>
  props.question.type === "image_single" || props.question.type === "image_multiple"
    ? props.question
    : null,
);
function imagePicked(option: SurveyOption): boolean {
  if (imageQuestion.value?.type === "image_single")
    return props.modelValue === option.id;
  return Array.isArray(props.modelValue) && props.modelValue.includes(option.id);
}

// ── 评分（星形）：隐藏 radio 保留原生键盘语义（方向键换档、Tab 进出）。──
const ratingValues = computed(() =>
  props.question.type === "rating"
    ? Array.from({ length: props.question.max }, (_, i) => i + 1)
    : [],
);
const ratingValue = computed(() =>
  typeof props.modelValue === "number" && props.question.type === "rating"
    ? props.modelValue
    : 0,
);

// ── NPS：0–10 一行 11 格，窄屏换两行；两端锚点文案。──────────────────────
const npsValues = computed(() =>
  props.question.type === "nps" ? Array.from({ length: 11 }, (_, i) => i) : [],
);
const npsValue = computed(() =>
  typeof props.modelValue === "number" && props.question.type === "nps"
    ? props.modelValue
    : -1,
);

// ── 排序：初始态不记答案也不显名次（显示顺序 ≠ 已排序），任何一次上移/下移
// 才形成全排列答案。──────────────────────────────────────────────────────
const rankingQuestion = computed(() =>
  props.question.type === "ranking" ? props.question : null,
);
const rankingOrder = computed<string[]>(() => {
  const question = rankingQuestion.value;
  if (!question) return [];
  const ids = question.options.map((o) => o.id);
  if (!Array.isArray(props.modelValue)) return ids;
  const known = props.modelValue.filter((v) => ids.includes(v));
  return [...known, ...ids.filter((id) => !known.includes(id))];
});
const rankingActive = computed(() => Array.isArray(props.modelValue));
function rankingLabel(id: string): string {
  return rankingQuestion.value?.options.find((o) => o.id === id)?.label ?? id;
}
function moveRanking(index: number, delta: number) {
  if (!rankingQuestion.value) return;
  const next = [...rankingOrder.value];
  const to = index + delta;
  if (to < 0 || to >= next.length) return;
  next.splice(to, 0, ...next.splice(index, 1));
  emit("update:modelValue", next);
}

// ── 矩阵：答案 { rowId: columnId | columnId[] }。────────────────────────
const matrixQuestion = computed(() =>
  props.question.type === "matrix_single" ||
  props.question.type === "matrix_multiple"
    ? props.question
    : null,
);
const matrixAnswer = computed<Record<string, unknown>>(() =>
  props.modelValue &&
  typeof props.modelValue === "object" &&
  !Array.isArray(props.modelValue)
    ? (props.modelValue as Record<string, unknown>)
    : {},
);
function matrixCellPicked(rowId: string, columnId: string): boolean {
  const cell = matrixAnswer.value[rowId];
  if (matrixQuestion.value?.type === "matrix_single") return cell === columnId;
  return Array.isArray(cell) && cell.includes(columnId);
}
function pickMatrixCell(rowId: string, columnId: string, checked: boolean) {
  const question = matrixQuestion.value;
  if (!question) return;
  // 值域与 SurveyAnswerValue 的 record 分支一致：矩阵单选存列 id 字符串，
  // 矩阵多选存列 id 数组。
  const base: Record<string, string | string[]> = {
    ...(matrixAnswer.value as Record<string, string | string[]>),
  };
  if (question.type === "matrix_single") {
    base[rowId] = columnId;
  } else {
    const old = Array.isArray(base[rowId]) ? (base[rowId] as string[]) : [];
    const next = checked
      ? [...old, columnId]
      : old.filter((v) => v !== columnId);
    if (next.length) base[rowId] = next;
    else delete base[rowId];
  }
  emit("update:modelValue", Object.keys(base).length ? base : undefined);
}
// 桌面是「行标题 + N 列」的网格；窄屏每行折叠成一张小卡（列标签随选项显示）。
const matrixGridStyle = computed(() =>
  matrixQuestion.value
    ? {
        gridTemplateColumns: `minmax(6.5rem, 1.4fr) repeat(${matrixQuestion.value.columns.length}, minmax(0, 1fr))`,
      }
    : undefined,
);

// ── 多项填空 / 矩阵填空：答案 { 项/行 id: string }；清空的项移除键。──────
const multiTextQuestion = computed(() =>
  props.question.type === "multi_text" ? props.question : null,
);
const rowTextItems = computed(() => {
  if (props.question.type === "multi_text") return props.question.items;
  if (props.question.type === "matrix_text") return props.question.rows;
  return null;
});
const multiTextAnswer = computed<Record<string, string>>(() =>
  props.modelValue &&
  typeof props.modelValue === "object" &&
  !Array.isArray(props.modelValue)
    ? (props.modelValue as Record<string, string>)
    : {},
);
function setMultiTextItem(itemId: string, value: string | undefined) {
  if (!multiTextQuestion.value && props.question.type !== "matrix_text") return;
  const next: Record<string, string> = { ...multiTextAnswer.value };
  if (value) next[itemId] = value;
  else delete next[itemId];
  emit("update:modelValue", Object.keys(next).length ? next : undefined);
}

// ── 日期/时间：原生 input——移动端系统控件最顺手，值即协议值无需换算。──
function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function setStringAnswer(value: string) {
  emit("update:modelValue", value || undefined);
}
// 原生日期控件按系统 locale 显示 MM/DD/YYYY，与中文阅读顺序有歧义；
// 下方只读回显按界面 locale 展开，协议值不变。
const dateEcho = computed(() => {
  if (props.question.type !== "date") return "";
  const value = stringValue(props.modelValue);
  if (!value) return "";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(locale.value, { dateStyle: "long" }).format(
    parsed,
  );
});
const statementHtml = computed(() =>
  props.question.type === "statement" && props.question.body
    ? renderMarkdown(props.question.body)
    : "",
);
</script>
<template>
  <fieldset class="question-field" :disabled="disabled">
    <legend v-if="!hideTitle && question.type !== 'statement'" class="tw:font-medium">
      {{ question.title }}
      <span v-if="question.required" class="tw:text-danger">*</span>
    </legend>
    <!-- 说明块：markdown 安全渲染，不收集任何输入。 -->
    <div
      v-if="question.type === 'statement'"
      class="mw-md statement-body"
      v-html="statementHtml"
    />
    <template v-else-if="question.type === 'single' || question.type === 'multiple'">
      <label
        v-for="option in question.options"
        :key="option.id"
        class="question-option"
      >
        <RadioButton
          v-if="question.type === 'single'"
          :name="question.id"
          :value="option.id"
          :model-value="modelValue"
          :disabled="disabled"
          @update:model-value="emit('update:modelValue', $event)"
        />
        <Checkbox
          v-else
          binary
          :model-value="
            Array.isArray(modelValue) && modelValue.includes(option.id)
          "
          :disabled="disabled"
          @update:model-value="toggleOption(option.id, $event)"
        />
        <span>{{ option.label }}</span
        ><small v-if="option.exclusive" class="tw:text-muted">{{
          t("surveys.exclusive")
        }}</small>
      </label>
    </template>
    <!-- 图片单选/多选：缩略图瓦片网格，点图即选；隐藏 input 保留原生键盘语义。 -->
    <template v-else-if="imageQuestion">
      <div
        class="image-options"
        :role="imageQuestion.type === 'image_single' ? 'radiogroup' : 'group'"
        :aria-label="question.title"
      >
        <label
          v-for="option in imageQuestion.options"
          :key="option.id"
          class="image-option"
          :class="{ 'image-option--on': imagePicked(option) }"
        >
          <input
            class="visually-hidden-radio"
            :type="imageQuestion.type === 'image_single' ? 'radio' : 'checkbox'"
            :name="imageQuestion.type === 'image_single' ? question.id : undefined"
            :value="option.id"
            :checked="imagePicked(option)"
            :disabled="disabled"
            :aria-label="option.label"
            @change="
              imageQuestion.type === 'image_single'
                ? emit('update:modelValue', option.id)
                : toggleOption(option.id, ($event.target as HTMLInputElement).checked)
            "
          />
          <span class="image-option__thumb">
            <img
              v-if="imageSrcOf(option)"
              :src="imageSrcOf(option)"
              alt=""
              loading="lazy"
            />
            <ImageIcon v-else :size="22" aria-hidden="true" />
          </span>
          <span class="image-option__label">{{ option.label }}</span>
        </label>
      </div>
    </template>
    <template v-else-if="question.type === 'dropdown'">
      <Select
        :input-id="question.id"
        :model-value="typeof modelValue === 'string' ? modelValue : null"
        :options="question.options"
        option-label="label"
        option-value="id"
        :placeholder="t('surveys.dropdownPlaceholder')"
        :disabled="disabled"
        fluid
        :aria-label="question.title"
        @update:model-value="emit('update:modelValue', $event ?? undefined)"
      />
    </template>
    <template v-else-if="question.type === 'text'">
      <Textarea
        v-if="question.multiline"
        :id="question.id"
        :model-value="typeof modelValue === 'string' ? modelValue : ''"
        :maxlength="question.maxLength ?? 2000"
        :disabled="disabled"
        auto-resize
        rows="3"
        fluid
        :aria-label="question.title"
        @update:model-value="emit('update:modelValue', $event || undefined)"
      />
      <InputText
        v-else
        :id="question.id"
        :model-value="typeof modelValue === 'string' ? modelValue : ''"
        :maxlength="question.maxLength ?? 2000"
        :disabled="disabled"
        fluid
        :aria-label="question.title"
        @update:model-value="emit('update:modelValue', $event || undefined)"
      />
    </template>
    <InputNumber
      v-else-if="question.type === 'number'"
      :input-id="question.id"
      :model-value="typeof modelValue === 'number' ? modelValue : null"
      :min="question.min"
      :max="question.max"
      :disabled="disabled"
      :use-grouping="false"
      :max-fraction-digits="8"
      @input="numberInput($event.value)"
      fluid
      :aria-label="question.title"
      @update:model-value="emit('update:modelValue', $event ?? undefined)"
    />
    <template v-else-if="question.type === 'scale'">
      <div class="scale-options">
        <label v-for="value in scales" :key="value" class="scale-choice"
          ><RadioButton
            :name="question.id"
            :value="value"
            :model-value="modelValue"
            :disabled="disabled"
            @update:model-value="emit('update:modelValue', $event)"
          /><span>{{ value }}</span></label
        >
      </div>
      <div class="scale-labels tw:text-muted">
        <span>{{ question.minLabel }}</span
        ><span>{{ question.maxLabel }}</span>
      </div>
    </template>
    <template v-else-if="question.type === 'rating'">
      <div class="rating-row" role="radiogroup" :aria-label="question.title">
        <label
          v-for="value in ratingValues"
          :key="value"
          class="rating-star"
          :class="{ 'rating-star--on': value <= ratingValue }"
          :title="String(value)"
        >
          <input
            class="visually-hidden-radio"
            type="radio"
            :name="question.id"
            :value="value"
            :checked="ratingValue === value"
            :disabled="disabled"
            :aria-label="String(value)"
            @change="emit('update:modelValue', value)"
          />
          <Star :size="26" :fill="value <= ratingValue ? 'currentColor' : 'none'" :stroke-width="1.6" />
        </label>
      </div>
      <small v-if="ratingValue" class="tw:text-muted">{{
        t("surveys.ratingValue", { value: ratingValue, max: question.max })
      }}</small>
    </template>
    <template v-else-if="question.type === 'nps'">
      <div class="nps-grid" role="radiogroup" :aria-label="question.title">
        <label
          v-for="value in npsValues"
          :key="value"
          class="nps-cell"
          :class="{
            'nps-cell--on': value === npsValue,
            'nps-cell--done': value <= npsValue && npsValue >= 0,
          }"
        >
          <input
            class="visually-hidden-radio"
            type="radio"
            :name="question.id"
            :value="value"
            :checked="npsValue === value"
            :disabled="disabled"
            :aria-label="String(value)"
            @change="emit('update:modelValue', value)"
          />
          <span>{{ value }}</span>
        </label>
      </div>
      <div class="scale-labels tw:text-muted">
        <span>{{ question.minLabel }}</span
        ><span>{{ question.maxLabel }}</span>
      </div>
    </template>
    <template v-else-if="question.type === 'date'">
      <input
        :id="question.id"
        class="native-date"
        type="date"
        :value="stringValue(modelValue)"
        :min="question.min"
        :max="question.max"
        :disabled="disabled"
        :aria-label="question.title"
        @change="setStringAnswer(($event.target as HTMLInputElement).value)"
      />
      <small v-if="dateEcho" class="date-echo tw:text-muted">{{
        t("surveys.dateSelected", { date: dateEcho })
      }}</small>
    </template>
    <template v-else-if="question.type === 'time'">
      <input
        :id="question.id"
        class="native-date"
        type="time"
        :value="stringValue(modelValue)"
        :disabled="disabled"
        :aria-label="question.title"
        @change="setStringAnswer(($event.target as HTMLInputElement).value)"
      />
    </template>
    <template v-else-if="rankingQuestion">
      <ol class="ranking-list">
        <li
          v-for="(id, index) in rankingOrder"
          :key="id"
          class="ranking-item"
          :class="{ 'ranking-item--active': rankingActive }"
        >
          <span v-if="rankingActive" class="ranking-rank" aria-hidden="true">{{
            index + 1
          }}</span>
          <span class="ranking-label">{{ rankingLabel(id) }}</span>
          <span class="ranking-actions">
            <button
              type="button"
              class="ranking-btn"
              :disabled="disabled || index === 0"
              :aria-label="
                t('surveys.rankMoveUp', { label: rankingLabel(id) })
              "
              @click="moveRanking(index, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              class="ranking-btn"
              :disabled="disabled || index === rankingOrder.length - 1"
              :aria-label="
                t('surveys.rankMoveDown', { label: rankingLabel(id) })
              "
              @click="moveRanking(index, 1)"
            >
              ↓
            </button>
          </span>
        </li>
      </ol>
      <small class="tw:text-muted">{{ t("surveys.rankHint") }}</small>
    </template>
    <template v-else-if="matrixQuestion">
      <div class="mx">
        <div class="mx-head" :style="matrixGridStyle" aria-hidden="true">
          <span />
          <span v-for="column in matrixQuestion.columns" :key="column.id" class="mx-head__cell">{{
            column.label
          }}</span>
        </div>
        <div
          v-for="row in matrixQuestion.rows"
          :key="row.id"
          class="mx-row"
          :class="{ 'mx-row--invalid': row.id === invalidRow }"
          :style="matrixGridStyle"
          role="group"
          :aria-label="row.label"
        >
          <span class="mx-row__title">{{ row.label }}</span>
          <label
            v-for="column in matrixQuestion.columns"
            :key="column.id"
            class="mx-cell"
          >
            <RadioButton
              v-if="matrixQuestion.type === 'matrix_single'"
              :name="`${question.id}.${row.id}`"
              :value="column.id"
              :model-value="matrixAnswer[row.id] ?? null"
              :disabled="disabled"
              @update:model-value="pickMatrixCell(row.id, column.id, true)"
            />
            <Checkbox
              v-else
              binary
              :model-value="matrixCellPicked(row.id, column.id)"
              :disabled="disabled"
              @update:model-value="pickMatrixCell(row.id, column.id, $event)"
            />
            <span class="mx-cell__label">{{ column.label }}</span>
          </label>
        </div>
      </div>
    </template>
    <!-- 多项填空与矩阵填空同构：一行（项）标签 + 一个文本框。 -->
    <template v-else-if="rowTextItems">
      <label
        v-for="item in rowTextItems"
        :key="item.id"
        class="mt-item"
        :class="{ 'mt-item--invalid': item.id === invalidRow }"
      >
        <span>{{ item.label
          }}<template v-if="question.required"
            >&nbsp;<span class="tw:text-danger">*</span></template
          ></span>
        <InputText
          :model-value="multiTextAnswer[item.id] ?? ''"
          :disabled="disabled"
          fluid
          :aria-label="`${question.title}·${item.label}`"
          @update:model-value="setMultiTextItem(item.id, $event || undefined)"
        />
      </label>
    </template>
  </fieldset>
</template>
<style scoped>
.question-field {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
  display: grid;
  gap: var(--layout-card-padding-compact);
}
.question-field legend {
  padding: 0;
  margin-bottom: var(--layout-card-padding-compact);
  overflow-wrap: anywhere;
}
.question-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.scale-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--layout-card-padding);
}
.scale-choice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}
.scale-labels {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
.statement-body {
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.statement-body :deep(p) {
  margin: 0 0 0.6em;
}
.statement-body :deep(p:last-child) {
  margin-bottom: 0;
}

/* 评分：星形可点、可键盘（隐藏 radio 保留原生方向键换档）。 */
.rating-row {
  display: flex;
  gap: 0.25rem;
}
.rating-star {
  position: relative;
  display: inline-flex;
  padding: 2px;
  border-radius: var(--radius-sm, 6px);
  color: var(--color-text-quaternary);
  cursor: pointer;
}
.rating-star--on {
  color: var(--color-warning-500);
}
.rating-star:focus-within {
  outline: 2px solid var(--color-brand-400);
  outline-offset: 1px;
}
.visually-hidden-radio {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

/* NPS：一行 11 格；390 宽换两行（6+5），不横向溢出。 */
.nps-grid {
  display: grid;
  grid-template-columns: repeat(11, minmax(0, 1fr));
  gap: 4px;
  max-width: 34rem;
}
.nps-cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 2.25rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm, 6px);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.nps-cell:hover {
  border-color: var(--color-brand-400);
}
.nps-cell--done {
  background: var(--color-brand-50);
  border-color: var(--color-brand-300);
}
.nps-cell--on {
  background: var(--color-brand-500);
  border-color: var(--color-brand-500);
  color: var(--color-text-on-brand);
}
.nps-cell:focus-within {
  outline: 2px solid var(--color-brand-400);
  outline-offset: 1px;
}

/* 排序：交互后显名次号 + 上下移按钮；触屏按钮命中区放大。 */
.ranking-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ranking-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm, 6px);
}
.ranking-item--active {
  border-color: var(--color-brand-300);
}
.ranking-rank {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: var(--radius-pill, 999px);
  background: var(--color-bg-soft);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.ranking-item--active .ranking-rank {
  background: var(--color-brand-500);
  color: var(--color-text-on-brand);
}
.ranking-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.ranking-actions {
  flex: none;
  display: flex;
  gap: 4px;
}
.ranking-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm, 6px);
  background: var(--color-surface-base);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.ranking-btn:hover:not(:disabled) {
  border-color: var(--color-brand-400);
  color: var(--color-brand-600);
}
.ranking-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 矩阵：桌面 = 表格网格；窄屏 = 行折叠成小卡、列竖排，不横向溢出。 */
.mx {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.mx-head {
  display: none;
  gap: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.mx-head__cell {
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-align: center;
  overflow-wrap: anywhere;
}
.mx-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm, 6px);
}
.mx-row__title {
  font-weight: 500;
  overflow-wrap: anywhere;
}
.mx-cell {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.mx-cell__label {
  min-width: 0;
}

@media (min-width: 768px) {
  .mx-head {
    display: grid;
    align-items: end;
  }
  .mx-row {
    display: grid;
    align-items: center;
    border: 0;
    padding: 2px 0;
  }
  .mx-row + .mx-row {
    border-top: 1px solid var(--color-border-subtle);
    padding-top: 8px;
  }
  .mx-cell__label {
    display: none;
  }
  .mx-cell {
    justify-content: center;
  }
}
.mt-item {
  display: grid;
  gap: 4px;
  min-width: 0;
}
/* 必答拦截的行/项级就地标红（与作答页题卡同一警示色）。 */
.mx-row--invalid,
.mt-item--invalid {
  box-shadow: 0 0 0 2px var(--color-danger-500);
  border-radius: var(--radius-sm, 6px);
}
.native-date {
  max-width: 16rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm, 6px);
  background: var(--color-surface-base);
  color: var(--color-text-primary);
  font: inherit;
}
.native-date:focus {
  outline: none;
  border-color: var(--color-brand-400);
}
/* 图片选项：瓦片网格自适应（390 档自动收列数），选中描边与 NPS 同族。 */
.image-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.75rem, 1fr));
  gap: 8px;
  min-width: 0;
}
.image-option {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  min-width: 0;
}
.image-option:hover {
  border-color: var(--color-brand-400);
}
.image-option--on {
  border-color: var(--color-brand-500);
  box-shadow: 0 0 0 1px var(--color-brand-500);
}
.image-option:focus-within {
  outline: 2px solid var(--color-brand-400);
  outline-offset: 1px;
}
.image-option__thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 4 / 3;
  border-radius: calc(var(--radius-sm, 6px) - 2px);
  background: var(--color-bg-soft);
  color: var(--color-text-quaternary);
  overflow: hidden;
}
.image-option__thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.image-option__label {
  min-width: 0;
  font-size: 13px;
  overflow-wrap: anywhere;
}

@media (max-width: 480px) {
  .nps-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
</style>
