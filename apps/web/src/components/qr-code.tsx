import { encodeQr, qrSvgPath } from "@stackkeeper/core";

/**
 * A QR code as inline SVG. Always dark on white, whatever the theme, because
 * most phone scanners cannot read a light-on-dark code. Renders nothing if the
 * text is too long to encode, so the caller's typed-in fallback still works.
 */
export function QrCode({ text, label, size = 200 }: { text: string; label: string; size?: number }) {
  let path: string;
  let modules: number;
  try {
    const code = encodeQr(text);
    path = qrSvgPath(code);
    modules = code.size + 8;
  } catch {
    return null;
  }
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
    >
      <rect width={modules} height={modules} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
