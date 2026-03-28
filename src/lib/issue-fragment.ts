import { normalizeDigits } from "./parse-ocr-lottery";

/** 4桁の回番号に含まれる「隣り合う2桁」と同じなら、組ではなく断片の可能性が高い（例: 1082 → 08） */
export function isTwoDigitIssueFragment(
  two: string,
  issueFour: string,
): boolean {
  const a = normalizeDigits(two).replace(/\D/g, "");
  const b = normalizeDigits(issueFour).replace(/\D/g, "");
  if (a.length !== 2 || b.length !== 4) return false;
  for (let i = 0; i <= 2; i++) {
    if (b.slice(i, i + 2) === a) return true;
  }
  return false;
}
