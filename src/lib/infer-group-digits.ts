import { strippedForGroupInference } from "./parse-ocr-lottery";

/**
 * 「組」の直前の数字が、区切られた 2桁 / 3桁の塊としてはっきりしているときだけ 2|3 を返す。
 * 4桁以上が「組」に直結している場合は曖昧なので undefined（従来の両方試行に任せる）。
 */
export function inferGroupDigitCountFromStripped(stripped: string): 2 | 3 | undefined {
  const idx組 = stripped.search(/組/);
  if (idx組 < 0) return undefined;

  const left = stripped.slice(0, idx組).replace(/\s+$/g, "");
  const m = left.match(/(\d+)$/);
  if (!m || m.index === undefined) return undefined;

  const run = m[1];
  if (run.length !== 2 && run.length !== 3) return undefined;

  if (m.index > 0) {
    const prev = left[m.index - 1];
    if (prev && /[0-9０-９]/.test(prev)) return undefined;
  }

  return run.length === 2 ? 2 : 3;
}

export function inferGroupDigitCountFromOcrText(raw: string): 2 | 3 | undefined {
  return inferGroupDigitCountFromStripped(strippedForGroupInference(raw));
}
