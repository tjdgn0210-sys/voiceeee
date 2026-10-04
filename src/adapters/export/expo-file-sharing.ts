import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { ExportFileSink } from '../../application/export/export-service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_UTI = 'org.openxmlformats.spreadsheetml.sheet';

/** Writes the file into the app cache and opens the system share sheet (save to Files, send by mail ...). */
export function createExpoExportSink(): ExportFileSink {
  return {
    async saveAndShare(fileName, bytes) {
      const file = new File(Paths.cache, fileName);
      if (file.exists) file.delete();
      file.create();
      file.write(bytes);
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      await Sharing.shareAsync(file.uri, { mimeType: XLSX_MIME, UTI: XLSX_UTI, dialogTitle: '엑셀 파일 내보내기' });
    },
  };
}
