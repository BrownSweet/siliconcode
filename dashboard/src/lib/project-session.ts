import { useState } from "preact/hooks";

export interface ComposerDraft {
  text: string;
  label: string;
  parentId: string;
}

export function draftScope(userId: string, projectId: string, versionId: string) {
  return `siliconcode.draft.${userId}.${projectId}.${versionId || "new"}`;
}

/** Each account/project/conversation owns its draft; writes happen on input, not unload. */
export function readComposerDraft(storage: Pick<Storage, "getItem">, scope: string): ComposerDraft {
  const empty = { text: "", label: "1.0", parentId: "" };
  try {
    const value = JSON.parse(storage.getItem(scope) || "null");
    if (
      !value ||
      typeof value.text !== "string" ||
      typeof value.label !== "string" ||
      typeof value.parentId !== "string"
    )
      return empty;
    return {
      text: value.text.slice(0, 100_000),
      label: value.label.slice(0, 80),
      parentId: value.parentId,
    };
  } catch {
    return empty;
  }
}

export function useComposerDraft(scope: string, reportError: (message: string) => void) {
  const [state, setState] = useState<{ scope: string; value: ComposerDraft } | null>(null);
  const value = state?.scope === scope ? state.value : readComposerDraft(localStorage, scope);
  function replace(target: string, next: ComposerDraft) {
    setState({ scope: target, value: next });
    try {
      localStorage.setItem(target, JSON.stringify(next));
    } catch {
      reportError("浏览器无法保存草稿，请复制需求内容后再离开页面。");
    }
  }
  return {
    value,
    replace,
    update: (patch: Partial<ComposerDraft>) => replace(scope, { ...value, ...patch }),
  };
}

/** Keep project activity current even while its running task is not selected. */
export function watchProjectActivity(options: {
  load: () => Promise<unknown>;
  changed: () => Promise<void>;
  error: (error: Error) => void;
  intervalMs?: number;
}): () => void {
  let disposed = false;
  let previous: string | undefined;
  let timer: ReturnType<typeof setTimeout>;
  async function refresh() {
    try {
      const next = JSON.stringify(await options.load());
      if (disposed) return;
      if (next !== previous) {
        await options.changed();
        if (!disposed) previous = next;
      }
    } catch (error) {
      if (!disposed) options.error(error as Error);
    } finally {
      if (!disposed) timer = setTimeout(refresh, options.intervalMs ?? 1500);
    }
  }
  void refresh();
  return () => {
    disposed = true;
    clearTimeout(timer);
  };
}

export function newRequirementInput(
  projectId: string,
  draft: { projectId: string; label: string; parentId: string; text: string },
  versions: ReadonlyArray<{ id: string; confirmed?: unknown }>,
) {
  if (draft.projectId !== projectId) throw new Error("项目已切换，请重新填写需求");
  if (draft.parentId && !versions.some((v) => v.id === draft.parentId && v.confirmed))
    throw new Error("父版本不属于当前项目或尚未确认，请重新选择");
  return {
    label: draft.label,
    requirement: draft.text,
    ...(draft.parentId ? { parentId: draft.parentId } : {}),
  };
}
