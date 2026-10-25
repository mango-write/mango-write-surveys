<script setup lang="ts">
// 行/列/填空项共用的标签列表编辑器（issue #217）：Enter 新增、空行 Backspace
// 删除、下限守卫、待落笔行不进 definition——与题目选项编辑器同一套交互语义，
// 交互实现抽到这里是因为矩阵题同时要两个编辑器（行+列），状态必须各自独立。
import { nextTick, ref, type ComponentPublicInstance } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { Trash2 } from "lucide-vue-next";

import type { SurveyLabeledNode } from "../../contracts/index.js";
import { isDefaultOptionLabel, uid } from "../lib/definition-ops.js";

const props = defineProps<{
  items: SurveyLabeledNode[];
  /** 最少保留项数：下限处 Backspace/删除按钮只是不动，不做声。 */
  min: number;
  max: number;
  /** 新行的默认文案（带 {n}），也是占位与 aria-label。 */
  labelKey: string;
  idPrefix: string;
}>();
const emit = defineEmits<{
  change: [items: SurveyLabeledNode[]];
}>();
const { t } = useI18n();

const inputs = ref<HTMLInputElement[]>([]);
const pendingAfter = ref<number | null>(null);
const pendingInput = ref<HTMLInputElement | null>(null);

function onItemFocus(event: FocusEvent) {
  const input = event.target as HTMLInputElement;
  if (isDefaultOptionLabel(input.value)) input.select();
}

function setLabel(itemId: string, value: string | undefined) {
  const label = value ?? "";
  emit(
    "change",
    props.items.map((item) => (item.id === itemId ? { ...item, label } : item)),
  );
}

function addAfter(index: number) {
  if (props.items.length >= props.max) return;
  pendingAfter.value = index;
  void nextTick(() => pendingInput.value?.focus());
}

function commitPending(value: string | undefined) {
  const at = pendingAfter.value;
  if (at === null) return;
  const label = (value ?? "").trimStart();
  if (!label) return;
  pendingAfter.value = null;
  const next = [
    ...props.items.slice(0, at + 1),
    { id: uid(props.idPrefix), label },
    ...props.items.slice(at + 1),
  ];
  emit("change", next);
  void nextTick(() => inputs.value[at + 1]?.focus());
}

function discardPending() {
  const at = pendingAfter.value;
  if (at === null) return;
  pendingAfter.value = null;
  void nextTick(() => inputs.value[at]?.focus());
}

function onPendingKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    return;
  }
  if (event.key === "Backspace" && !(event.target as HTMLInputElement).value) {
    event.preventDefault();
    discardPending();
  }
}

function removeAt(index: number) {
  if (props.items.length <= props.min) return;
  emit("change", props.items.filter((_, i) => i !== index));
  void nextTick(() => inputs.value[Math.max(0, index - 1)]?.focus());
}

function onItemKeydown(index: number, event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    addAfter(index);
    return;
  }
  if (event.key === "Backspace") {
    const input = event.target as HTMLInputElement;
    if (input.value !== "" || input.selectionStart !== 0 || input.selectionEnd !== 0)
      return;
    removeAt(index);
  }
}

function inputRef(el: unknown, index: number) {
  const input =
    el instanceof HTMLInputElement
      ? el
      : (el as { $el?: HTMLInputElement } | null)?.$el;
  if (input) inputs.value[index] = input;
}
</script>
<template>
  <div class="label-list">
    <template v-for="(item, index) in items" :key="item.id">
      <div class="label-row">
        <InputText
          :ref="(el) => inputRef(el, index)"
          class="label-input"
          :class="{ 'opt-input--default': isDefaultOptionLabel(item.label) }"
          :model-value="item.label"
          :placeholder="t(labelKey, { n: index + 1 })"
          maxlength="200"
          :aria-label="t(labelKey, { n: index + 1 })"
          @update:model-value="setLabel(item.id, $event)"
          @focus="onItemFocus"
          @keydown="onItemKeydown(index, $event)"
        />
        <Button
          severity="secondary"
          variant="text"
          :aria-label="t('surveys.removeLabeledItem')"
          :disabled="items.length <= min"
          @click.stop="removeAt(index)"
        >
          <template #icon><Trash2 :size="14" /></template>
        </Button>
      </div>
      <!-- 待落笔的空行：只在 UI 上占位，输入或丢弃前不进 definition。 -->
      <div v-if="pendingAfter === index" class="label-row">
        <InputText
          :ref="
            (el: Element | ComponentPublicInstance | null) => {
              pendingInput =
                (el as { $el?: HTMLInputElement } | null)?.$el ?? null;
            }
          "
          class="label-input"
          :placeholder="t(labelKey, { n: index + 2 })"
          maxlength="200"
          :aria-label="t(labelKey, { n: index + 2 })"
          @update:model-value="commitPending"
          @keydown="onPendingKeydown"
          @blur="pendingAfter = null"
        />
      </div>
    </template>
    <small class="label-hint tw:text-muted">{{ t("surveys.labeledListHint", { min }) }}</small>
  </div>
</template>
<style scoped>
.label-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.label-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.label-input,
:deep(.label-input) {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  padding-block: 4px;
}
.label-input.opt-input--default:not(:focus) {
  color: var(--color-muted);
}
:deep(.label-input:hover) {
  border-color: var(--color-border-subtle);
}
:deep(.label-input:focus) {
  border-color: var(--color-brand-400);
}
.label-hint {
  font-size: 11.5px;
}
</style>
