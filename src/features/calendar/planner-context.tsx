import { createContext, useContext } from 'react';
import type { PlannerServices } from '../../application/planner/planner-services';

export const PlannerContext = createContext<PlannerServices | null>(null);

export function usePlanner(): PlannerServices {
  const services = useContext(PlannerContext);
  if (!services) throw new Error('Planner services must be initialized before rendering screens.');
  return services;
}
