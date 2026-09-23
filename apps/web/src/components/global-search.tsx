"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BuildingIcon, FolderIcon, KindIcon, SearchIcon } from "@/components/icons";
import { expandSidebar } from "@/components/sidebar-toggle";

interface Hit {
  kind: "client" | "project" | "asset";
  id: string;
  label: string;
  context: string | null;
  client_id: string | null;
}

const MIN_LENGTH = 2;

/** Wait this long after the last keystroke before asking the server. */
const DEBOUNCE_MS = 180;

function hrefFor(hit: Hit): string {
  if (hit.kind === "client") return `/clients/${hit.id}`;
  if (hit.kind === "project") return `/projects/${hit.id}`;
  if (hit.client_id) return `/clients/${hit.client_id}/assets/${hit.id}`;
  return "/clients";
}

/**
 * Search across clients, projects and assets.
 *
 * Debounced rather than fired per keystroke, and every request carries an
 * AbortSignal: typing "north" quickly would otherwise start five requests, and
 * without cancellation the slowest one wins and overwrites the newest results
 * with results for "nor".
 */
export function GlobalSearch() {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const wrapper = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const query = term.trim();
    if (query.length < MIN_LENGTH) {
      setHits([]);
      setBusy(false);
      return;
    }

    const controller = new AbortController();
    setBusy(true);

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          setHits([]);
          return;
        }
        const body = (await response.json()) as { hits?: Hit[] };
        setHits(body.hits ?? []);
        setCursor(-1);
      } catch {
        // An abort is the normal path when someone keeps typing, and a network
        // failure should not put an error banner over a search box. Either way
        // the list simply stays as it was.
      } finally {
        setBusy(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term]);

  // The shortcut. With the sidebar collapsed the field is not rendered wide
  // enough to use, so the rail opens first and focus follows on the next
  // frame, once the width transition has started and the input is laid out.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      expandSidebar();
      setOpen(true);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close on a click elsewhere.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  const showing = open && term.trim().length >= MIN_LENGTH;

  return (
    <div className="header-search" ref={wrapper}>
      <SearchIcon />
      <label htmlFor="global-search" className="visually-hidden">
        Search clients, projects and assets
      </label>
      <input
        id="global-search"
        className="search-field"
        ref={input}
        type="search"
        autoComplete="off"
        placeholder="Search clients, domains, assets"
        value={term}
        role="combobox"
        aria-expanded={showing}
        aria-controls="global-search-results"
        aria-autocomplete="list"
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (!showing || hits.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setCursor((c) => (c + 1) % hits.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setCursor((c) => (c <= 0 ? hits.length - 1 : c - 1));
          } else if (event.key === "Enter") {
            const hit = hits[cursor] ?? hits[0];
            if (hit) {
              event.preventDefault();
              setOpen(false);
              router.push(hrefFor(hit));
            }
          }
        }}
      />

      {term ? null : (
        <span className="search-hint" aria-hidden="true">
          &#8984;K
        </span>
      )}

      {showing ? (
        <div className="search-results" id="global-search-results" role="listbox">
          {hits.length === 0 ? (
            <p className="search-empty">
              {busy ? "Searching…" : `Nothing matches “${term.trim()}”.`}
            </p>
          ) : (
            hits.map((hit, index) => (
              <Link
                key={`${hit.kind}-${hit.id}`}
                href={hrefFor(hit)}
                role="option"
                aria-selected={index === cursor}
                className={index === cursor ? "search-hit active" : "search-hit"}
                onClick={() => setOpen(false)}
                onMouseEnter={() => setCursor(index)}
              >
                <span className="search-hit-icon" aria-hidden="true">
                  {hit.kind === "client" ? (
                    <BuildingIcon size={15} />
                  ) : hit.kind === "project" ? (
                    <FolderIcon size={15} />
                  ) : (
                    <KindIcon kind="asset" size={15} />
                  )}
                </span>
                <span className="grow">
                  <span className="search-hit-label">{hit.label}</span>
                  {hit.context ? <span className="sub">{hit.context}</span> : null}
                </span>
                <span className="search-hit-kind">{hit.kind}</span>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
