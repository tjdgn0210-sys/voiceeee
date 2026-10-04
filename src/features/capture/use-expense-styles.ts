import { useMemo } from 'react';
import { useScaler } from '../settings/settings-context';
import { createExpenseStyles } from './expense-styles';

/** Screen styles for the current font scale. */
export function useExpenseStyles() {
  const scaler = useScaler();
  return useMemo(() => createExpenseStyles(scaler), [scaler]);
}
