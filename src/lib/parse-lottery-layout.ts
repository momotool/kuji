import { cropYBandIndex } from "@/lib/ocr-guide-region";
import { isTwoDigitIssueFragment } from "./issue-fragment";
import {
  extractIssueRoundFromOcrText,
  groupDigitsAdjacentTo組,
  looksLikeFourDigitMonthDay,
  normalizeDigits,
  normalizeOcrForLottery,
} from "./parse-ocr-lottery";

type Bbox = { x0: number; y0: number; x1: number; y1: number };

type FlatWord = {
  text: string;
  bbox: Bbox;
  cx: number;
  cy: number;
  confidence: number;
};

export type PageLike = {
  blocks: Array<{
    paragraphs: Array<{
      lines: Array<{
        words: Array<{ text: string; bbox: Bbox; confidence?: number }>;
      }>;
    }>;
  }> | null;
  text?: string | null;
};

function flattenWords(page: PageLike): FlatWord[] {
  const out: FlatWord[] = [];
  const blocks = page.blocks;
  if (!blocks) return out;
  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) {
          const t = w.text?.trim() ?? "";
          if (!t) continue;
          const { x0, y0, x1, y1 } = w.bbox;
          out.push({
            text: t,
            bbox: w.bbox,
            cx: (x0 + x1) / 2,
            cy: (y0 + y1) / 2,
            confidence: w.confidence ?? 0,
          });
        }
      }
    }
  }
  return out;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 20;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 20;
}

/**
 * 「第」「回」ワード（または 1 語の 第○○回）の位置から回番号の数字だけを拾う。
 * 上段帯（回）付近のみ対象にし、装飾・下段の4桁を除外する。
 */
function extractIssueRoundFrom第回Anchors(
  flat: Array<FlatWord & { norm: string; h: number }>,
  lineTol: number,
  imageHeight: number,
): string | undefined {
  const ih = Math.max(1, imageHeight);
  const inIssueBand = (cy: number) => cropYBandIndex(cy, ih) === 0;
  const inIssueOrGroupBand = (cy: number) => cropYBandIndex(cy, ih) <= 1;

  for (const w of flat) {
    if (!inIssueBand(w.cy)) continue;
    const one = w.norm.match(/第\s*(\d{3,4})\s*回/);
    if (one && !looksLikeFourDigitMonthDay(one[1])) return one[1];
  }

  for (const w of flat) {
    const one = w.norm.match(/第\s*(\d{3,4})\s*回/);
    if (one && !looksLikeFourDigitMonthDay(one[1])) return one[1];
  }

  let 第words = flat.filter(
    (w) => w.norm.includes("第") && inIssueBand(w.cy),
  );
  if (第words.length === 0) {
    第words = flat.filter((w) => w.norm.includes("第"));
  }
  let 回words = flat.filter(
    (w) =>
      w.norm.includes("回") &&
      !/番号|No|Ｎｏ/i.test(w.norm) &&
      inIssueOrGroupBand(w.cy),
  );
  if (回words.length === 0) {
    回words = flat.filter(
      (w) => w.norm.includes("回") && !/番号|No|Ｎｏ/i.test(w.norm),
    );
  }

  for (const d of 第words) {
    for (const r of 回words) {
      if (Math.abs(d.cy - r.cy) > lineTol) continue;
      if (r.bbox.x0 < d.bbox.x1 - 1) continue;

      const between = flat.filter((o) => {
        if (o === d || o === r) return false;
        if (Math.abs(o.cy - d.cy) > lineTol) return false;
        if (o.bbox.x0 < d.bbox.x1 - 4) return false;
        if (o.bbox.x1 > r.bbox.x0 + 4) return false;
        if (cropYBandIndex(o.cy, ih) > 1) return false;
        return /^\d+$/.test(o.norm);
      });
      between.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      if (between.length === 0) continue;
      const joined = between.map((o) => o.norm).join("");
      const digits = normalizeDigits(joined).replace(/\D/g, "");
      if (digits.length >= 3 && digits.length <= 5) {
        const out = digits.length > 4 ? digits.slice(0, 4) : digits;
        if (out.length === 4 && looksLikeFourDigitMonthDay(out)) continue;
        return out;
      }
    }
  }

  return undefined;
}

/** 第…回が壊れているとき、画面上部の4桁ワードを回候補に（組3桁の誤4桁は除外） */
function fallbackIssueFromTopFourDigitWord(
  digitWords: Array<{ n: string; cy: number }>,
  groupHint: string | undefined,
  imageHeight: number,
): string | undefined {
  const ih = Math.max(1, imageHeight);
  const pick = (onlyBand0: boolean) => {
    const fours = digitWords
      .filter(
        (w) =>
          w.n.length === 4 &&
          (!onlyBand0 || cropYBandIndex(w.cy, ih) === 0),
      )
      .sort((a, b) => a.cy - b.cy);
    for (const w of fours) {
      if (looksLikeFourDigitMonthDay(w.n)) continue;
      if (groupHint && groupHint.length === 3 && w.n.startsWith(groupHint)) {
        continue;
      }
      return w.n;
    }
    return undefined;
  };
  return pick(true) ?? pick(false);
}

export type ParseLotteryLayoutOptions = {
  groupDigits?: 2 | 3;
};

/**
 * 「組」の左隣の数字（分割OCR含む）。
 * 既定は 2桁→3桁の順。groupDigits で上書き。
 */
function groupFromGluedDigitsLeftOf組(
  flat: Array<FlatWord & { norm: string; h: number }>,
  組: FlatWord & { norm: string; h: number },
  lineTol: number,
  imageWidth: number,
  imageHeight: number,
  issueFour: string | undefined,
  groupDigits?: 2 | 3,
): string | undefined {
  const ih = Math.max(1, imageHeight);
  const cy = 組.cy;
  const gap = Math.max(24, imageWidth * 0.04);
  const lineMatesAll = flat
    .filter((o) => {
      if (o === 組) return false;
      if (Math.abs(o.cy - cy) > lineTol) return false;
      if (o.bbox.x1 > 組.bbox.x0 + gap) return false;
      if (!/^\d{1,3}$/.test(o.norm)) return false;
      return true;
    })
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);

  if (lineMatesAll.length === 0) return undefined;

  const lineMates23 = lineMatesAll.filter((o) => /^\d{2,3}$/.test(o.norm));
  const byGap = (a: (typeof lineMates23)[0], b: (typeof lineMates23)[0]) => {
    const ga = 組.bbox.x0 - a.bbox.x1;
    const gb = 組.bbox.x0 - b.bbox.x1;
    if (ga !== gb) return ga - gb;
    if (a.norm.length !== b.norm.length) return a.norm.length - b.norm.length;
    return b.bbox.x0 - a.bbox.x0;
  };
  lineMates23.sort(byGap);
  const wb = cropYBandIndex(組.cy, ih);
  const sameBand23 = lineMates23.filter(
    (o) => cropYBandIndex(o.cy, ih) === wb,
  );
  const ordered23 =
    sameBand23.length > 0
      ? [...sameBand23, ...lineMates23.filter((o) => !sameBand23.includes(o))]
      : lineMates23;

  const pickTwoLoop = () => {
    for (const o of ordered23) {
      if (o.norm.length !== 2) continue;
      if (issueFour && isTwoDigitIssueFragment(o.norm, issueFour)) continue;
      return o.norm;
    }
    return undefined;
  };

  const pickThreeLoop = () => {
    for (const o of ordered23) {
      if (o.norm.length === 3) return o.norm;
    }
    return undefined;
  };

  if (groupDigits === 3) {
    const t = pickThreeLoop();
    if (t) return t;
    const two = pickTwoLoop();
    if (two) return two.padStart(3, "0");
  } else if (groupDigits === 2) {
    const two = pickTwoLoop();
    if (two) return two;
    const t = pickThreeLoop();
    if (t) return t.slice(0, 2);
  } else {
    const two = pickTwoLoop();
    if (two) return two;
    const t = pickThreeLoop();
    if (t) return t;
  }

  const sameBandAll = lineMatesAll.filter(
    (o) => cropYBandIndex(o.cy, ih) === wb,
  );
  const orderedAll =
    sameBandAll.length > 0
      ? [...sameBandAll, ...lineMatesAll.filter((o) => !sameBandAll.includes(o))]
      : lineMatesAll;
  const glued = orderedAll.map((o) => o.norm).join("");
  const g3 = glued.match(/(\d{3})$/);
  if (g3) {
    const full = g3[1];
    if (groupDigits === 2) {
      const v = full.slice(0, 2);
      if (issueFour && isTwoDigitIssueFragment(v, issueFour)) {
        /* fall through */
      } else {
        return v;
      }
    } else {
      return full;
    }
  }
  const g2 = glued.match(/(\d{2})$/);
  if (g2) {
    const v = g2[1];
    if (issueFour && isTwoDigitIssueFragment(v, issueFour)) return undefined;
    if (groupDigits === 3) return v.padStart(3, "0");
    return v;
  }
  return undefined;
}

/** 「組」より下にある6桁の単一ワードのみ（縦つなぎ・列推定は行わない＝誤検出抑制） */
function ticketSingleWordBelow(
  flat: Array<FlatWord & { norm: string; h: number }>,
  組cy: number,
  lineTol: number,
  imageHeight: number,
): string | undefined {
  const ih = Math.max(1, imageHeight);
  const below = (o: (typeof flat)[0]) =>
    /^\d{6}$/.test(o.norm) && o.cy > 組cy + lineTol * 0.2;
  const inBand2 = flat
    .filter((o) => below(o) && cropYBandIndex(o.cy, ih) === 2)
    .sort((a, b) => a.cy - b.cy)[0]?.norm;
  if (inBand2) return inBand2;
  return flat
    .filter(below)
    .sort((a, b) => a.cy - b.cy)[0]?.norm;
}

/**
 * レイアウトは補助のみ。「組」が検出できたフレームだけ組＋6桁1ワードを返す。
 * それ以外は空（テキスト解析に任せる）。
 */
function preferGroupBand(cy: number, imageHeight: number): number {
  return cropYBandIndex(cy, imageHeight) === 1 ? 0 : 1;
}

export function parseLotteryFromOcrLayout(
  page: PageLike,
  imageWidth: number,
  imageHeight: number,
  ocrFullText?: string | null,
  layoutOptions?: ParseLotteryLayoutOptions,
): { group?: string; number?: string; issueRound?: string } {
  const groupDigits = layoutOptions?.groupDigits;
  const words = flattenWords(page);
  if (words.length === 0) return {};

  const ih = Math.max(1, imageHeight);

  const flat = words.map((w) => ({
    ...w,
    norm: normalizeDigits(w.text).replace(/\s/g, "").replace(/组/g, "組"),
    h: Math.max(8, w.bbox.y1 - w.bbox.y0),
  }));

  const lineTol = Math.max(12, median(flat.map((w) => w.h)) * 0.55);

  const digitWords = flat
    .filter((w) => /^\d{2,9}$/.test(w.norm))
    .map((w) => ({ ...w, n: w.norm }));

  const sortedLineText = normalizeOcrForLottery(
    [...flat]
      .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
      .map((w) => w.text)
      .join(" "),
  );

  const groupHint = groupDigitsAdjacentTo組(sortedLineText);
  const issueFrom第回 = extractIssueRoundFrom第回Anchors(flat, lineTol, ih);
  let issueFour =
    issueFrom第回 ??
    (ocrFullText
      ? extractIssueRoundFromOcrText(normalizeOcrForLottery(ocrFullText))
      : undefined) ??
    extractIssueRoundFromOcrText(sortedLineText) ??
    fallbackIssueFromTopFourDigitWord(digitWords, groupHint, ih) ??
    digitWords
      .filter(
        (w) =>
          w.n.length === 4 &&
          !looksLikeFourDigitMonthDay(w.n) &&
          cropYBandIndex(w.cy, ih) === 0,
      )
      .sort((a, b) => a.cy - b.cy)[0]?.n ??
    digitWords
      .filter((w) => w.n.length === 4 && !looksLikeFourDigitMonthDay(w.n))
      .sort((a, b) => a.cy - b.cy)[0]?.n;

  const digit組Flat = flat.filter((w) => /^(\d{2,3})組$/.test(w.norm));
  digit組Flat.sort(
    (a, b) => preferGroupBand(a.cy, ih) - preferGroupBand(b.cy, ih),
  );
  for (const w of digit組Flat) {
    const m = w.norm.match(/^(\d{2,3})組$/);
    if (!m) continue;
    let g = m[1];
    if (groupDigits === 2 && g.length === 3) g = g.slice(0, 2);
    if (groupDigits === 3 && g.length === 2) g = g.padStart(3, "0");
    const num = ticketSingleWordBelow(flat, w.cy, lineTol, ih);
    return { group: g, number: num, issueRound: issueFour };
  }

  const 組Anchors = flat.filter(
    (w) => w.norm === "組" || w.norm.endsWith("組"),
  );
  組Anchors.sort(
    (a, b) => preferGroupBand(a.cy, ih) - preferGroupBand(b.cy, ih),
  );
  for (const w of 組Anchors) {
    if (w.norm !== "組" && !w.norm.endsWith("組")) continue;
    const glued = groupFromGluedDigitsLeftOf組(
      flat,
      w,
      lineTol,
      imageWidth,
      ih,
      issueFour,
      groupDigits,
    );
    const num = ticketSingleWordBelow(flat, w.cy, lineTol, ih);

    if (glued) {
      return { group: glued, number: num, issueRound: issueFour };
    }

    const cy = w.cy;
    const wb = cropYBandIndex(cy, ih);
    const candidates = flat.filter((o) => {
      if (o === w) return false;
      if (!/^\d{2,3}$/.test(o.norm)) return false;
      if (Math.abs(o.cy - cy) > lineTol) return false;
      return o.bbox.x1 <= w.bbox.x0 + Math.max(24, imageWidth * 0.04);
    });
    candidates.sort((a, b) => {
      const ba = cropYBandIndex(a.cy, ih) === wb ? 0 : 1;
      const bb = cropYBandIndex(b.cy, ih) === wb ? 0 : 1;
      if (ba !== bb) return ba - bb;
      if (b.norm.length !== a.norm.length) return b.norm.length - a.norm.length;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.bbox.x0 - a.bbox.x0;
    });
    let leftDigit = candidates[0];
    if (leftDigit?.norm.length === 2 && issueFour) {
      if (isTwoDigitIssueFragment(leftDigit.norm, issueFour)) {
        const alt = candidates.find(
          (c) =>
            c.norm.length === 3 ||
            !isTwoDigitIssueFragment(c.norm, issueFour),
        );
        if (alt) leftDigit = alt;
      }
    }
    if (leftDigit) {
      let g = leftDigit.norm;
      if (groupDigits === 2 && g.length === 3) g = g.slice(0, 2);
      if (groupDigits === 3 && g.length === 2) g = g.padStart(3, "0");
      return { group: g, number: num, issueRound: issueFour };
    }
  }

  return issueFour ? { issueRound: issueFour } : {};
}

/** テキスト解析を優先し、足りない部分だけレイアウトを使う */
export function mergeOcrParses(
  layout: { group?: string; number?: string; issueRound?: string },
  text: { group?: string; number?: string; issueRound?: string },
): { group?: string; number?: string; issueRound?: string } {
  let group = text.group ?? layout.group;
  const numT = text.number?.replace(/\D/g, "") ?? "";
  const numL = layout.number?.replace(/\D/g, "") ?? "";
  if (
    numT.length === 6 &&
    numL.length === 6 &&
    numT === numL &&
    text.group &&
    layout.group
  ) {
    const tg = text.group.replace(/\D/g, "");
    const lg = layout.group.replace(/\D/g, "");
    if (tg.length === lg.length + 1 && tg.startsWith(lg) && lg.length >= 2) {
      group = layout.group;
    }
    if (
      tg.length === 2 &&
      lg.length === 3 &&
      lg.startsWith(tg) &&
      tg !== lg
    ) {
      group = layout.group;
    }
  }

  const gDigits = (group ?? "").replace(/\D/g, "");
  const issueSpillsIntoGroup = (ir: string | undefined): boolean => {
    if (!ir || gDigits.length !== 3) return false;
    const d = ir.replace(/\D/g, "");
    return d.length === 4 && d.startsWith(gDigits);
  };

  let issueRound = text.issueRound ?? layout.issueRound;
  const td = text.issueRound?.replace(/\D/g, "") ?? "";
  const ld = layout.issueRound?.replace(/\D/g, "") ?? "";
  if (
    td.length === 4 &&
    ld.length === 4 &&
    looksLikeFourDigitMonthDay(td) &&
    !looksLikeFourDigitMonthDay(ld)
  ) {
    issueRound = layout.issueRound;
  }
  if (issueSpillsIntoGroup(issueRound)) {
    issueRound = layout.issueRound;
  }
  if (issueSpillsIntoGroup(issueRound)) {
    issueRound = text.issueRound;
  }
  if (issueSpillsIntoGroup(issueRound)) {
    issueRound = "";
  }

  return {
    group,
    number: text.number ?? layout.number,
    issueRound,
  };
}
