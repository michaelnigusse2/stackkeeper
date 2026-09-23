import type { Metadata } from "next";
import { THEME_SCRIPT } from "@/components/theme-toggle";
import { NAV_SCRIPT } from "@/components/sidebar-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stackkeeper",
  description:
    "Track every client's servers, domains and renewals, what they cost you and what you charge.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Loaded over the network rather than bundled, so a build does not
         * fail when the font host is unreachable. The stylesheet's font stack
         * falls back to the system sans, which is a fine second choice. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,400..700;1,400..700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        {/* Sets the theme during head parsing, before anything paints. See the
         * comment on THEME_SCRIPT for why this cannot wait for React.
         * `suppressHydrationWarning` on <html> is required because this script
         * changes an attribute the server did not render. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + NAV_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
