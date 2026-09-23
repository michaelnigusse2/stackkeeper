/**
 * CSV import.
 *
 * Every prospect arrives with a spreadsheet, so import is the first thing a
 * trial user does. A parser that mangles their file loses them in the first
 * five minutes, which is why this follows RFC 4180 properly: quoted fields,
 * embedded commas, embedded newlines, and doubled quotes inside a quoted
 * field. It also copes with the things real exports contain, namely a UTF-8
 * byte order mark, carriage returns, and semicolon delimiters from European
 * spreadsheet locales.
 */

export interface CsvTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export class CsvError extends Error {}

/** Guess the delimiter by counting candidates outside quoted sections. */
export function detectDelimiter(text: string): string {
  const candidates = [",", ";", "\t", "|"];
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = -1;
  for (const candidate of candidates) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === candidate) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCsv(input: string, delimiter?: string): CsvTable {
  const text = stripBom(input);
  const sep = delimiter ?? detectDelimiter(text);
  if (sep.length !== 1) throw new CsvError("The delimiter must be a single character");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Ignore a trailing blank line, but keep genuinely empty rows in the middle.
    if (!(row.length === 1 && row[0] === "" && i >= text.length)) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i] as string;

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field === "") {
      quoted = true;
      i++;
      continue;
    }
    if (ch === sep) {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      i += text[i + 1] === "\n" ? 2 : 1;
      endRow();
      continue;
    }
    if (ch === "\n") {
      i++;
      endRow();
      continue;
    }
    field += ch;
    i++;
  }

  if (quoted) throw new CsvError("The file ends inside a quoted value. Check for a stray quotation mark.");
  if (field !== "" || row.length > 0) endRow();

  const [headers = [], ...body] = rows;
  if (headers.length === 0) throw new CsvError("The file has no header row.");

  return {
    headers: headers.map((h) => h.trim()),
    rows: body.filter((r) => r.some((value) => value.trim() !== "")),
  };
}

/** Normalise a header for matching: lower case, letters and digits only. */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Suggest which column holds which field, so the mapping screen opens with
 * sensible choices instead of a wall of empty dropdowns.
 */
export function suggestMapping(
  headers: readonly string[],
  fields: Readonly<Record<string, readonly string[]>>,
): Record<string, number | null> {
  const normalised = headers.map(normaliseHeader);
  const mapping: Record<string, number | null> = {};
  const taken = new Set<number>();

  for (const [field, aliases] of Object.entries(fields)) {
    let found: number | null = null;
    for (const alias of aliases) {
      const target = normaliseHeader(alias);
      const exact = normalised.findIndex((h, idx) => h === target && !taken.has(idx));
      if (exact !== -1) {
        found = exact;
        break;
      }
    }
    if (found === null) {
      for (const alias of aliases) {
        const target = normaliseHeader(alias);
        const partial = normalised.findIndex(
          (h, idx) => !taken.has(idx) && h.length > 2 && (h.includes(target) || target.includes(h)),
        );
        if (partial !== -1) {
          found = partial;
          break;
        }
      }
    }
    if (found !== null) taken.add(found);
    mapping[field] = found;
  }
  return mapping;
}

/** Column aliases seen in the spreadsheets freelancers actually keep. */
export const ASSET_IMPORT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  client: ["client", "customer", "company", "account"],
  label: ["label", "name", "domain", "asset", "service", "description"],
  kind: ["kind", "type", "category"],
  provider: ["provider", "host", "registrar", "vendor", "supplier"],
  identifier: ["identifier", "ip", "ipaddress", "url", "hostname", "domain"],
  expiresAt: ["expires", "expiry", "expirydate", "renewaldate", "renews", "expiresat"],
  costAmount: ["cost", "price", "wepay", "amount", "costprice"],
  costCurrency: ["costcurrency", "currency"],
  costCycle: ["cycle", "billingcycle", "term", "frequency", "period"],
  chargeAmount: ["charge", "clientpays", "sellprice", "billed", "chargeamount"],
  accountOwner: ["owner", "accountowner", "ownedby"],
  notes: ["notes", "note", "comment", "comments"],
};

export interface MappedRow {
  readonly rowNumber: number;
  readonly values: Readonly<Record<string, string>>;
}

/** Apply a column mapping to every row, keeping the original row numbers. */
export function applyMapping(
  table: CsvTable,
  mapping: Readonly<Record<string, number | null>>,
): MappedRow[] {
  return table.rows.map((row, index) => {
    const values: Record<string, string> = {};
    for (const [field, column] of Object.entries(mapping)) {
      values[field] = column === null ? "" : (row[column] ?? "").trim();
    }
    // Row 1 is the header, so the first data row is row 2 in the user's file.
    return { rowNumber: index + 2, values };
  });
}
