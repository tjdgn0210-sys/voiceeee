import { createContext, useContext } from 'react';
import type { LocalDataReset } from '../../application/reset/local-data-reset';

export const ResetContext = createContext<LocalDataReset | null>(null);

export function useLocalDataReset(): LocalDataReset {
  const service = useContext(ResetContext);
  if (!service) throw new Error('Reset service must be initialized before rendering screens.');
  return service;
}
