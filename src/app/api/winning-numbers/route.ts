import { NextResponse } from "next/server";
import type { WinningNumbersPayload } from "@/lib/lottery-types";

/** 固定スタブ。本番では外部取得結果に置き換える */
export async function GET() {
  const payload: WinningNumbersPayload = {
    drawId: "stub-2026-001",
    name: "サンプル抽選（スタブ）",
    fetchedAt: new Date().toISOString(),
    firstPrize: { group: "123", number: "123456" },
  };
  return NextResponse.json(payload);
}
