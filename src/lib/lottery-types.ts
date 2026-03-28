/** 抽選回・当選番号のAPIレスポンス雛形（公式データに合わせて拡張する） */
export type WinningNumbersPayload = {
  drawId: string;
  name?: string;
  fetchedAt: string;
  /** 例: 1等の当選「組」「番号」 */
  firstPrize?: { group: string; number: string };
  /** 前後賞などは後続で追加 */
  adjacentPrizes?: Array<{ group: string; number: string; label: string }>;
  /** 7等など末尾一致系は桁パターンで表現する想定 */
  suffixWinners?: Array<{ suffix: string; tier: string; amountYen: number }>;
};

export type MatchResult = {
  won: boolean;
  tierLabel?: string;
  amountYen?: number;
  detail?: string;
};
