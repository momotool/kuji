import type { MatchResult, WinningNumbersPayload } from "./lottery-types";
import { normalizeDigits } from "./parse-ocr-lottery";

const TEST_TIER = "7等";
const TEST_AMOUNT = 300;

function digitsOnly(s: string): string {
  return normalizeDigits(s).replace(/\D/g, "");
}

/** 組は2〜3桁読みでも照合できるよう最大3桁でゼロ埋め比較 */
function normalizeGroupForCompare(s: string): string {
  const d = digitsOnly(s);
  if (!d) return "";
  if (d.length <= 3) return d.padStart(3, "0");
  return d;
}

/** 番号の末尾が0（全角0含む）ならテスト当選 */
function numberEndsWithZeroForTest(number: string): boolean {
  const d = digitsOnly(number);
  if (!d) return false;
  return d.endsWith("0");
}

/** 1等との完全一致（本番照合の最小例） */
function matchFirstPrize(
  group: string,
  number: string,
  winning: WinningNumbersPayload,
): MatchResult | null {
  const fp = winning.firstPrize;
  if (!fp) return null;
  const g = normalizeGroupForCompare(group);
  const n = digitsOnly(number);
  const wg = normalizeGroupForCompare(fp.group);
  const wn = digitsOnly(fp.number);
  if (g && n && g === wg && n === wn) {
    return {
      won: true,
      tierLabel: "1等",
      amountYen: undefined,
      detail: "firstPrize と一致",
    };
  }
  return null;
}

export type EvaluateOptions = {
  testMode: boolean;
};

/**
 * 照合のコア。テストモードON時は「番号の末尾が0」→7等300円。
 * オフ時は winning の firstPrize のみ照合（API雛形に追随して拡張）。
 */
export function evaluateTicket(
  group: string,
  number: string,
  winning: WinningNumbersPayload | null,
  options: EvaluateOptions,
): MatchResult {
  if (options.testMode) {
    if (numberEndsWithZeroForTest(number)) {
      return {
        won: true,
        tierLabel: TEST_TIER,
        amountYen: TEST_AMOUNT,
        detail: "テストモード: 番号の末尾が0のため7等（300円）として扱います",
      };
    }
    return {
      won: false,
      detail: "テストモード: 末尾0以外は不的中扱い",
    };
  }

  if (winning) {
    const first = matchFirstPrize(group, number, winning);
    if (first) return first;
  }

  return {
    won: false,
    detail: winning
      ? "当選番号データと一致しませんでした（照合ルールは今後拡張）"
      : "当選番号が未取得です。上部の取得ボタンを試してください。",
  };
}
