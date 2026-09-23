"use client";

import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "@/components/icons";

export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "stackkeeper-theme";

/**
 * The script that runs before the page paints.
 *
 * Without it there is a flash: the server sends markup with no theme attribute,
 * the browser paints it light, and then React hydrates and switches to dark.
 * This reads the stored choice and sets the attribute during head parsing, so
 * the first paint is already correct. It is deliberately tiny and dependency
 * free, because nothing else has loaded yet.
 *
 * `system` stores nothing and sets nothing: with no attribute the stylesheet's
 * `prefers-color-scheme` block decides, which is what "system" means.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
  try {
    if (theme === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Private browsing, or storage disabled. The choice still applies for this
    // page; it just will not be remembered. Not worth telling anyone about.
  }
}

function stored(): Theme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Same as above.
  }
  return "system";
}

const OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * Three real radio inputs rather than a cycling button, so the current choice
 * is visible without clicking and reachable with arrow keys.
 */
export function ThemeToggle() {
  // Starts at "system" on the server and on the first client render so the
  // markup matches; the effect corrects it once the DOM is available. Reading
  // localStorage during render would be a hydration mismatch.
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme(stored());
  }, []);

  return (
    <fieldset className="theme-toggle">
      <legend className="visually-hidden">Appearance</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className="theme-option" title={option.label}>
          <input
            type="radio"
            name="theme"
            value={option.value}
            checked={theme === option.value}
            onChange={() => {
              setTheme(option.value);
              apply(option.value);
            }}
          />
          <span aria-hidden="true">
            {option.value === "light" ? (
              <SunIcon />
            ) : option.value === "dark" ? (
              <MoonIcon />
            ) : (
              <MonitorIcon />
            )}
          </span>
          <span className="visually-hidden">{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
