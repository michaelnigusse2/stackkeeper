/**
 * QR codes, drawn without a dependency.
 *
 * Used to put an otpauth:// URI on screen when two-factor is set up, so a
 * phone can scan it instead of typing a 32-character key. The core package
 * has no dependencies on purpose, and a QR encoder for this one job is small:
 * byte mode, error correction level M (15% of the code can be damaged and it
 * still scans), versions 1 to 15, which holds up to 412 bytes.
 *
 * The layout follows ISO/IEC 18004. The tests round-trip codes through a
 * real decoder at every version, with every mask.
 */

/** [error-correction codewords per block, group-1 blocks, group-1 data codewords, group-2 blocks, group-2 data codewords] */
type BlockLayout = readonly [number, number, number, number, number];

/** Error correction level M, versions 1 to 15. Index 0 is unused. */
const LEVEL_M: readonly BlockLayout[] = [
  [0, 0, 0, 0, 0],
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
  [30, 1, 50, 4, 51],
  [22, 6, 36, 2, 37],
  [22, 8, 37, 1, 38],
  [24, 4, 40, 5, 41],
  [24, 5, 41, 5, 42],
];

/** Centres of the alignment patterns, per version. */
const ALIGNMENT: readonly (readonly number[])[] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42],
  [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
  [6, 26, 48, 70],
];

export const QR_MAX_VERSION = 15;

export class QrError extends Error {}

export interface QrCode {
  readonly version: number;
  /** Modules per side, without the quiet zone. */
  readonly size: number;
  /** modules[row][column], true for dark. */
  readonly modules: readonly (readonly boolean[])[];
  readonly mask: number;
}

function layout(version: number): BlockLayout {
  const entry = LEVEL_M[version];
  if (!entry) throw new QrError(`Unsupported QR version ${version}`);
  return entry;
}

function dataCodewords(version: number): number {
  const [, blocks1, data1, blocks2, data2] = layout(version);
  return blocks1 * data1 + blocks2 * data2;
}

// --- Reed-Solomon over GF(256), polynomial 0x11d -----------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] as number;
}

function multiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] as number) + (LOG[b] as number)] as number;
}

/** Generator polynomial of the given degree, highest power first. */
function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      const coefficient = poly[j] as number;
      next[j] = (next[j] as number) ^ coefficient;
      next[j + 1] = (next[j + 1] as number) ^ multiply(coefficient, EXP[i] as number);
    }
    poly = next;
  }
  return poly;
}

function errorCorrection(data: readonly number[], degree: number): number[] {
  const gen = generator(degree);
  const remainder = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (remainder[0] as number);
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < degree; i++) {
      remainder[i] = (remainder[i] as number) ^ multiply(gen[i + 1] as number, factor);
    }
  }
  return remainder;
}

// --- Data -------------------------------------------------------------------

function chooseVersion(byteLength: number): number {
  for (let version = 1; version <= QR_MAX_VERSION; version++) {
    const countBits = version < 10 ? 8 : 16;
    if (4 + countBits + byteLength * 8 <= dataCodewords(version) * 8) return version;
  }
  throw new QrError(`Too long for a QR code here: ${byteLength} bytes`);
}

function encodeData(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);

  const capacity = dataCodewords(version);
  push(0, Math.min(4, capacity * 8 - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | (bits[i + j] as number);
    codewords.push(value);
  }
  for (let pad = 0xec; codewords.length < capacity; pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

/** Split into blocks, add error correction to each, and interleave. */
function interleave(data: readonly number[], version: number): number[] {
  const [ecLength, blocks1, data1, blocks2, data2] = layout(version);
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (let i = 0; i < blocks1 + blocks2; i++) {
    const length = i < blocks1 ? data1 : data2;
    const block = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: block, ec: errorCorrection(block, ecLength) });
  }
  const out: number[] = [];
  for (let i = 0; i < Math.max(data1, data2); i++) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i] as number);
  }
  for (let i = 0; i < ecLength; i++) {
    for (const block of blocks) out.push(block.ec[i] as number);
  }
  return out;
}

// --- Matrix -----------------------------------------------------------------

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly reserved: boolean[][];

  constructor(size: number) {
    this.size = size;
    this.dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  /** A function module: part of the fixed layout, never data or masked. */
  set(x: number, y: number, dark: boolean): void {
    (this.dark[y] as boolean[])[x] = dark;
    (this.reserved[y] as boolean[])[x] = true;
  }
}

function drawFinder(grid: Grid, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      grid.set(x, y, distance !== 2 && distance !== 4);
    }
  }
}

function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // level M is 00
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

function drawFormat(grid: Grid, mask: number): void {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const size = grid.size;
  for (let i = 0; i <= 5; i++) grid.set(8, i, bit(i));
  grid.set(8, 7, bit(6));
  grid.set(8, 8, bit(7));
  grid.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) grid.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) grid.set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) grid.set(8, size - 15 + i, bit(i));
  grid.set(8, size - 8, true); // the dark module
}

function drawVersion(grid: Grid, version: number): void {
  if (version < 7) return;
  let remainder = version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  const bits = (version << 12) | remainder;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    grid.set(a, b, dark);
    grid.set(b, a, dark);
  }
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.size;
  for (let i = 0; i < size; i++) {
    grid.set(6, i, i % 2 === 0);
    grid.set(i, 6, i % 2 === 0);
  }
  drawFinder(grid, 3, 3);
  drawFinder(grid, size - 4, 3);
  drawFinder(grid, 3, size - 4);

  const centres = ALIGNMENT[version] ?? [];
  const last = centres.length - 1;
  centres.forEach((cy, i) => {
    centres.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          grid.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });

  drawFormat(grid, 0); // reserves the area; redrawn once the mask is chosen
  drawVersion(grid, version);
}

function placeData(grid: Grid, codewords: readonly number[]): void {
  const size = grid.size;
  let index = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if ((grid.reserved[y] as boolean[])[x]) continue;
        let dark = false;
        if (index < total) {
          dark = (((codewords[index >>> 3] as number) >>> (7 - (index & 7))) & 1) === 1;
        }
        (grid.dark[y] as boolean[])[x] = dark;
        index++;
      }
    }
  }
}

function masked(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(grid: Grid, mask: number): void {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      const row = grid.dark[y] as boolean[];
      if (!(grid.reserved[y] as boolean[])[x] && masked(mask, x, y)) row[x] = !row[x];
    }
  }
}

const FINDER_LIKE = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
];

/** The standard penalty score; lower scans more reliably. */
function penalty(dark: readonly (readonly boolean[])[]): number {
  const size = dark.length;
  const at = (x: number, y: number) => (dark[y] as readonly boolean[])[x] as boolean;
  let score = 0;

  for (let pass = 0; pass < 2; pass++) {
    const get = pass === 0 ? (a: number, b: number) => at(b, a) : (a: number, b: number) => at(a, b);
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        if (get(a, b) === get(a, b - 1)) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
      for (let b = 0; b + 11 <= size; b++) {
        for (const pattern of FINDER_LIKE) {
          if (pattern.every((value, k) => get(a, b + k) === value)) score += 40;
        }
      }
    }
  }

  let darkCount = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (at(x, y)) darkCount++;
      if (x + 1 < size && y + 1 < size) {
        const colour = at(x, y);
        if (at(x + 1, y) === colour && at(x, y + 1) === colour && at(x + 1, y + 1) === colour) score += 3;
      }
    }
  }
  const percent = (darkCount * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/**
 * Encode text as a QR code. `mask` is for tests; normally the mask with the
 * lowest penalty is chosen, as the standard asks.
 */
export function encodeQr(text: string, options: { mask?: number } = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const codewords = interleave(encodeData(bytes, version), version);
  const size = 17 + version * 4;

  const build = (mask: number): Grid => {
    const grid = new Grid(size);
    drawFunctionPatterns(grid, version);
    placeData(grid, codewords);
    applyMask(grid, mask);
    drawFormat(grid, mask);
    return grid;
  };

  let best: { grid: Grid; mask: number } | null = null;
  if (options.mask !== undefined) {
    if (!Number.isInteger(options.mask) || options.mask < 0 || options.mask > 7) {
      throw new QrError(`Mask must be 0 to 7, got ${options.mask}`);
    }
    best = { grid: build(options.mask), mask: options.mask };
  } else {
    let bestScore = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < 8; mask++) {
      const grid = build(mask);
      const score = penalty(grid.dark);
      if (score < bestScore) {
        bestScore = score;
        best = { grid, mask };
      }
    }
  }
  const chosen = best as { grid: Grid; mask: number };
  return { version, size, modules: chosen.grid.dark, mask: chosen.mask };
}

/**
 * An SVG path of the dark modules, with a quiet zone of `quiet` modules on
 * every side. Draw it at viewBox 0 0 (size + 2 * quiet) on a light background.
 * Horizontal runs are merged, so a 49-module code is a few hundred segments.
 */
export function qrSvgPath(code: QrCode, quiet = 4): string {
  const parts: string[] = [];
  code.modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      parts.push(`M${start + quiet} ${y + quiet}h${x - start}v1h${start - x}z`);
    }
  });
  return parts.join("");
}
