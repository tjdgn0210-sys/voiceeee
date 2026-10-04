import { createContext, useContext, useSyncExternalStore } from 'react';
import type { UndoBar, UndoBarState } from '../application/undo/undo-bar';

export const UndoBarContext = createContext<UndoBar | null>(null);

export function useUndoBar(): UndoBar {
  const bar = useContext(UndoBarContext);
  if (!bar) throw new Error('UndoBarContext is required');
  return bar;
}

/** The bar's current state; re-renders when it changes. */
export function useUndoBarState(): UndoBarState {
  const bar = useUndoBar();
  return useSyncExternalStore(bar.subscribe, bar.getState, bar.getState);
}
