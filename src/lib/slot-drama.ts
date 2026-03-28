import type { MatchResult, WinningNumbersPayload } from "./lottery-types";
import { normalizeDigits } from "./parse-ocr-lottery";

function digitsOnly(s: string): string {
  return normalizeDigits(s).replace(/\D/g, "");
}

function pad3(g: string): string {
  const d = digitsOnly(g).slice(0, 3);
  return d.padStart(3, "0");
}

function pad6(n: string): string {
  const d = digitsOnly(n).slice(0, 6);
  return d.padStart(6, "0");
}

/** 照合用と同じ組の正規化 */
function normalizeGroupForCompare(s: string): string {
  const d = digitsOnly(s);
  if (!d) return "";
  if (d.length <= 3) return d.padStart(3, "0");
  return d;
}

/** 9桁がちょうど1か所だけ違うとき、そのインデックス。それ以外は null */
function singleDiffIndex(a: string, b: string): number | null {
  if (a.length !== 9 || b.length !== 9) return null;
  let diffAt = -1;
  for (let i = 0; i < 9; i++) {
    if (a[i] !== b[i]) {
      if (diffAt >= 0) return null;
      diffAt = i;
    }
  }
  return diffAt >= 0 ? diffAt : null;
}

/** 券の正規化キー（1枚1回スロット用） */
export function ticketSlotKey(group: string, number: string): string {
  return `${normalizeGroupForCompare(group)}|${pad6(number)}`;
}

/** UI・リール停止中の表示用（9桁） */
export function ticketDisplayLine(group: string, number: string): string {
  return pad3(group) + pad6(number);
}

export type SlotNarrative = "win" | "near_miss" | "cold_miss";

export type SlotDramaPlan = {
  narrative: SlotNarrative;
  /** 1等ライン（9桁）。near/win のリーチ比較に使う */
  dreamLine: string;
  /** 最終表示（9桁）。当たり=揃う行、惜しい=券の実際の桁、ハズレ=ランダムなど */
  finalLine: string;
  /** near_miss のときだけ、ズレているリール（0..8）。演出で最後まで回す */
  nearDiffIndex: number | null;
};

function randomDigit(): string {
  return String(Math.floor(Math.random() * 10));
}

/** dream と異なる9桁（可能なら） */
export function randomColdLine(dreamLine: string): string {
  for (let k = 0; k < 30; k++) {
    let s = "";
    for (let i = 0; i < 9; i++) s += randomDigit();
    if (s !== dreamLine) return s;
  }
  let s = dreamLine;
  const last = (parseInt(s[8] ?? "0", 10) + 1) % 10;
  return s.slice(0, 8) + last;
}

function nearMissDiffIndex(
  group: string,
  number: string,
  dream: string,
): number | null {
  const t = pad3(group) + pad6(number);
  if (t === dream) return null;
  return singleDiffIndex(t, dream);
}

/**
 * スロット演出の種類と、リールが止まる行を決める。
 * - 当たり: final === dream（数字が揃う）
 * - 惜しい: リーチ用に dream、最後は券の finalLine
 * - ハズレ: dream は1等（表示比較用）、final はバラけた行
 */
export function planSlotDrama(
  matchResult: MatchResult,
  group: string,
  number: string,
  winning: WinningNumbersPayload | null,
): SlotDramaPlan {
  const ticketLine = pad3(group) + pad6(number);
  const fp = winning?.firstPrize;
  const dreamFromApi = fp
    ? pad3(fp.group) + pad6(fp.number)
    : ticketLine;

  if (matchResult.won) {
    return {
      narrative: "win",
      dreamLine: ticketLine,
      finalLine: ticketLine,
      nearDiffIndex: null,
    };
  }

  if (!fp) {
    return {
      narrative: "cold_miss",
      dreamLine: ticketLine,
      finalLine: randomColdLine(ticketLine),
      nearDiffIndex: null,
    };
  }

  const dream = dreamFromApi;
  const diff = nearMissDiffIndex(group, number, dream);

  if (diff !== null) {
    return {
      narrative: "near_miss",
      dreamLine: dream,
      finalLine: ticketLine,
      nearDiffIndex: diff,
    };
  }

  return {
    narrative: "cold_miss",
    dreamLine: dream,
    finalLine: randomColdLine(dream),
    nearDiffIndex: null,
  };
}
