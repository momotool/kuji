/**
 * 組番号の桁を「自動」と区別するためのヒント。
 * 回番号だけから機械的に決める公式ルールはないため、
 * 固定・または下の表（手動メンテ）で補う。
 */

export type GroupDigitUiMode = "auto" | "2" | "3" | "fromIssue";

/** 回番号（4桁・数字のみキー）→ 組の桁数。必要に応じて追記する。 */
export const GROUP_DIGITS_BY_ISSUE: Record<string, 2 | 3> = {
  /* 例: "1076": 2, */
};

export function normalizeIssueKey(issue: string): string {
  return issue.replace(/\D/g, "").slice(0, 4);
}

/**
 * UI のモードと（任意で）フォームの回番号から、パーサに渡す 2|3 を決める。
 * - auto → undefined（カメラ側で `inferGroupDigitCountFromOcrText` を併用）
 * - fromIssue → 表にあればその桁、なければ undefined（その場合も推定にフォールバック）
 */
export function resolveGroupDigitHint(
  mode: GroupDigitUiMode,
  issueRoundForm: string,
): 2 | 3 | undefined {
  if (mode === "2") return 2;
  if (mode === "3") return 3;
  if (mode === "fromIssue") {
    const k = normalizeIssueKey(issueRoundForm);
    if (k.length !== 4) return undefined;
    return GROUP_DIGITS_BY_ISSUE[k];
  }
  return undefined;
}
