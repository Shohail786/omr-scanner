/**
 * OMR (Optical Mark Recognition) engine.
 *
 * Pure client-side: takes an ImageData of a scanned/photographed answer sheet
 * and returns the darkened roll-number digits and the darkened answer options.
 *
 * Pipeline: grayscale -> Otsu threshold -> connected components ->
 * bubble candidate filtering -> grid clustering -> fill measurement.
 */

export type Option = "A" | "B" | "C" | "D";

export interface Bubble {
  cx: number;
  cy: number;
  r: number;
  fill: number;
  marked: boolean;
}

export interface AnswerResult {
  q: number;
  answer: Option | null;
  multiple: boolean;
  bubbles: Bubble[];
}

export interface OmrResult {
  width: number;
  height: number;
  threshold: number;
  rollNumber: string;
  rollBubbles: Bubble[];
  answers: AnswerResult[];
  optionCount: number;
  warnings: string[];
}

export interface OmrOptions {
  /** fill ratio above which a bubble counts as darkened (0-1) */
  markThreshold?: number;
  /** number of options per question */
  optionCount?: number;
  /** number of roll-number digit columns; 0 = auto */
  rollDigits?: number;
}

interface Comp {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
  cx: number;
  cy: number;
  r: number;
  fill: number;
}

function toGray(img: ImageData): Uint8Array {
  const { data, width, height } = img;
  const g = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    g[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return g;
}

function otsu(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0,
    wB = 0,
    best = 0,
    thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/** 8-connected component labelling over a binary (ink) mask. */
function components(mask: Uint8Array, width: number, height: number): Comp[] {
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const out: Comp[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let sp = 0;
    stack[sp++] = i;
    seen[i] = 1;
    let n = 0;
    let x0 = width,
      y0 = height,
      x1 = 0,
      y1 = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const py = (p / width) | 0;
      const px = p - py * width;
      n++;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    out.push({
      x0,
      y0,
      x1,
      y1,
      n,
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      r: (w + h) / 4,
      fill: 0,
    });
  }
  return out;
}

/**
 * Fraction of the circle outline that is covered by ink. Each angle is probed
 * across a thin band (0.7r - 1.05r) so both hand-drawn and printed rings pass,
 * while glyphs and speckles fail.
 */
function circularity(c: Comp, mask: Uint8Array, width: number, height: number) {
  const steps = 36;
  let hit = 0;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let found = false;
    for (let f = 0.7; f <= 1.06 && !found; f += 0.09) {
      const x = Math.round(c.cx + ca * c.r * f);
      const y = Math.round(c.cy + sa * c.r * f);
      if (x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x]) found = true;
    }
    if (found) hit++;
  }
  return hit / steps;
}

function measureFill(c: Comp, mask: Uint8Array, width: number, height: number) {
  const rr = Math.max(1.5, c.r * 0.5);
  const x0 = Math.max(0, Math.round(c.cx - rr));
  const x1 = Math.min(width - 1, Math.round(c.cx + rr));
  const y0 = Math.max(0, Math.round(c.cy - rr));
  const y1 = Math.min(height - 1, Math.round(c.cy + rr));
  let ink = 0,
    total = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      total++;
      if (mask[y * width + x]) ink++;
    }
  }
  return total ? ink / total : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Most common bubble radius (rounded to whole pixels, merged with neighbours). */
function modeRadius(items: { r: number }[]): number {
  const hist = new Map<number, number>();
  for (const c of items) {
    const k = Math.round(c.r);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  let best = 0;
  let bestScore = -1;
  for (const [k] of hist) {
    const score = (hist.get(k - 1) ?? 0) + (hist.get(k) ?? 0) + (hist.get(k + 1) ?? 0);
    if (score > bestScore || (score === bestScore && k > best)) {
      bestScore = score;
      best = k;
    }
  }
  const near = items.filter((c) => Math.abs(c.r - best) <= 1.2).map((c) => c.r);
  return median(near) || best;
}

function clusterBy<T>(items: T[], key: (t: T) => number, tol: number): T[][] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => key(a) - key(b));
  const groups: T[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const g = groups[groups.length - 1];
    if (key(sorted[i]) - key(g[g.length - 1]) <= tol) g.push(sorted[i]);
    else groups.push([sorted[i]]);
  }
  return groups;
}

const toBubble = (c: Comp, marked: boolean): Bubble => ({
  cx: c.cx,
  cy: c.cy,
  r: c.r,
  fill: c.fill,
  marked,
});

export function scanOmr(img: ImageData, opts: OmrOptions = {}): OmrResult {
  const markThreshold = opts.markThreshold ?? 0.6;
  const optionCount = opts.optionCount ?? 4;
  const { width, height } = img;
  const warnings: string[] = [];

  const gray = toGray(img);
  const threshold = Math.max(60, Math.min(200, otsu(gray) - 20));
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) mask[i] = gray[i] < threshold ? 1 : 0;

  const maxSize = Math.max(14, Math.round(Math.min(width, height) * 0.05));
  const minSize = Math.max(5, Math.round(Math.min(width, height) * 0.006));
  const candidates: Comp[] = [];
  for (const c of components(mask, width, height)) {
    const w = c.x1 - c.x0 + 1;
    const h = c.y1 - c.y0 + 1;
    if (w < minSize || h < minSize || w > maxSize || h > maxSize) continue;
    const ratio = w / h;
    if (ratio < 0.7 || ratio > 1.4) continue;
    if (c.n < 0.15 * w * h) continue;
    // bubbles are circles (ring outline or solid disc); letters/text are not
    if (circularity(c, mask, width, height) < 0.92) continue;
    c.fill = measureFill(c, mask, width, height);
    candidates.push(c);
  }

  if (candidates.length < 20) {
    return {
      width,
      height,
      threshold,
      rollNumber: "",
      rollBubbles: [],
      answers: [],
      optionCount,
      warnings: ["No bubble grid detected. Try a sharper, straighter scan."],
    };
  }

  // --- answer grid: the dominant bubble size on the sheet ---
  const answerR = modeRadius(candidates);
  const sized = candidates.filter((c) => c.r >= answerR * 0.8 && c.r <= answerR * 1.25);
  const answerBubbles = clusterBy(sized, (c) => c.cy, Math.max(3, answerR * 0.8))
    .filter((g) => g.length >= optionCount * 2)
    .flat();
  if (!answerBubbles.length) {
    return {
      width,
      height,
      threshold,
      rollNumber: "",
      rollBubbles: [],
      answers: [],
      optionCount,
      warnings: ["Could not locate the answer grid."],
    };
  }
  const gridTop = Math.min(...answerBubbles.map((c) => c.cy));

  // columns of the answer grid, grouped into blocks of `optionCount`
  const colGroups = clusterBy(answerBubbles, (c) => c.cx, answerR * 1.2);
  if (colGroups.length % optionCount !== 0) {
    warnings.push(
      `Detected ${colGroups.length} answer columns, expected a multiple of ${optionCount}.`,
    );
  }
  const blockCount = Math.floor(colGroups.length / optionCount);
  const answers: AnswerResult[] = [];
  let qNumber = 0;
  for (let b = 0; b < blockCount; b++) {
    const block = colGroups.slice(b * optionCount, (b + 1) * optionCount);
    // Ideal column centres for this block; a bubble that is filled past its
    // printed outline (or that bleeds into the row above/below) is rejected as
    // a component, so every cell is re-sampled from the mask instead of
    // relying on the detected outlines alone.
    const colCenters = block.map((g) => median(g.map((c) => c.cx))).sort((a, z) => a - z);
    const rowsOf = clusterBy(block.flat(), (c) => c.cy, Math.max(3, answerR * 0.8));
    for (const row of rowsOf) {
      const cy = median(row.map((c) => c.cy));
      qNumber++;
      const bubbles = colCenters.map((cx) => {
        const found = row.find((c) => Math.abs(c.cx - cx) <= answerR);
        const cell: Comp = {
          x0: 0,
          y0: 0,
          x1: 0,
          y1: 0,
          n: 0,
          cx: found?.cx ?? cx,
          cy: found?.cy ?? cy,
          r: found?.r ?? answerR,
          fill: 0,
        };
        cell.fill = measureFill(cell, mask, width, height);
        return toBubble(cell, cell.fill >= markThreshold);
      });
      const marked = bubbles.filter((x) => x.marked);
      const letters: Option[] = ["A", "B", "C", "D", "E" as Option].slice(
        0,
        optionCount,
      ) as Option[];
      let answer: Option | null = null;
      if (marked.length === 1) {
        const i = bubbles.indexOf(marked[0]);
        answer = letters[i] ?? null;
      }
      answers.push({ q: qNumber, answer, multiple: marked.length > 1, bubbles });
    }
  }

  // --- roll number grid: smaller bubbles above the answer grid ---
  const above = candidates.filter(
    (c) => c.r < answerR * 0.85 && c.r > answerR * 0.35 && c.cy < gridTop - answerR,
  );
  const rollR = above.length ? modeRadius(above) : 0;
  const rollCandidates = above.filter((c) => c.r >= rollR * 0.8 && c.r <= rollR * 1.3);
  let rollNumber = "";
  let rollBubbles: Bubble[] = [];
  if (rollCandidates.length >= 20) {
    const cols = clusterBy(rollCandidates, (c) => c.cx, rollR * 1.2).filter(
      (g) => g.length >= 6,
    );
    const grid = cols.flat();
    if (cols.length && grid.length) {
      // Rebuild an ideal 10-row grid, then re-sample every cell from the mask so
      // that heavily/partially filled bubbles (whose outline is lost) still count.
      const rowCenters = clusterBy(grid, (c) => c.cy, rollR).map((g) =>
        median(g.map((c) => c.cy)),
      );
      const diffs: number[] = [];
      for (let i = 1; i < rowCenters.length; i++) diffs.push(rowCenters[i] - rowCenters[i - 1]);
      const step = median(diffs.filter((d) => d > rollR)) || rollR * 2.2;
      const yTop = Math.min(...grid.map((c) => c.cy));
      const rowCount = 10;
      const digits: string[] = [];
      rollBubbles = [];
      for (const col of cols) {
        const cx = median(col.map((c) => c.cx));
        const hits: number[] = [];
        for (let i = 0; i < rowCount; i++) {
          const cy = yTop + i * step;
          const cell: Comp = {
            x0: 0,
            y0: 0,
            x1: 0,
            y1: 0,
            n: 0,
            cx,
            cy,
            r: rollR,
            fill: 0,
          };
          cell.fill = measureFill(cell, mask, width, height);
          const marked = cell.fill >= markThreshold;
          if (marked) hits.push(i);
          rollBubbles.push(toBubble(cell, marked));
        }
        digits.push(hits.length === 1 ? String(hits[0]) : hits.length > 1 ? "*" : "_");
      }
      rollNumber = digits.join("");
      if (opts.rollDigits && cols.length !== opts.rollDigits) {
        warnings.push(`Detected ${cols.length} roll digit columns.`);
      }
      if (rollNumber.includes("_")) warnings.push("Some roll digits are blank.");
      if (rollNumber.includes("*")) warnings.push("Some roll digits have multiple marks.");
    }
  } else {
    warnings.push("Roll number grid not found.");
  }

  const blanks = answers.filter((a) => !a.answer && !a.multiple).length;
  if (answers.some((a) => a.multiple))
    warnings.push(`${answers.filter((a) => a.multiple).length} question(s) have multiple marks.`);

  return {
    width,
    height,
    threshold,
    rollNumber,
    rollBubbles,
    answers,
    optionCount,
    warnings: blanks === answers.length ? [...warnings, "No answers darkened."] : warnings,
  };
}

export function imageDataFromImage(
  image: HTMLImageElement,
  maxDim = 1600,
): { data: ImageData; scale: number } {
  const scale = Math.min(1, maxDim / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.round(image.naturalWidth * scale);
  const h = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h), scale };
}