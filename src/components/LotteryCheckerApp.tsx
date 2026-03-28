"use client";

import dynamic from "next/dynamic";
import { RefreshCw, Sparkles, Ticket } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LotteryResultSlot } from "@/components/LotteryResultSlot";
import { fetchLatestWinningNumbers } from "@/lib/fetch-winning-numbers";
import type { MatchResult, WinningNumbersPayload } from "@/lib/lottery-types";
import {
  planSlotDrama,
  ticketSlotKey,
  type SlotDramaPlan,
} from "@/lib/slot-drama";
import type { GroupDigitUiMode } from "@/lib/group-digit-hint";
import { evaluateTicket } from "@/lib/match-lottery";
import { defaultTestModeFromEnv } from "@/lib/test-mode";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const LotteryCameraScanner = dynamic(
  () => import("@/components/LotteryCameraScanner"),
  { ssr: false, loading: () => <p className="text-sm text-zinc-500">カメラUIを読み込み中…</p> },
);

const AUTO_STREAK_CHOICES = [2, 3, 4, 5] as const;

export default function LotteryCheckerApp() {
  const [group, setGroup] = useState("");
  const [number, setNumber] = useState("");
  const [issueRound, setIssueRound] = useState("");
  const [groupDigitMode, setGroupDigitMode] =
    useState<GroupDigitUiMode>("auto");
  const [testMode, setTestMode] = useState(() => defaultTestModeFromEnv());
  const [winning, setWinning] = useState<WinningNumbersPayload | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [autoCheckStable, setAutoCheckStable] = useState(true);
  const [autoStreakNeed, setAutoStreakNeed] = useState<number>(3);
  /** カメラOCRが1回でもフィールドを送った時刻（手入力では更新しない） */
  const [lastOcrAtMs, setLastOcrAtMs] = useState<number | null>(null);
  const [slotOnManualCheck, setSlotOnManualCheck] = useState(true);
  const [slotPlay, setSlotPlay] = useState(false);
  const [slotSeq, setSlotSeq] = useState(0);
  const [activeSlotDrama, setActiveSlotDrama] = useState<SlotDramaPlan | null>(
    null,
  );
  const slotConsumedRef = useRef(new Set<string>());
  const pendingMatchRef = useRef<MatchResult | null>(null);

  const currentSlotKey = useMemo(
    () => ticketSlotKey(group, number),
    [group, number],
  );

  const groupRef = useRef("");
  const numberRef = useRef("");
  const stableStreakRef = useRef(0);
  const stableLastKeyRef = useRef("");
  const autoCheckedKeyRef = useRef("");

  useEffect(() => {
    autoCheckedKeyRef.current = "";
  }, [winning, testMode, autoStreakNeed, autoCheckStable]);

  const onParsed = useCallback(
    (fields: {
      group?: string;
      number?: string;
      issueRound?: string;
    }) => {
      if (fields.group !== undefined) {
        groupRef.current = fields.group;
        setGroup(fields.group);
      }
      if (fields.number !== undefined) {
        const n = fields.number.replace(/\D/g, "").slice(0, 6);
        numberRef.current = n;
        setNumber(n);
      }
      if (fields.issueRound !== undefined) {
        setIssueRound(fields.issueRound.replace(/\D/g, "").slice(0, 4));
      }

      if (
        fields.group !== undefined ||
        fields.number !== undefined ||
        fields.issueRound !== undefined
      ) {
        setLastOcrAtMs(Date.now());
      }

      if (!autoCheckStable) return;

      const g = groupRef.current.replace(/\D/g, "");
      const n = numberRef.current.replace(/\D/g, "");
      if (g.length < 2 || g.length > 3 || n.length !== 6) {
        stableStreakRef.current = 0;
        stableLastKeyRef.current = "";
        return;
      }

      const key = `${g}|${n}`;
      if (key === stableLastKeyRef.current) {
        stableStreakRef.current += 1;
      } else {
        stableLastKeyRef.current = key;
        stableStreakRef.current = 1;
        autoCheckedKeyRef.current = "";
      }

      if (
        stableStreakRef.current >= autoStreakNeed &&
        autoCheckedKeyRef.current !== key
      ) {
        autoCheckedKeyRef.current = key;
        setResult(
          evaluateTicket(groupRef.current, numberRef.current, winning, {
            testMode,
          }),
        );
      }
    },
    [autoCheckStable, autoStreakNeed, testMode, winning],
  );

  const loadWinning = useCallback(async () => {
    setFetchError(null);
    setFetching(true);
    try {
      const data = await fetchLatestWinningNumbers();
      setWinning(data);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setFetching(false);
    }
  }, []);

  const runCheck = useCallback(() => {
    const r = evaluateTicket(group, number, winning, { testMode });
    const gd = group.replace(/\D/g, "");
    const nd = number.replace(/\D/g, "");
    const validForSlot =
      gd.length >= 2 && gd.length <= 3 && nd.length === 6;
    const key = ticketSlotKey(group, number);

    if (
      slotOnManualCheck &&
      !prefersReducedMotion() &&
      validForSlot &&
      !slotConsumedRef.current.has(key)
    ) {
      slotConsumedRef.current.add(key);
      const plan = planSlotDrama(r, group, number, winning);
      pendingMatchRef.current = r;
      setActiveSlotDrama(plan);
      setResult(null);
      setSlotSeq((s) => s + 1);
      setSlotPlay(true);
      return;
    }
    setResult(r);
  }, [group, number, winning, testMode, slotOnManualCheck]);

  const onSlotSequenceComplete = useCallback(() => {
    setSlotPlay(false);
    setActiveSlotDrama(null);
    if (pendingMatchRef.current) setResult(pendingMatchRef.current);
  }, []);

  const resultPanel = useMemo(() => {
    if (!result) return null;
    return (
      <div
        className={`mt-6 rounded-2xl border-2 p-6 text-center ${
          result.won
            ? "border-amber-400 bg-gradient-to-br from-amber-50 to-orange-100 dark:from-amber-950/40 dark:to-orange-950/30"
            : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/60"
        }`}
      >
        {result.won ? (
          <>
            <p className="text-lg font-bold text-amber-900 dark:text-amber-100">
              当選 🎉
            </p>
            <p className="mt-2 text-2xl font-black text-amber-800 dark:text-amber-200">
              {result.tierLabel}
              {result.amountYen != null && (
                <span className="ml-2">
                  {result.amountYen.toLocaleString("ja-JP")}円
                </span>
              )}
            </p>
          </>
        ) : (
          <p className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">
            残念… はずれ
          </p>
        )}
        {result.detail && (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            {result.detail}
          </p>
        )}
      </div>
    );
  }, [result]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-8 text-center">
        <h1 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          <Ticket className="size-8 text-emerald-600" aria-hidden />
          カメラ読み取り当選チェッカー
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          組・番号をOCRで読み取り、照合のコア（テストモード含む）を試せます。
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          当選番号（API雛形）
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void loadWinning()}
            disabled={fetching}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            <RefreshCw
              className={`size-4 ${fetching ? "animate-spin" : ""}`}
              aria-hidden
            />
            最新を取得
          </button>
          {winning && (
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {winning.name ?? winning.drawId}{" "}
              <time dateTime={winning.fetchedAt}>
                （{new Date(winning.fetchedAt).toLocaleString("ja-JP")}）
              </time>
            </span>
          )}
        </div>
        {fetchError && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{fetchError}</p>
        )}
        {winning?.firstPrize && (
          <p className="mt-2 font-mono text-sm text-zinc-700 dark:text-zinc-300">
            スタブ1等: 組 {winning.firstPrize.group} / 番号{" "}
            {winning.firstPrize.number}
          </p>
        )}
      </section>

      <section
        className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        aria-labelledby="camera-ocr-heading"
      >
        <h2
          id="camera-ocr-heading"
          className="border-b border-zinc-100 bg-zinc-50 px-2 py-1 text-[10px] font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400"
        >
          カメラ & 読取（1画面でスクショしやすい・手入力可）
        </h2>
        <LotteryCameraScanner
          onParsed={onParsed}
          sheetLayout
          issueRoundHint={issueRound}
          groupDigitMode={groupDigitMode}
        />
        <div className="rounded-b-2xl border-t border-zinc-200 bg-zinc-50/95 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900/55">
          <p className="mb-1 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
            読取結果
          </p>
          <p className="mb-1.5 text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">
            {lastOcrAtMs != null ? (
              <>
                <span className="font-medium text-zinc-500 dark:text-zinc-400">
                  最終OCR{" "}
                  {new Date(lastOcrAtMs).toLocaleTimeString("ja-JP", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                …カメラ解析が返した時刻です。そのフレームで送られてきた欄だけ更新され、
                含まれなかった値はその前の表示のまま残ります。
              </>
            ) : (
              <>カメラで読み取りが走ると、ここに最終OCR時刻が出ます。</>
            )}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            <label className="min-w-0">
              <span className="block truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                回（4桁）
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={issueRound}
                maxLength={4}
                onChange={(e) =>
                  setIssueRound(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                className="mt-0.5 w-full rounded-md border border-zinc-300 bg-white px-1.5 py-1 font-mono text-sm outline-none ring-emerald-500/30 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-900"
                placeholder="1082"
                autoComplete="off"
              />
            </label>
            <label className="min-w-0">
              <span className="block truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                組（2〜3桁）
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-zinc-300 bg-white px-1.5 py-1 font-mono text-sm outline-none ring-emerald-500/30 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-900"
                placeholder="101"
                autoComplete="off"
              />
            </label>
            <label className="min-w-0">
              <span className="block truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                番号（6桁）
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={number}
                maxLength={6}
                onChange={(e) =>
                  setNumber(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="mt-0.5 w-full rounded-md border border-zinc-300 bg-white px-1.5 py-1 font-mono text-sm outline-none ring-emerald-500/30 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-900"
                placeholder="124322"
                autoComplete="off"
              />
            </label>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-zinc-200/80 pt-1.5 dark:border-zinc-700/80">
            <label className="inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
              <span className="shrink-0">組OCR</span>
              <select
                value={groupDigitMode}
                onChange={(e) =>
                  setGroupDigitMode(e.target.value as GroupDigitUiMode)
                }
                aria-label="組番号のOCR桁モード"
                className="max-w-[11rem] rounded border border-zinc-300 bg-white px-1 py-0.5 text-[10px] text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              >
                <option value="auto">
                  自動（組の前が2/3桁で切れているとき推定＋それ以外は両試行）
                </option>
                <option value="2">2桁に固定</option>
                <option value="3">3桁に固定（先頭0埋め）</option>
                <option value="fromIssue">回番号テーブル（コードで登録）</option>
              </select>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
                className="size-3.5 rounded border-zinc-400 text-emerald-600 focus:ring-emerald-500"
              />
              テスト（末尾0→7等）
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 text-[10px] text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={slotOnManualCheck}
                onChange={(e) => setSlotOnManualCheck(e.target.checked)}
                className="size-3.5 rounded border-zinc-400 text-emerald-600 focus:ring-emerald-500"
              />
              パチンコ風スロット（券1回）
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 text-[10px] text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={autoCheckStable}
                onChange={(e) => setAutoCheckStable(e.target.checked)}
                className="size-3.5 rounded border-zinc-400 text-emerald-600 focus:ring-emerald-500"
              />
              自動照合
              <select
                value={autoStreakNeed}
                onChange={(e) => setAutoStreakNeed(Number(e.target.value))}
                disabled={!autoCheckStable}
                aria-label="連続一致回数"
                className="ml-0.5 max-w-[4.5rem] rounded border border-zinc-300 bg-white px-1 py-0.5 text-[10px] disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900"
              >
                {AUTO_STREAK_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c}回一致
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={runCheck}
              disabled={slotPlay}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Sparkles className="size-3.5" aria-hidden />
              {slotPlay ? "回転中…" : "照合"}
            </button>
          </div>
          <p className="mt-1 text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">
            <code className="rounded bg-zinc-200/80 px-1 dark:bg-zinc-800">
              NEXT_PUBLIC_LOTTERY_TEST_MODE=true
            </code>{" "}
            で初期ON
          </p>
        </div>
      </section>

      <section
        className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        aria-label="スロット照合"
      >
        <LotteryResultSlot
          narrative={activeSlotDrama?.narrative ?? "cold_miss"}
          play={slotPlay}
          sequenceId={slotSeq}
          slotSpentForThisTicket={slotConsumedRef.current.has(currentSlotKey)}
          onSequenceComplete={onSlotSequenceComplete}
          className="py-2"
        />
      </section>

      {resultPanel}
    </div>
  );
}
