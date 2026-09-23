import type { BillingCycle } from "@stackkeeper/core";
import type { Sql } from "../sql.ts";
import type { CostLineRow } from "../types.ts";
import { toIsoDate, toMinorUnits } from "../types.ts";

export interface CostLineInput {
  assetId: string;
  costAmount: number;
  costCurrency: string;
  costCycle: BillingCycle;
  chargeAmount?: number | null;
  chargeCurrency?: string | null;
  chargeCycle?: BillingCycle | null;
  billed?: boolean;
  billedVia?: string | null;
  nextRenewal?: string | null;
  startedOn?: string | null;
  endedOn?: string | null;
  note?: string | null;
}

/** A cost line in the shape the margin calculator expects. */
export interface CostLineForMargin {
  id: string;
  assetId: string;
  costAmount: number;
  costCurrency: string;
  costCycle: BillingCycle;
  chargeAmount: number | null;
  chargeCurrency: string | null;
  chargeCycle: BillingCycle | null;
  billed: boolean;
  startedOn: string | null;
  endedOn: string | null;
}

export function toMarginInput(row: CostLineRow): CostLineForMargin {
  return {
    id: row.id,
    assetId: row.asset_id,
    costAmount: toMinorUnits(row.cost_amount) as number,
    costCurrency: row.cost_currency,
    costCycle: row.cost_cycle,
    chargeAmount: toMinorUnits(row.charge_amount),
    chargeCurrency: row.charge_currency,
    chargeCycle: row.charge_cycle,
    billed: row.billed,
    startedOn: toIsoDate(row.started_on),
    endedOn: toIsoDate(row.ended_on),
  };
}

export async function listCostLinesForAsset(tx: Sql, assetId: string): Promise<CostLineRow[]> {
  return tx<CostLineRow[]>`
    select * from app.cost_line where asset_id = ${assetId} order by created_at
  `;
}

/** Every cost line for a client, joined through its assets. */
export async function listCostLinesForClient(
  tx: Sql,
  orgId: string,
  clientId: string,
): Promise<CostLineRow[]> {
  return tx<CostLineRow[]>`
    select cl.*
    from app.cost_line cl
    join app.asset a on a.org_id = cl.org_id and a.id = cl.asset_id
    where cl.org_id = ${orgId}
      and a.client_id = ${clientId}
      and a.deleted_at is null
    order by cl.created_at
  `;
}

export async function listCostLines(tx: Sql, orgId: string): Promise<CostLineRow[]> {
  return tx<CostLineRow[]>`
    select cl.*
    from app.cost_line cl
    join app.asset a on a.org_id = cl.org_id and a.id = cl.asset_id
    where cl.org_id = ${orgId} and a.deleted_at is null
    order by cl.created_at
  `;
}

export async function createCostLine(
  tx: Sql,
  orgId: string,
  input: CostLineInput,
): Promise<CostLineRow> {
  const rows = await tx<CostLineRow[]>`
    insert into app.cost_line (
      org_id, asset_id, cost_amount, cost_currency, cost_cycle,
      charge_amount, charge_currency, charge_cycle,
      billed, billed_via, next_renewal, started_on, ended_on, note
    ) values (
      ${orgId}, ${input.assetId}, ${input.costAmount}, ${input.costCurrency}, ${input.costCycle},
      ${input.chargeAmount ?? null}, ${input.chargeCurrency ?? null}, ${input.chargeCycle ?? null},
      ${input.billed ?? false}, ${input.billedVia ?? null}, ${input.nextRenewal ?? null},
      ${input.startedOn ?? null}, ${input.endedOn ?? null}, ${input.note ?? null}
    )
    returning *
  `;
  const created = rows[0];
  if (!created) throw new Error("Cost line insert returned no row");
  return created;
}

export async function updateCostLine(
  tx: Sql,
  id: string,
  input: Omit<CostLineInput, "assetId">,
): Promise<CostLineRow | null> {
  const rows = await tx<CostLineRow[]>`
    update app.cost_line set
      cost_amount = ${input.costAmount},
      cost_currency = ${input.costCurrency},
      cost_cycle = ${input.costCycle},
      charge_amount = ${input.chargeAmount ?? null},
      charge_currency = ${input.chargeCurrency ?? null},
      charge_cycle = ${input.chargeCycle ?? null},
      billed = ${input.billed ?? false},
      billed_via = ${input.billedVia ?? null},
      next_renewal = ${input.nextRenewal ?? null},
      started_on = ${input.startedOn ?? null},
      ended_on = ${input.endedOn ?? null},
      note = ${input.note ?? null}
    where id = ${id}
    returning *
  `;
  return rows[0] ?? null;
}

export async function deleteCostLine(tx: Sql, id: string): Promise<boolean> {
  const rows = await tx`delete from app.cost_line where id = ${id} returning id`;
  return rows.length > 0;
}

export async function markBilled(tx: Sql, id: string, billed: boolean): Promise<boolean> {
  const rows = await tx`
    update app.cost_line set billed = ${billed} where id = ${id} returning id
  `;
  return rows.length > 0;
}

/** A cost line with the names the invoice summary prints beside it. */
export interface InvoiceLineRow extends CostLineRow {
  client_name: string;
  asset_label: string;
  asset_provider: string | null;
}

/**
 * Every cost line with its client and asset, for the monthly "what to
 * invoice" export. Deleted clients and assets are left out.
 */
export async function listInvoiceLines(tx: Sql, orgId: string): Promise<InvoiceLineRow[]> {
  return tx<InvoiceLineRow[]>`
    select cl.*,
           c.name as client_name,
           a.label as asset_label,
           a.provider as asset_provider
    from app.cost_line cl
    join app.asset a on a.org_id = cl.org_id and a.id = cl.asset_id
    join app.client c on c.org_id = a.org_id and c.id = a.client_id
    where cl.org_id = ${orgId}
      and a.deleted_at is null
      and c.deleted_at is null
    order by c.name, a.label
  `;
}

/** An invoice export row in the shape the summary in core expects. */
export function toInvoiceInput(row: InvoiceLineRow) {
  return {
    lineId: row.id,
    clientName: row.client_name,
    assetLabel: row.asset_label,
    provider: row.asset_provider,
    costAmount: toMinorUnits(row.cost_amount) as number,
    costCurrency: row.cost_currency,
    costCycle: row.cost_cycle,
    chargeAmount: toMinorUnits(row.charge_amount),
    chargeCurrency: row.charge_currency,
    chargeCycle: row.charge_cycle,
    billed: row.billed,
    nextRenewal: toIsoDate(row.next_renewal),
    startedOn: toIsoDate(row.started_on),
    endedOn: toIsoDate(row.ended_on),
    note: row.note,
  };
}
