import type { FxRate } from "@stackkeeper/core";
import type { Sql } from "../sql.ts";

/**
 * Exchange rates are global reference data, written by the worker through the
 * owner connection and readable by every tenant. They carry no org_id and so
 * have no row-level security policy.
 */
export async function latestRates(tx: Sql): Promise<FxRate[]> {
  const rows = await tx<Array<{ as_of: string; base: string; quote: string; rate: string }>>`
    select distinct on (base, quote) as_of, base, quote, rate
    from app.fx_rate
    order by base, quote, as_of desc
  `;
  return rows.map((row) => ({
    asOf: String(row.as_of).slice(0, 10),
    base: row.base,
    quote: row.quote,
    rate: Number(row.rate),
  }));
}

export async function upsertRate(
  ownerTx: Sql,
  asOf: string,
  base: string,
  quote: string,
  rate: number,
): Promise<void> {
  await ownerTx`
    insert into app.fx_rate (as_of, base, quote, rate)
    values (${asOf}::date, ${base}, ${quote}, ${rate})
    on conflict (as_of, base, quote) do update set rate = excluded.rate
  `;
}
