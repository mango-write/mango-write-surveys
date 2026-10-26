<script setup lang="ts">
// 说明类字段的紧凑 markdown 编辑器（issue #217）。数据契约：markdown 进、
// markdown 出，字段持久化值永远是 markdown 字符串。两条编辑路径：
// 宿主提供 renderMarkdownEditable/htmlToMarkdown 时用 TipTap 富文本（HTML
// 往返由宿主转换器保证 round-trip 安全）；缺省时退化为 textarea 直编
// markdown 源文本——不经过任何 HTML 往返，同样 markdown 进 markdown 出。
// 只读渲染仅在 disabled 时出现。
import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { EditorContent, useEditor, type Editor } from "@tiptap/vue-3";

import StarterKit from "@tiptap/starter-kit";
import Textarea from "primevue/textarea";
import { useSurveysHost } from "../host.js";

const props = defineProps<{
  modelValue: string;
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
}>();
const emit = defineEmits<{
  change: [value: string];
  /** 失焦时提交一次（宿主借此刷新合并窗口/触发保存）。 */
  commit: [];
}>();

const host = useSurveysHost();
const canEdit = computed(() => !!(host.htmlToMarkdown && host.renderMarkdownEditable));
const plainEditing = computed(() => !canEdit.value && !props.disabled);

// 正文的权威格式是 Markdown；只有带闭合标签的存量才按 HTML 转换（主站
// htmlToMarkdownIfMarkup 的同一条判定，转换器在宿主）。
const CLOSING_TAG = /<\/[a-z][^>]*>/i;
function normalizeStored(raw: string): string {
  if (!raw || !CLOSING_TAG.test(raw) || !host.htmlToMarkdown) return raw;
  return host.htmlToMarkdown(raw);
}

const empty = ref(!props.modelValue);

const editor: Ref<Editor | undefined> = canEdit.value
  ? useEditor({
      extensions: [StarterKit],
      content: host.renderMarkdownEditable!(normalizeStored(props.modelValue || "")),
      editable: !props.disabled,
      editorProps: {
        attributes: { class: "survey-markdown-field__content", role: "textbox", "aria-multiline": "true", "aria-label": props.ariaLabel ?? "" },
        handleDOMEvents: {
          blur: () => {
            emit("commit");
            return false;
          },
        },
      },
      onUpdate({ editor: ed }) {
        const markdown = ed.isEmpty ? "" : host.htmlToMarkdown!(ed.getHTML());
        empty.value = ed.isEmpty;
        emit("change", markdown);
      },
    })
  : ref(undefined);

const readonlyHtml = computed(() =>
  props.modelValue ? host.renderMarkdown(props.modelValue) : "",
);

watch(
  () => editor.value,
  (ed) => {
    if (ed) empty.value = ed.isEmpty;
  },
  { immediate: true },
);

watch(
  () => props.modelValue,
  (next) => {
    if (plainEditing.value) {
      empty.value = !(next || "");
      return;
    }
    const ed = editor.value;
    if (!ed) return;
    const current = ed.isEmpty ? "" : host.htmlToMarkdown!(ed.getHTML());
    // 外部换入（撤销/重做、冲突重载）时整体重置内容；自身编辑回声由「当前
    // markdown 与编辑器内容一致则不动」挡掉，避免光标跳位。
    if ((next || "") !== current) {
      ed.commands.setContent(
        host.renderMarkdownEditable!(normalizeStored(next || "")),
        { emitUpdate: false },
      );
      empty.value = ed.isEmpty;
    }
  },
);

function onPlainInput(value: string | undefined) {
  const next = value ?? "";
  empty.value = !next;
  emit("change", next);
}

function focusEditor(event: MouseEvent) {
  if (!props.disabled && !(event.target as HTMLElement).closest("[contenteditable]"))
    editor.value?.commands.focus();
}

watch(
  () => props.disabled,
  (next) => editor.value?.setEditable(!next),
);

onBeforeUnmount(() => editor.value?.destroy());
</script>
<template>
  <div class="survey-markdown-field" :class="{ 'is-empty': empty && !!placeholder && !plainEditing }" @click="focusEditor">
    <EditorContent v-if="editor" :editor="editor" class="survey-markdown-field__surface" />
    <!-- textarea 直编（宿主缺富文本往返转换器）：markdown 源文本进出，无转换。 -->
    <Textarea
      v-else-if="plainEditing"
      class="survey-markdown-field__surface survey-markdown-field__plain"
      :model-value="modelValue"
      :aria-label="ariaLabel"
      :placeholder="placeholder"
      rows="4"
      auto-resize
      fluid
      @update:model-value="onPlainInput"
      @blur="emit('commit')"
    />
    <!-- 只读（disabled）：经宿主安全渲染器展示，不接受输入。 -->
    <div
      v-else
      class="survey-markdown-field__surface survey-markdown-field__readonly"
      :aria-label="ariaLabel"
      v-html="readonlyHtml"
    />
    <span v-if="empty && placeholder && !plainEditing" class="survey-markdown-field__placeholder" aria-hidden="true">{{
      placeholder
    }}</span>
  </div>
</template>
<style scoped>
.survey-markdown-field {
  position: relative;
  min-width: 0;
}
.survey-markdown-field__surface :deep(.survey-markdown-field__content) {
  outline: none;
  color: var(--color-text-primary);
  font-size: 13.5px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.survey-markdown-field__surface :deep(.survey-markdown-field__content > * + *) {
  margin-top: 0.5em;
}
.survey-markdown-field__surface :deep(h1),
.survey-markdown-field__surface :deep(h2),
.survey-markdown-field__surface :deep(h3) {
  font-size: 14.5px;
  font-weight: 600;
}
.survey-markdown-field__readonly {
  color: var(--color-text-primary);
  font-size: 13.5px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.survey-markdown-field__plain {
  min-height: 7rem;
  line-height: 1.7;
}
.survey-markdown-field__placeholder {
  position: absolute;
  top: 0;
  left: 0;
  margin: 0;
  pointer-events: none;
  color: var(--color-text-tertiary);
  font-size: 13.5px;
  line-height: 1.7;
}
</style>
