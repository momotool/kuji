import type { WinningNumbersPayload } from "./lottery-types";

/**
 * 最新当選番号の取得雛形。
 * 実運用では Route Handler 経由で公式API・スクレイピングプロキシ等に差し替える。
 */
export async function fetchLatestWinningNumbers(): Promise<WinningNumbersPayload> {
  const res = await fetch("/api/winning-numbers", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`winning-numbers: ${res.status}`);
  }
  return res.json() as Promise<WinningNumbersPayload>;
}
