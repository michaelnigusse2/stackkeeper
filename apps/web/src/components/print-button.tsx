"use client";

import { useEffect } from "react";

/**
 * Print, or save as PDF from the print dialog. The browser's own PDF output
 * needs no library and looks the same everywhere.
 *
 * Printing in the dark theme would put light text on white paper, because
 * browsers drop background colours when printing. So the page switches to the
 * light theme for the print, however it was started (this button or Ctrl+P),
 * and switches back afterwards.
 */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  useEffect(() => {
    const root = document.documentElement;
    let previous: string | null = null;
    const before = () => {
      previous = root.getAttribute("data-theme");
      root.setAttribute("data-theme", "light");
    };
    const after = () => {
      if (previous === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previous);
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  return (
    <button type="button" className="button primary" onClick={() => window.print()}>
      {label}
    </button>
  );
}
