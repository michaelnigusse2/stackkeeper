"use client";

import { useActionState } from "react";
import { ASSET_IMPORT_FIELDS } from "@stackkeeper/core";
import {
  commitImportAction, previewImportAction, type ImportState,
} from "@/lib/actions/import";
import { SubmitButton } from "./submit-button";

const FIELD_LABELS: Record<string, string> = {
  client: "Client name",
  label: "Asset name",
  kind: "Type",
  provider: "Provider",
  identifier: "Address or identifier",
  expiresAt: "Expiry date",
  costAmount: "What it costs you",
  costCurrency: "Cost currency",
  costCycle: "Billing cycle",
  chargeAmount: "What the client pays",
  accountOwner: "Account owner",
  notes: "Notes",
};

const REQUIRED = new Set(["client", "label"]);

export function ImportWizard() {
  const [preview, previewAction] = useActionState<ImportState, FormData>(previewImportAction, {
    stage: "start",
  });
  const [result, commitAction] = useActionState<ImportState, FormData>(commitImportAction, {
    stage: "start",
  });

  if (result.stage === "done") {
    return (
      <div>
        <p className="notice ok" role="status">
          Imported {result.created.assets} asset(s) across {result.created.clients} new client(s),
          with {result.created.costLines} cost line(s).
        </p>
        {result.skipped.length > 0 ? (
          <>
            <h3>Rows that needed attention</h3>
            <ul className="small muted">
              {result.skipped.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </>
        ) : null}
        <p><a className="button primary" href="/clients">See your clients</a></p>
      </div>
    );
  }

  if (preview.stage === "preview") {
    return (
      <form action={commitAction} className="stack" style={{ maxInlineSize: "none" }}>
        <input type="hidden" name="csvText" value={preview.csvText} />

        {result.stage === "error" ? (
          <p className="notice error" role="alert">{result.message}</p>
        ) : null}

        <h2>Check the columns</h2>
        <p className="muted small">
          {preview.totalRows} row(s) found. Client name and asset name are required; leave anything
          else unmapped to skip it.
        </p>

        <div className="field-row">
          {Object.keys(ASSET_IMPORT_FIELDS).map((field) => (
            <div className="field" key={field}>
              <label htmlFor={`map-${field}`}>
                {FIELD_LABELS[field] ?? field}
                {REQUIRED.has(field) ? " *" : ""}
              </label>
              <select
                id={`map-${field}`}
                name={`map.${field}`}
                defaultValue={preview.mapping[field] ?? -1}
              >
                <option value={-1}>Not imported</option>
                {preview.headers.map((header, index) => (
                  <option key={`${header}-${index}`} value={index}>{header}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <h3>First few rows</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>{preview.headers.map((h, i) => <th key={`${h}-${i}`} scope="col">{h}</th>)}</tr>
            </thead>
            <tbody>
              {preview.sample.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {preview.headers.map((_, columnIndex) => (
                    <td key={columnIndex} className="small">{row[columnIndex] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="actions">
          <SubmitButton pendingLabel="Importing…">Import {preview.totalRows} row(s)</SubmitButton>
        </div>
      </form>
    );
  }

  return (
    <form action={previewAction} className="stack">
      {preview.stage === "error" ? (
        <p className="notice error" role="alert">{preview.message}</p>
      ) : null}

      <div className="field">
        <label htmlFor="file">CSV file</label>
        <input id="file" name="file" type="file" accept=".csv,text/csv,text/plain" />
        <p className="hint">Up to 2 MB. Comma, semicolon or tab separated.</p>
      </div>

      <div className="field">
        <label htmlFor="csvText">Or paste rows</label>
        <textarea
          id="csvText"
          name="csvText"
          placeholder={"Client,Domain,Registrar,Renewal,Cost\nAcme,acme.com,Namecheap,2027-01-15,12.00"}
        />
      </div>

      <div className="actions">
        <SubmitButton pendingLabel="Reading…">Preview</SubmitButton>
      </div>
    </form>
  );
}
