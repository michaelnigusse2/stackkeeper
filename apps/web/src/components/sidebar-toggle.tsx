"use client";

import { useEffect, useState } from "react";
import { PanelIcon } from "@/components/icons";

export const NAV_STORAGE_KEY = "stackkeeper-nav";

/**
 * Runs before the page paints, like the theme script and for the same reason.
 *
 * The sidebar's width is a custom property, so if this waited for React the
 * page would render 240px wide, hydrate, and then jump to 56px. Setting the
 * attribute during head parsing means the first paint is already the right
 * shape.
 */
export const NAV_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(
  NAV_STORAGE_KEY,
)})==="collapsed"){document.documentElement.setAttribute("data-nav","collapsed");}}catch(e){}})();`;

function collapsed(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-nav") === "collapsed";
}

/**
 * Opens and closes the sidebar.
 *
 * It flips an attribute on <html> and lets CSS do the layout. No state drives
 * the width, so there is nothing to keep in sync and nothing to mismatch on
 * hydration; the component's own state exists only to label the button.
 */
export function SidebarToggle() {
  const [isCollapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(collapsed());
  }, []);

  function toggle() {
    const next = !collapsed();
    const root = document.documentElement;
    if (next) {
      root.setAttribute("data-nav", "collapsed");
    } else {
      root.removeAttribute("data-nav");
    }
    try {
      localStorage.setItem(NAV_STORAGE_KEY, next ? "collapsed" : "expanded");
    } catch {
      // Private browsing. The choice holds for this page and is simply not
      // remembered, which is not worth telling anyone about.
    }
    setCollapsed(next);
  }

  return (
    <button
      type="button"
      className="sidebar-toggle"
      onClick={toggle}
      aria-expanded={!isCollapsed}
      title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      <PanelIcon />
      <span className="visually-hidden">
        {isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      </span>
    </button>
  );
}

/** Opens the sidebar if it is closed. Used by the search shortcut. */
export function expandSidebar() {
  document.documentElement.removeAttribute("data-nav");
  try {
    localStorage.setItem(NAV_STORAGE_KEY, "expanded");
  } catch {
    // As above.
  }
}
