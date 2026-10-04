/**
 * A minimal .xlsx writer (blueprint 10.3). Chosen over SheetJS and exceljs because it needs no dependency, works the same on
 * every platform, and makes formula injection impossible by construction: every text cell is an inline string, never a formula,
 * and a text that starts with = + - @ also carries Excel's "quote prefix" so editing the cell keeps it text.
 * An .xlsx file is a zip of XML parts; the parts are small, so they are stored without compression.
 */

export type XlsxCell =
  | { kind: 'text'; value: string }
  /** Whole number shown with thousands separators (#,##0). */
  | { kind: 'amount'; value: number };

export type XlsxSheet = {
  /** Excel limits: 31 characters, none of \ / ? * [ ] : */
  name: string;
  header: string[];
  rows: XlsxCell[][];
  /** Column widths in characters, optional. */
  widths?: number[];
};

export const text = (value: string): XlsxCell => ({ kind: 'text', value });
export const amount = (value: number): XlsxCell => ({ kind: 'amount', value });

const encoder = new TextEncoder();

// Characters XML 1.0 cannot carry are dropped; the rest is escaped.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
function escapeXml(value: string): string {
  return value.replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function columnName(index: number): string {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
}

/** Style ids in styles.xml below: 0 text, 1 bold header, 2 amount (#,##0), 3 text with quote prefix. */
const STYLE_TEXT = 0;
const STYLE_HEADER = 1;
const STYLE_AMOUNT = 2;
const STYLE_QUOTED = 3;

const startsLikeFormula = (value: string) => /^[=+\-@\t\r]/.test(value);

function cellXml(reference: string, cell: XlsxCell, headerRow: boolean): string {
  if (cell.kind === 'amount') {
    if (!Number.isFinite(cell.value)) throw new RangeError('Amounts must be finite numbers.');
    return `<c r="${reference}" s="${STYLE_AMOUNT}"><v>${cell.value}</v></c>`;
  }
  const style = headerRow ? STYLE_HEADER : startsLikeFormula(cell.value) ? STYLE_QUOTED : STYLE_TEXT;
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const widths = sheet.widths ?? [];
  const cols = widths.length
    ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const lines = [sheet.header.map(value => text(value)), ...sheet.rows].map((cells, rowIndex) => {
    const content = cells.map((cell, columnIndex) => cellXml(`${columnName(columnIndex)}${rowIndex + 1}`, cell, rowIndex === 0)).join('');
    return `<row r="${rowIndex + 1}">${content}</row>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `${cols}<sheetData>${lines.join('')}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  + `<fonts count="2"><font><sz val="11"/><name val="Malgun Gothic"/></font><font><b/><sz val="11"/><name val="Malgun Gothic"/></font></fonts>`
  + `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
  + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
  + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
  + `<cellXfs count="4">`
  + `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
  + `<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>`
  + `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
  + `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" quotePrefix="1"/>`
  + `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function validateSheetName(name: string): void {
  if (!name || name.length > 31 || /[\\/?*[\]:]/.test(name)) throw new RangeError(`Invalid sheet name: ${name}`);
}

// --- zip (stored) -----------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

type Part = { path: string; bytes: Uint8Array };

function zipStored(parts: Part[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // Fixed DOS date 2026-01-01 00:00 keeps the output reproducible.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const part of parts) {
    const name = encoder.encode(part.path);
    const crc = crc32(part.bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, part.bytes.length, true);
    local.setUint32(22, part.bytes.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, part.bytes);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, dosTime, true);
    entry.setUint16(14, dosDate, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, part.bytes.length, true);
    entry.setUint32(24, part.bytes.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + part.bytes.length;
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, parts.length, true);
  end.setUint16(10, parts.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const result = new Uint8Array(all.reduce((sum, chunk) => sum + chunk.length, 0));
  let position = 0;
  for (const chunk of all) { result.set(chunk, position); position += chunk.length; }
  return result;
}

/** The finished .xlsx file. Throws RangeError for an invalid sheet name or a non-finite amount. */
export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  if (!sheets.length) throw new RangeError('A workbook needs at least one sheet.');
  sheets.forEach(sheet => validateSheetName(sheet.name));
  const parts: Part[] = [
    {
      path: '[Content_Types].xml',
      bytes: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    },
    {
      path: '_rels/.rels',
      bytes: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    },
    {
      path: 'xl/workbook.xml',
      bytes: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`),
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      bytes: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    },
    { path: 'xl/styles.xml', bytes: encoder.encode(STYLES_XML) },
    ...sheets.map((sheet, index) => ({ path: `xl/worksheets/sheet${index + 1}.xml`, bytes: encoder.encode(sheetXml(sheet)) })),
  ];
  return zipStored(parts);
}
