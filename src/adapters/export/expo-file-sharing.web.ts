import type { ExportFileSink } from '../../application/export/export-service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Web: the browser downloads the file. */
export function createExpoExportSink(): ExportFileSink {
  return {
    async saveAndShare(fileName, bytes) {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_MIME }));
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    },
  };
}
