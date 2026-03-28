"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type TransitionEvent,
} from "react";
import type { SlotNarrative } from "@/lib/slot-drama";

const ITEM_H = 52;
const N_SYM = 6;

/** 宝くじ番号とは無関係のスロット図柄（インデックス0が大当たり揃い用） */
const SLOT_SYMBOLS: Array<{ label: string; color: string; node: ReactNode }> =
  [
    {
      label: "ラッキー7",
      color: "text-emerald-600 dark:text-emerald-400",
      node: (
        <svg viewBox="0 0 48 48" className="size-11" aria-hidden>
          <rect
            x="4"
            y="4"
            width="40"
            height="40"
            rx="8"
            className="fill-emerald-500/20 stroke-emerald-600 dark:stroke-emerald-400"
            strokeWidth="2"
          />
          <text
            x="24"
            y="34"
            textAnchor="middle"
            className="fill-emerald-700 text-[28px] font-black dark:fill-emerald-300"
            fontFamily="system-ui, sans-serif"
          >
            7
          </text>
        </svg>
      ),
    },
    {
      label: "星",
      color: "text-amber-600 dark:text-amber-400",
      node: (
        <svg viewBox="0 0 48 48" className="size-11" aria-hidden>
          <path
            d="M24 6l4.5 12.2L42 20l-10 8.2 3.8 12.4L24 34.6 12.2 40.6 16 28.2 6 20l13.5-1.8z"
            className="fill-amber-400/90 stroke-amber-700 dark:stroke-amber-300"
            strokeWidth="1.5"
          />
        </svg>
      ),
    },
    {
      label: "ベル",
      color: "text-yellow-600 dark:text-yellow-400",
      node: (
        <svg viewBox="0 0 48 48" className="size-11" aria-hidden>
          <path
            d="M24 8c-4 0-7 3-7 7v6c0 1-1 3-2 4h18c-1-1-2-3-2-4v-6c0-4-3-7-7-7zM18 36h12M24 40v3"
            className="fill-yellow-400/80 stroke-yellow-800 dark:stroke-yellow-200"
            strokeWidth="2"
            fillRule="evenodd"
          />
        </svg>
      ),
    },
    {
      label: "ダイヤ",
      color: "text-sky-600 dark:text-sky-400",
      node: (
        <svg viewBox="0 0 48 48" className="size-11" aria-hidden>
          <path
            d="M24 6L8 18l16 24 16-24-16-12z"
            className="fill-sky-400/70 stroke-sky-800 dark:stroke-sky-200"
            strokeWidth="1.8"
          />
        </svg>
      ),
    },
    {
      label: "チケット",
      color: "text-violet-600 dark:text-violet-400",
      node: (
        <svg viewBox="0 0 48 48" className="size-11" aria-hidden>
          <path
            d="M10 14h28v6c-2 0-3.5 2-3.5 4s1.5 4 3.5 4v6H10V14z"
            className="fill-violet-400/50 stroke-violet-800 dark:stroke-violet-200"
            strokeWidth="2"
          />
          <path
            d="M16 22h16M16 28h10"
            className="stroke-violet-900/60 dark:stroke-violet-100"
            strokeWidth="1.5"
          />
        </svg>
      ),
    },
    {
      label: "チェリー",
      color: "text-rose-600 dark:text-rose-400",
      node: (
        <svg viewBox="0 0 48 48" className="size-11" aria-hidden>
          <circle
            cx="16"
            cy="30"
            r="8"
            className="fill-rose-500 stroke-rose-900 dark:stroke-rose-100"
            strokeWidth="1.5"
          />
          <circle
            cx="32"
            cy="30"
            r="8"
            className="fill-rose-500 stroke-rose-900 dark:stroke-rose-100"
            strokeWidth="1.5"
          />
          <path
            d="M24 8c-2 8-8 14-14 16"
            className="stroke-emerald-800 dark:stroke-emerald-300"
            strokeWidth="2"
            fill="none"
          />
        </svg>
      ),
    },
  ];

function symbolAtStripIndex(i: number): number {
  return ((i % N_SYM) + N_SYM) % N_SYM;
}

function SymbolStrip() {
  const rows = 200;
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => {
        const si = symbolAtStripIndex(i);
        const sym = SLOT_SYMBOLS[si] ?? SLOT_SYMBOLS[0];
        return (
          <div
            key={i}
            className="flex items-center justify-center"
            style={{ height: ITEM_H }}
          >
            <span className={sym.color}>{sym.node}</span>
          </div>
        );
      })}
    </div>
  );
}

type ReelProps = {
  targetSymbolIndex: number;
  reelIndex: number;
  play: boolean;
  sequenceId: number;
  durationMs: number;
  onLocked: () => void;
};

function IllustrationReel({
  targetSymbolIndex,
  reelIndex,
  play,
  sequenceId,
  durationMs,
  onLocked,
}: ReelProps) {
  const t = Math.min(N_SYM - 1, Math.max(0, targetSymbolIndex));
  const cycles = 9 + reelIndex * 2;
  const finalIndex = cycles * N_SYM + t;
  const finalY = -finalIndex * ITEM_H;

  const [y, setY] = useState(0);
  const [transition, setTransition] = useState<"none" | string>("none");
  const innerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<{ a?: number; b?: number }>({});
  const onLockedRef = useRef(onLocked);
  onLockedRef.current = onLocked;

  /** 描画前に停止位置へスナップ、または回転開始で y=0 に戻す */
  useLayoutEffect(() => {
    if (!play) {
      setTransition("none");
      setY(finalY);
      return;
    }
    setTransition("none");
    setY(0);
  }, [play, finalY]);

  /** ペイント後に transition を掛けて finalY へ（Strict Mode でも二重 rAF＋ reflow で確実に発火） */
  useEffect(() => {
    if (!play) return;

    rafRef.current = {};
    rafRef.current.a = requestAnimationFrame(() => {
      rafRef.current.b = requestAnimationFrame(() => {
        void innerRef.current?.offsetHeight;
        setTransition(
          `transform ${durationMs}ms cubic-bezier(0.2, 0.85, 0.22, 1)`,
        );
        setY(finalY);
      });
    });

    return () => {
      const { a, b } = rafRef.current;
      if (typeof a === "number") cancelAnimationFrame(a);
      if (typeof b === "number") cancelAnimationFrame(b);
    };
  }, [play, sequenceId, finalY, durationMs]);

  const handleEnd = useCallback(
    (e: TransitionEvent<HTMLDivElement>) => {
      if (e.propertyName !== "transform") return;
      if (!play) return;
      onLockedRef.current();
    },
    [play],
  );

  const sym = SLOT_SYMBOLS[targetSymbolIndex] ?? SLOT_SYMBOLS[0];

  return (
    <div
      className="relative overflow-hidden rounded-xl border-[3px] border-amber-700/80 bg-gradient-to-b from-amber-100/90 to-amber-50 shadow-[inset_0_2px_8px_rgba(0,0,0,0.12)] dark:border-amber-500/50 dark:from-zinc-800 dark:to-zinc-900"
      style={{ width: "4.25rem", height: ITEM_H }}
    >
      <div
        ref={innerRef}
        className="will-change-transform [backface-visibility:hidden]"
        style={{
          transform: `translate3d(0, ${y}px, 0)`,
          transition: transition,
        }}
        onTransitionEnd={handleEnd}
      >
        <SymbolStrip />
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-black/30 to-transparent dark:from-black/50"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-black/30 to-transparent dark:from-black/50"
        aria-hidden
      />
      {!play && (
        <span className="sr-only">{sym.label}</span>
      )}
    </div>
  );
}

const JACKPOT = 0;
/** ハズレ用：7以外でバラけた止まり方 */
const COLD_A = 2;
const COLD_B = 4;
const COLD_C = 5;
/** リーチ外れ：右リールだけ外す */
const NEAR_MISS_SYM = 3;

export type LotteryResultSlotProps = {
  narrative: SlotNarrative;
  play: boolean;
  sequenceId: number;
  slotSpentForThisTicket: boolean;
  onSequenceComplete: () => void;
  className?: string;
};

/**
 * 宝くじの組・番号とは別物の3リール絵柄。止まり方だけ当選判定（narrative）に連動。
 */
export function LotteryResultSlot({
  narrative,
  play,
  sequenceId,
  slotSpentForThisTicket,
  onSequenceComplete,
  className = "",
}: LotteryResultSlotProps) {
  const [banner, setBanner] = useState<"reach" | "hot" | null>(null);
  const lockedRef = useRef(0);
  const doneRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!play) {
      setBanner(null);
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
      return;
    }

    lockedRef.current = 0;
    doneRef.current = false;
    setBanner(null);

    if (narrative !== "near_miss") return;

    const t1 = setTimeout(() => setBanner("reach"), 1600);
    const t2 = setTimeout(() => setBanner("hot"), 2400);
    const t3 = setTimeout(() => setBanner(null), 3400);
    timersRef.current = [t1, t2, t3];
    return () => {
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
    };
  }, [play, sequenceId, narrative]);

  const handleLocked = useCallback(() => {
    if (!play || doneRef.current) return;
    lockedRef.current += 1;
    if (lockedRef.current >= 3) {
      doneRef.current = true;
      onSequenceComplete();
    }
  }, [play, onSequenceComplete]);

  const targetFor = (i: 0 | 1 | 2): number => {
    if (!play) {
      const idle = [1, 3, 5] as const;
      return idle[i];
    }
    if (narrative === "win") return JACKPOT;
    if (narrative === "near_miss") {
      if (i === 0 || i === 1) return JACKPOT;
      return NEAR_MISS_SYM;
    }
    if (i === 0) return COLD_A;
    if (i === 1) return COLD_B;
    return COLD_C;
  };

  const durationFor = (i: 0 | 1 | 2): number => {
    if (narrative === "near_miss") {
      if (i === 2) return 4200;
      return 980 + i * 100;
    }
    return 1400 + i * 120;
  };

  return (
    <div
      className={`relative ${className}`}
      role="status"
      aria-live="polite"
      aria-busy={play}
    >
      <p className="mb-1 text-center text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {play
          ? narrative === "win"
            ? "スロット回転中…（演出は番号と無関係です）"
            : "スロット回転中…"
          : slotSpentForThisTicket
            ? "この券のスロットは引き済みです（券を変えれば再チャレンジ）"
            : "下の3リールは演出用です。当選の可否は宝くじの照合結果に従います。"}
      </p>

      {play && banner === "reach" && (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          aria-hidden
        >
          <span className="animate-pulse text-3xl font-black tracking-wider text-amber-400 drop-shadow-[0_0_12px_rgba(251,191,36,0.9)]">
            リーチ！
          </span>
        </div>
      )}
      {play && banner === "hot" && (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-red-600/25 dark:bg-red-950/40"
          aria-hidden
        >
          <span className="text-4xl font-black tracking-widest text-red-600 drop-shadow-md animate-pulse dark:text-red-400">
            アツい！！
          </span>
          <span className="text-xs font-bold text-red-800 dark:text-red-200">
            あと少し…！
          </span>
        </div>
      )}

      <div className="mx-auto flex max-w-sm items-end justify-center gap-2 rounded-2xl border-2 border-amber-900/20 bg-gradient-to-b from-amber-50/80 to-zinc-100/80 px-4 py-3 dark:border-amber-500/20 dark:from-zinc-900/80 dark:to-zinc-950/80">
        {([0, 1, 2] as const).map((i) => (
          <IllustrationReel
            key={`reel-${i}`}
            targetSymbolIndex={targetFor(i)}
            reelIndex={i}
            play={play}
            sequenceId={sequenceId}
            durationMs={durationFor(i)}
            onLocked={handleLocked}
          />
        ))}
      </div>

      {play && narrative === "win" && (
        <p className="mt-3 text-center text-sm font-bold text-amber-600 dark:text-amber-400">
          大当たり図柄が揃いました！
        </p>
      )}
    </div>
  );
}
