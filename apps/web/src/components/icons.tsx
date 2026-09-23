/**
 * The icon set.
 *
 * Inline stroke SVG rather than an icon package: there are about fifteen of
 * them, they never change, and a dependency that ships three thousand icons to
 * use fifteen is not worth the install. They inherit `currentColor`, so an
 * icon is coloured by colouring its container.
 *
 * All drawn on a 24px grid at stroke 1.7-1.9 so they sit together evenly.
 */

type IconProps = {
  size?: number;
  className?: string;
};

function svg(size: number, className: string | undefined, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function SearchIcon({ size = 15, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" />
    </>,
  );
}

export function BellIcon({ size = 18, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10.4 21a2 2 0 0 0 3.2 0" />
    </>,
  );
}

export function ChevronDownIcon({ size = 13, className }: IconProps) {
  return svg(size, className, <path d="M6 9l6 6 6-6" />);
}

export function ChevronUpIcon({ size = 13, className }: IconProps) {
  return svg(size, className, <path d="M18 15l-6-6-6 6" />);
}

export function PlusIcon({ size = 13, className }: IconProps) {
  return svg(size, className, <path d="M12 5v14M5 12h14" />);
}

export function WarningIcon({ size = 17, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M12 4.6 2.9 20h18.2z" />
      <path d="M12 10.2v4.4" />
      <path d="M12 17.4h.01" />
    </>,
  );
}

export function GlobeIcon({ size = 17, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M3.4 12h17.2" />
      <path d="M12 3.4c2.2 2.4 3.3 5.4 3.3 8.6S14.2 18.2 12 20.6c-2.2-2.4-3.3-5.4-3.3-8.6S9.8 5.8 12 3.4z" />
    </>,
  );
}

export function ServerIcon({ size = 17, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <rect x="3.6" y="4.6" width="16.8" height="6" rx="1.6" />
      <rect x="3.6" y="13.4" width="16.8" height="6" rx="1.6" />
      <path d="M7.2 7.6h.01M7.2 16.4h.01" />
    </>,
  );
}

export function ShieldIcon({ size = 17, className }: IconProps) {
  return svg(size, className, <path d="M12 3l7.6 3v6c0 4.5-3 7.9-7.6 9-4.6-1.1-7.6-4.5-7.6-9V6z" />);
}

export function LockIcon({ size = 15, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7.4a4 4 0 0 1 8 0v3.1" />
    </>,
  );
}

export function BuildingIcon({ size = 17, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M4 20V6.5L12 3.5v17" />
      <path d="M12 9.5h7.5V20" />
      <path d="M2.5 20h19" />
      <path d="M7.4 9h1.2M7.4 12.4h1.2M7.4 15.8h1.2M15.3 13h1.2M15.3 16.4h1.2" />
    </>,
  );
}

export function FolderIcon({ size = 17, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M3.5 7.5h6l2 2.5h9V19a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19z" />
      <path d="M3.5 7.5V5.5A1.5 1.5 0 0 1 5 4h4" />
    </>,
  );
}

export function ClockIcon({ size = 17, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.2V12l3.2 1.9" />
    </>,
  );
}

export function ColumnsIcon({ size = 15, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <rect x="4" y="4.5" width="16" height="15" rx="1.8" />
      <path d="M10 4.5v15M15 4.5v15" />
    </>,
  );
}

export function SunIcon({ size = 15, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </>,
  );
}

export function MoonIcon({ size = 15, className }: IconProps) {
  return svg(size, className, <path d="M20 13.4A8.2 8.2 0 0 1 10.6 4a8.4 8.4 0 1 0 9.4 9.4z" />);
}

export function MonitorIcon({ size = 15, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </>,
  );
}

export function HomeIcon({ size = 17, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M3.5 10.2 12 3.6l8.5 6.6V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z" />
      <path d="M9.6 20.5v-6h4.8v6" />
    </>,
  );
}

/** Monitors: a heartbeat, because what it shows is liveness over time. */
export function PulseIcon({ size = 17, className }: IconProps) {
  return svg(size, className, <path d="M2.8 12h3.6l2.2-5.6 3.4 11.2 2.4-5.6h6.8" />);
}

export function ImportIcon({ size = 17, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M12 3.6v10.2" />
      <path d="M8.2 10.2 12 14l3.8-3.8" />
      <path d="M4.5 16.4v2.6a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.6" />
    </>,
  );
}

export function SettingsIcon({ size = 17, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.1 14.4a1.6 1.6 0 0 0 .32 1.76l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.06-.06a1.6 1.6 0 0 0-1.76-.32 1.6 1.6 0 0 0-.97 1.46v.17a1.9 1.9 0 1 1-3.8 0v-.09a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.76.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.46-.97h-.17a1.9 1.9 0 1 1 0-3.8h.09a1.6 1.6 0 0 0 1.46-1.05 1.6 1.6 0 0 0-.32-1.76l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.76.32h.08a1.6 1.6 0 0 0 .97-1.46v-.17a1.9 1.9 0 1 1 3.8 0v.09a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.76-.32l.06-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.76v.08a1.6 1.6 0 0 0 1.46.97h.17a1.9 1.9 0 1 1 0 3.8h-.09a1.6 1.6 0 0 0-1.46.97z" />
    </>,
  );
}

/** The collapse control: a panel with its side rail marked. */
export function PanelIcon({ size = 16, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </>,
  );
}

/** The vertical three-dot row action. Filled, not stroked, so it reads at 15px. */
export function KebabIcon({ size = 15, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}

/** Picks the icon that suits an asset or monitor kind. */
export function KindIcon({ kind, size = 17, className }: IconProps & { kind: string }) {
  if (kind === "domain") return <GlobeIcon size={size} className={className} />;
  if (kind === "tls" || kind === "certificate") return <ShieldIcon size={size} className={className} />;
  if (kind === "server") return <ServerIcon size={size} className={className} />;
  return <FolderIcon size={size} className={className} />;
}
