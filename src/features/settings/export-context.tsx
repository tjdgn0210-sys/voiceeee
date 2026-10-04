import { createContext, useContext } from 'react';
import type { ExportService } from '../../application/export/export-service';

export const ExportContext = createContext<ExportService | null>(null);

export function useExport(): ExportService {
  const service = useContext(ExportContext);
  if (!service) throw new Error('Export service must be initialized before rendering screens.');
  return service;
}
