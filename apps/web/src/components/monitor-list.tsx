"use client";

import { useMemo, useState } from "react";
import { MonitorRow, type MonitorSummary } from "@/components/monitor-row";
import { ColumnsIcon, SearchIcon } from "@/components/icons";

export interface MonitorListRow {
  monitor: MonitorSummary;
  payload: Record<string, unknown> | null;
  assetLabel: string | null;
  clientId: string | null;
}

type Filter = "all" | "attention" | "unchecked";

/**
 * The monitors list view.
 *
 * Filtering happens here rather than on the server because the whole list is
 * already loaded — there are tens of monitors, not thousands — and a filter
 * that needs a round trip is a filter people stop using. If this ever grows
 * past a few hundred rows it should move to the query, and the state below is
 * deliberately shaped like query parameters so that move is a small one.
 */
export function MonitorList({ rows }: { rows: readonly MonitorListRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "attention") {
        const state = row.monitor.state;
        if (!(state === "critical" || state === "warning" || state === "error")) return false;
      }
      if (filter === "unchecked" && row.monitor.lastCheckedAt !== null) return false;

      if (needle === "") return true;
      const haystack = [row.monitor.target, row.assetLabel ?? "", row.monitor.kind]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, query, filter]);

  return (
    <>
      <div className="filters">
        <div className="filter-search">
          <SearchIcon size={14} />
          <label htmlFor="monitor-filter" className="visually-hidden">
            Filter this list
          </label>
          <input
            id="monitor-filter"
            type="search"
            placeholder="Filter this list"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <button
          type="button"
          className="chip"
          aria-pressed={filter === "attention"}
          onClick={() => setFilter(filter === "attention" ? "all" : "attention")}
        >
          Needs attention
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={filter === "unchecked"}
          onClick={() => setFilter(filter === "unchecked" ? "all" : "unchecked")}
        >
          Never checked
        </button>

        <span className="grow" />

        <span className="small faint">
          {shown.length === rows.length
            ? `${rows.length} monitor${rows.length === 1 ? "" : "s"}`
            : `${shown.length} of ${rows.length} shown`}
        </span>
        <span className="icon-button" aria-hidden="true" title="Columns are fixed for now">
          <ColumnsIcon />
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="muted">
          Nothing matches. {query ? "Try a shorter search" : "Clear the filter"} to see the rest.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Target</th>
                <th scope="col">Watching</th>
                <th scope="col">Asset</th>
                <th scope="col">Last check</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <MonitorRow
                  key={row.monitor.id}
                  monitor={row.monitor}
                  payload={row.payload}
                  assetLabel={row.assetLabel}
                  clientId={row.clientId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
