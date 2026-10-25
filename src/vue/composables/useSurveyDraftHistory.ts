// 草稿历史栈（issue #217）：definition + responseLimit 的快照撤销/重做。
// 快照是引用不可变对象——所有编辑方（画布、设置面板、将来的 Copilot 自动改卷）
// 必须经 commit 换入新对象，不得就地突变 current；结构共享让快照代价 O(改动路径)。
// 连续小步（打字、逐字 markdown）按 label + 间隔合并为一条，一条 = 一个可讲出来的动作。
import { computed, ref } from "vue";

import type { SurveyDefinition } from "../../contracts/index.js";

export interface SurveyDraftState {
  definition: SurveyDefinition;
  responseLimit: number;
}

export interface CommitOptions {
  /** user = 人工编辑；assistant = AI 自动应用（issue #217），二者共用同一条栈。 */
  source?: "user" | "assistant";
  /** 合并键：相同 label 且间隔 ≤ coalesceMs 的连续提交合并为一条历史。 */
  label?: string;
}

interface StackEntry {
  state: SurveyDraftState;
  label?: string;
  at: number;
}

const COALESCE_MS = 800;
const MAX_ENTRIES = 200;

export function useSurveyDraftHistory(initial: SurveyDraftState) {
  const current = ref<SurveyDraftState>(initial);
  // undoStack 存「过去」，栈顶是上一态；redoStack 在新 commit 时清空。
  const undoStack = ref<StackEntry[]>([]);
  const redoStack = ref<StackEntry[]>([]);

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  function commit(next: SurveyDraftState, options: CommitOptions = {}): void {
    const now = Date.now();
    const top = undoStack.value.at(-1);
    const mergeable =
      top !== undefined &&
      options.label !== undefined &&
      top.label === options.label &&
      now - top.at <= COALESCE_MS &&
      options.source !== "assistant";
    if (mergeable) {
      // 合并只刷新时间戳：top.state 保持这段连续动作的起点，撤销一步回到动作前。
      current.value = next;
      top.at = now;
      return;
    }
    undoStack.value.push({ state: current.value, label: options.label, at: now });
    if (undoStack.value.length > MAX_ENTRIES) undoStack.value.shift();
    current.value = next;
    redoStack.value = [];
  }

  /** 替换当前态但不产生历史（load / 服务端回包对齐 / 冲突重载）。 */
  function reset(next: SurveyDraftState): void {
    current.value = next;
    undoStack.value = [];
    redoStack.value = [];
  }

  function undo(): SurveyDraftState | null {
    const entry = undoStack.value.pop();
    if (!entry) return null;
    redoStack.value.push({ state: current.value, at: Date.now() });
    current.value = entry.state;
    return entry.state;
  }

  function redo(): SurveyDraftState | null {
    const entry = redoStack.value.pop();
    if (!entry) return null;
    undoStack.value.push({ state: current.value, at: Date.now() });
    current.value = entry.state;
    return entry.state;
  }

  return { current, commit, reset, undo, redo, canUndo, canRedo };
}
