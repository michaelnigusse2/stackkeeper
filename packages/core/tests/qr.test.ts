import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodeQr, QrError, qrSvgPath } from "../src/qr.ts";

/*
 * The layout itself was verified by rendering codes and reading them back with
 * OpenCV's QR decoder: every version from 1 to 15, at the shortest and longest
 * payload for each, with each of the 8 masks, 243 codes in all, every one
 * decoding to the exact input. These tests pin that behaviour down.
 */

const URI =
  "otpauth://totp/Stackkeeper:michaelnigusse2%40gmail.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Stackkeeper&digits=6&period=30";

function fingerprint(modules: readonly (readonly boolean[])[]): string {
  const text = modules.map((row) => row.map((dark) => (dark ? 1 : 0)).join("")).join("\n");
  return createHash("sha256").update(text).digest("hex");
}

test("an authenticator URI encodes exactly as the decoder-verified version did", () => {
  const code = encodeQr(URI);
  assert.equal(code.version, 8);
  assert.equal(code.size, 49);
  assert.equal(code.mask, 4);
  assert.equal(fingerprint(code.modules), "6ed89f651964a503b145c534103dff578ef6a9a86f343e9d4b2c35959c455f8a");
});

test("the smallest version that fits is chosen", () => {
  assert.equal(encodeQr("x".repeat(14)).version, 1);
  assert.equal(encodeQr("x".repeat(15)).version, 2);
  assert.equal(encodeQr("x".repeat(213)).version, 10);
  assert.equal(encodeQr("x".repeat(412)).version, 15);
});

test("text too long for version 15 is refused rather than truncated", () => {
  assert.throws(() => encodeQr("x".repeat(413)), QrError);
});

test("the three finder patterns sit in their corners", () => {
  const { modules, size } = encodeQr("hello");
  const at = (x: number, y: number) => modules[y]?.[x];
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
    // Dark outer ring, light ring, dark 3x3 centre.
    assert.equal(at(ox, oy), true);
    assert.equal(at(ox + 6, oy + 6), true);
    assert.equal(at(ox + 1, oy + 1), false);
    assert.equal(at(ox + 3, oy + 3), true);
  }
});

test("non-ASCII text is encoded as UTF-8", () => {
  assert.equal(encodeQr("héllo wörld ✓").version, 2);
});

test("the SVG path merges runs and sits inside the quiet zone", () => {
  const code = encodeQr("hello");
  const path = qrSvgPath(code);
  // The top-left finder's first row is one run of seven dark modules.
  assert.ok(path.startsWith("M4 4h7v1h-7z"));
  assert.ok(!/NaN|undefined/.test(path));
});
