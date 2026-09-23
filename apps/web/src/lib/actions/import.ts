"use server";

import { revalidatePath } from "next/cache";
import {
  applyMapping, ASSET_IMPORT_FIELDS, CsvError, isBillingCycle, isIsoDate,
  parseAmount, parseCsv, suggestMapping, type BillingCycle, type CsvTable,
} from "@stackkeeper/core";
import {
  createAsset, createClient, createCostLine, listClients, recordAudit,
} from "@stackkeeper/db";
import type { AssetKind, Party } from "@stackkeeper/db";
import { withPrincipal } from "@/lib/session";

/**
 * CSV import, in two passes.
 *
 * Pass one parses the file, guesses which column is which, and shows the user
 * a preview. Pass two applies the mapping they confirmed. The file itself
 * travels in a hidden field rather than being stored between the two, so an
 * abandoned import leaves nothing behind.
 *
 * Rows that cannot be read are reported with their line number from the user's
 * own file and skipped. A partial import that tells you exactly which three
 * rows failed beats an all-or-nothing error on a hundred-row spreadsheet.
 */

export interface ImportPreview {
  readonly stage: "preview";
  readonly csvText: string;
  readonly headers: readonly string[];
  readonly sample: readonly (readonly string[])[];
  readonly totalRows: number;
  readonly mapping: Readonly<Record<string, number | null>>;
}

export interface ImportResult {
  readonly stage: "done";
  readonly created: { clients: number; assets: number; costLines: number };
  readonly skipped: readonly string[];
}

export interface ImportProblem {
  readonly stage: "error";
  readonly message: string;
}

export type ImportState = ImportPreview | ImportResult | ImportProblem | { stage: "start" };

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5000;

const KINDS = new Set<AssetKind>([
  "server", "domain", "certificate", "hosting", "dns", "email",
  "saas", "license", "cdn", "database", "storage", "other",
]);

export async function previewImportAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const file = formData.get("file");
  const pasted = (formData.get("csvText") ?? "").toString();

  let text = pasted;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      return { stage: "error", message: "That file is larger than 2 MB. Split it and try again." };
    }
    text = await file.text();
  }
  if (!text.trim()) {
    return { stage: "error", message: "Choose a CSV file or paste some rows." };
  }

  let table: CsvTable;
  try {
    table = parseCsv(text);
  } catch (error) {
    return {
      stage: "error",
      message: error instanceof CsvError ? error.message : "That file could not be read as CSV.",
    };
  }

  if (table.rows.length === 0) return { stage: "error", message: "That file has a header but no rows." };
  if (table.rows.length > MAX_ROWS) {
    return { stage: "error", message: `That file has ${table.rows.length} rows. The limit is ${MAX_ROWS}.` };
  }

  return {
    stage: "preview",
    csvText: text,
    headers: table.headers,
    sample: table.rows.slice(0, 5),
    totalRows: table.rows.length,
    mapping: suggestMapping(table.headers, ASSET_IMPORT_FIELDS),
  };
}

export async function commitImportAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const text = (formData.get("csvText") ?? "").toString();
  if (!text.trim()) return { stage: "error", message: "The file was lost. Please upload it again." };

  const mapping: Record<string, number | null> = {};
  for (const field of Object.keys(ASSET_IMPORT_FIELDS)) {
    const raw = (formData.get(`map.${field}`) ?? "").toString();
    mapping[field] = raw === "" || raw === "-1" ? null : Number(raw);
  }

  if (mapping.client === null || mapping.label === null) {
    return { stage: "error", message: "Map both the client column and the name column before importing." };
  }

  let table: CsvTable;
  try {
    table = parseCsv(text);
  } catch (error) {
    return {
      stage: "error",
      message: error instanceof CsvError ? error.message : "That file could not be read as CSV.",
    };
  }

  const rows = applyMapping(table, mapping);
  const skipped: string[] = [];
  let newClients = 0;
  let newAssets = 0;
  let newCostLines = 0;

  try {
    await withPrincipal(async (tx, principal) => {
      const existing = await listClients(tx, principal.orgId);
      const clientsByName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c.id]));

      for (const row of rows) {
        const clientName = row.values.client?.trim() ?? "";
        const label = row.values.label?.trim() ?? "";

        if (!clientName || !label) {
          skipped.push(`Row ${row.rowNumber}: needs both a client and a name.`);
          continue;
        }

        let clientId = clientsByName.get(clientName.toLowerCase());
        if (!clientId) {
          const created = await createClient(tx, principal.orgId, { name: clientName });
          clientId = created.id;
          clientsByName.set(clientName.toLowerCase(), clientId);
          newClients++;
        }

        const kindRaw = (row.values.kind ?? "").trim().toLowerCase();
        const kind: AssetKind = KINDS.has(kindRaw as AssetKind)
          ? (kindRaw as AssetKind)
          : guessKind(label, row.values.identifier ?? "");

        const expiresRaw = (row.values.expiresAt ?? "").trim();
        let expiresAt: Date | null = null;
        if (expiresRaw) {
          const normalised = normaliseDate(expiresRaw);
          if (normalised) expiresAt = new Date(`${normalised}T00:00:00Z`);
          else skipped.push(`Row ${row.rowNumber}: could not read the date "${expiresRaw}", imported without it.`);
        }

        const asset = await createAsset(tx, principal.orgId, {
          clientId,
          kind,
          label,
          provider: emptyToNull(row.values.provider),
          identifier: emptyToNull(row.values.identifier),
          expiresAt,
          source: "csv",
          accountOwner: readParty(row.values.accountOwner),
          ownershipNote: emptyToNull(row.values.notes),
        });
        newAssets++;

        const costRaw = (row.values.costAmount ?? "").trim();
        if (costRaw) {
          const currency = (row.values.costCurrency ?? "").trim().toUpperCase() || "USD";
          const cycle = readCycle(row.values.costCycle);
          try {
            const cost = parseAmount(stripCurrencySymbols(costRaw), currency);
            const chargeRaw = (row.values.chargeAmount ?? "").trim();
            const charge = chargeRaw ? parseAmount(stripCurrencySymbols(chargeRaw), currency) : null;

            await createCostLine(tx, principal.orgId, {
              assetId: asset.id,
              costAmount: cost.amount,
              costCurrency: currency,
              costCycle: cycle,
              chargeAmount: charge?.amount ?? null,
              chargeCurrency: charge ? currency : null,
              chargeCycle: charge ? cycle : null,
              billed: false,
            });
            newCostLines++;
          } catch {
            skipped.push(`Row ${row.rowNumber}: could not read the amount "${costRaw}", imported without costs.`);
          }
        }
      }

      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "import.csv",
        data: { clients: newClients, assets: newAssets, costLines: newCostLines, skipped: skipped.length },
      });
    });
  } catch (error) {
    return {
      stage: "error",
      message: error instanceof Error ? error.message : "The import failed and nothing was saved.",
    };
  }

  revalidatePath("/clients");
  revalidatePath("/dashboard");
  return {
    stage: "done",
    created: { clients: newClients, assets: newAssets, costLines: newCostLines },
    skipped,
  };
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function stripCurrencySymbols(value: string): string {
  return value.replace(/[^\d.,-]/g, "");
}

function readCycle(value: string | undefined): BillingCycle {
  const raw = (value ?? "").trim().toLowerCase();
  if (isBillingCycle(raw)) return raw;
  if (/year|annual|yr|12/.test(raw)) return "annual";
  if (/quarter|3\s*month/.test(raw)) return "quarterly";
  if (/half|semi|6\s*month/.test(raw)) return "semiannual";
  if (/month|mo\b/.test(raw)) return "monthly";
  if (/one|once|single/.test(raw)) return "once";
  return "monthly";
}

function readParty(value: string | undefined): Party {
  const raw = (value ?? "").trim().toLowerCase();
  if (/client|customer|them/.test(raw)) return "client";
  if (/me|us|agency|own|self/.test(raw)) return "agency";
  if (/third|other|vendor/.test(raw)) return "third_party";
  return "unknown";
}

function guessKind(label: string, identifier: string): AssetKind {
  const text = `${label} ${identifier}`.toLowerCase();
  if (/^\s*[\w-]+(\.[\w-]+)+\s*$/.test(label) && !/\//.test(label)) return "domain";
  if (/\bssl|certificate|cert\b/.test(text)) return "certificate";
  if (/\bvps|server|droplet|instance\b/.test(text)) return "server";
  if (/\bhosting|shared|cpanel\b/.test(text)) return "hosting";
  if (/\bmail|email|mailbox\b/.test(text)) return "email";
  if (/\bdns|cloudflare\b/.test(text)) return "dns";
  return "other";
}

/** Accept the date formats spreadsheets actually produce. */
function normaliseDate(value: string): string | null {
  const trimmed = value.trim();
  if (isIsoDate(trimmed)) return trimmed;

  const slash = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (slash) {
    const [, a, b, year] = slash as unknown as [string, string, string, string];
    // Ambiguous between day-first and month-first. If one value is above 12 it
    // must be the day; otherwise assume day-first, which is the majority of
    // the world and of this product's likely users.
    const first = Number(a);
    const second = Number(b);
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return isIsoDate(iso) ? iso : null;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}
