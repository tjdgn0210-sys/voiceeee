import type { UndoResult } from './undo-created-transaction';

/** How long the bar stays visible (blueprint 11.3, README 3.1 #12). */
export const UNDO_BAR_DURATION_MS = 8_000;

export type UndoBarEntry = {
  id: number;
  /** What happened, e.g. "치과 일정을 삭제했어요". */
  label: string;
  /** Runs the reversal; the bar never decides success on its own. */
  undo: () => Promise<UndoResult>;
};

export type UndoBarState =
  | { status: 'HIDDEN' }
  | { status: 'SHOWN'; entry: UndoBarEntry }
  | { status: 'WORKING'; entry: UndoBarEntry }
  | { status: 'DONE'; message: string }
  | { status: 'FAILED'; message: string };

/**
 * One transient "undo" bar for the whole app. The newest entry replaces the older one (only the latest
 * reversible action is offered). The bar hides itself after a few seconds; a failed reversal is shown, never hidden.
 * Time is injected so tests do not wait.
 */
export function createUndoBar(dependencies: {
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(handle: unknown): void;
  durationMs?: number;
}) {
  const duration = dependencies.durationMs ?? UNDO_BAR_DURATION_MS;
  let state: UndoBarState = { status: 'HIDDEN' };
  let timer: unknown = null;
  let nextId = 1;
  const listeners = new Set<() => void>();

  const publish = (next: UndoBarState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const stopTimer = () => {
    if (timer !== null) dependencies.clearTimer(timer);
    timer = null;
  };
  const hideAfter = (milliseconds: number) => {
    stopTimer();
    timer = dependencies.setTimer(() => { timer = null; publish({ status: 'HIDDEN' }); }, milliseconds);
  };

  return {
    getState: (): UndoBarState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Offers an undo for the latest action. Ignored while an undo is running. */
    show(input: Pick<UndoBarEntry, 'label' | 'undo'>): void {
      if (state.status === 'WORKING') return;
      publish({ status: 'SHOWN', entry: { id: nextId++, ...input } });
      hideAfter(duration);
    },
    dismiss(): void {
      if (state.status === 'WORKING') return;
      stopTimer();
      publish({ status: 'HIDDEN' });
    },
    async run(): Promise<void> {
      if (state.status !== 'SHOWN') return;
      const { entry } = state;
      stopTimer();
      publish({ status: 'WORKING', entry });
      let result: UndoResult;
      try {
        result = await entry.undo();
      } catch {
        result = { status: 'FAILED', message: '되돌리기를 확인하지 못했어요. 목록을 확인해 주세요.' };
      }
      if (result.status === 'SUCCESS') publish({ status: 'DONE', message: '되돌렸어요' });
      else publish({ status: 'FAILED', message: result.message });
      hideAfter(duration);
    },
  };
}

export type UndoBar = ReturnType<typeof createUndoBar>;
