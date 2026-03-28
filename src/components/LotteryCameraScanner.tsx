"use client";

import { Camera, CameraOff, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getOcrCropRect,
  OCR_GUIDE_REGION,
  OCR_GUIDE_THREE_BANDS,
} from "@/lib/ocr-guide-region";
import type { GroupDigitUiMode } from "@/lib/group-digit-hint";
import { resolveGroupDigitHint } from "@/lib/group-digit-hint";
import { inferGroupDigitCountFromOcrText } from "@/lib/infer-group-digits";
import { mergeOcrParses, parseLotteryFromOcrLayout } from "@/lib/parse-lottery-layout";
import { parseLotteryFromOcr } from "@/lib/parse-ocr-lottery";

type WorkerType = import("tesseract.js").Worker;

const OCR_INTERVAL_MS = 1800;

function waitVideoMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error("動画の読み込みに失敗しました"));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", ok);
      video.removeEventListener("error", bad);
    };
    video.addEventListener("loadedmetadata", ok, { once: true });
    video.addEventListener("error", bad, { once: true });
  });
}

/** play() が load 競合で中断されたときは無視（Chrome の仕様） */
async function playVideoSafe(video: HTMLVideoElement): Promise<void> {
  try {
    await video.play();
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    if (
      name === "AbortError" ||
      msg.includes("interrupted") ||
      msg.includes("new load request")
    ) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      try {
        await video.play();
      } catch {
        /* 2回目も競合なら諦める */
      }
      return;
    }
    throw e;
  }
}

type Props = {
  onParsed: (fields: {
    group?: string;
    number?: string;
    issueRound?: string;
  }) => void;
  className?: string;
  /** 下に読取欄を続けるとき：角・余白をカード用に調整 */
  sheetLayout?: boolean;
  /** フォームの回番号（4桁）と組み合わせて fromIssue テーブルを参照 */
  issueRoundHint?: string;
  groupDigitMode?: GroupDigitUiMode;
};

export default function LotteryCameraScanner({
  onParsed,
  className,
  sheetLayout = false,
  issueRoundHint = "",
  groupDigitMode = "auto",
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<WorkerType | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRaw, setLastRaw] = useState<string>("");

  const stopAll = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const w = workerRef.current;
    workerRef.current = null;
    if (w) {
      try {
        await w.terminate();
      } catch {
        /* ignore */
      }
    }
    setRunning(false);
    setBusy(false);
  }, []);

  const captureAndRecognize = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const w = workerRef.current;
    if (!w) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const { sx, sy, sw, sh } = getOcrCropRect(vw, vh);
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

    setBusy(true);
    try {
      const { data } = await w.recognize(canvas, {}, { blocks: true });
      const trimmed = (data.text ?? "").trim();
      setLastRaw(trimmed.slice(0, 700));
      const explicitHint = resolveGroupDigitHint(
        groupDigitMode,
        issueRoundHint,
      );
      const groupDigits =
        explicitHint ?? inferGroupDigitCountFromOcrText(trimmed);
      const layoutOpts =
        groupDigits !== undefined ? { groupDigits } : undefined;
      const fromLayout = parseLotteryFromOcrLayout(
        data,
        sw,
        sh,
        trimmed,
        layoutOpts,
      );
      const fromText = parseLotteryFromOcr(trimmed, {
        groupDigits,
      });
      const parsed = mergeOcrParses(fromLayout, fromText);
      if (parsed.group || parsed.number || parsed.issueRound) onParsed(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "OCRに失敗しました");
    } finally {
      setBusy(false);
    }
  }, [onParsed, groupDigitMode, issueRoundHint]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.srcObject = null;
        video.srcObject = stream;
        await waitVideoMetadata(video);
        await playVideoSafe(video);
      }

      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("jpn+eng");
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        user_defined_dpi: "300",
      });
      workerRef.current = worker;

      setRunning(true);
      await captureAndRecognize();
      intervalRef.current = setInterval(captureAndRecognize, OCR_INTERVAL_MS);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "カメラを開始できません（権限・HTTPSを確認）",
      );
      await stopAll();
    }
  }, [captureAndRecognize, stopAll]);

  useEffect(() => {
    return () => {
      void stopAll();
    };
  }, [stopAll]);

  return (
    <div className={className}>
      <div
        className={
          sheetLayout
            ? "relative overflow-hidden rounded-t-2xl border-b border-zinc-200 bg-black/90 dark:border-zinc-700"
            : "relative overflow-hidden rounded-xl border border-zinc-200 bg-black/90 dark:border-zinc-800"
        }
      >
        <video
          ref={videoRef}
          className="aspect-video w-full object-cover"
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="hidden" />

        {running && (
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden
          >
            <div
              className={`pointer-events-none absolute flex flex-col overflow-hidden border-2 border-dashed border-emerald-400/95 shadow-[0_0_0_9999px_rgba(0,0,0,0.42)] ${
                sheetLayout ? "rounded-t-2xl" : "rounded-xl"
              }`}
              style={{
                top: `${OCR_GUIDE_REGION.topPct * 100}%`,
                left: `${OCR_GUIDE_REGION.leftPct * 100}%`,
                width: `${OCR_GUIDE_REGION.widthPct * 100}%`,
                height: `${OCR_GUIDE_REGION.heightPct * 100}%`,
              }}
            >
              {OCR_GUIDE_THREE_BANDS.map((band) => (
                <div
                  key={band.id}
                  className="relative min-h-0 border-b border-dashed border-emerald-300/80 last:border-b-0"
                  style={{ flex: `${band.heightRel} 1 0%` }}
                >
                  <span className="absolute left-1 top-0.5 z-10 rounded bg-black/55 px-1 py-px text-[8px] font-semibold text-emerald-100">
                    {band.label}
                  </span>
                </div>
              ))}
            </div>
            <div className="absolute bottom-2 left-0 right-0 text-center">
              <span className="rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-medium text-white/95 sm:text-xs">
                上から回・組・番号（6桁）が入るよう枠に合わせてください
              </span>
            </div>
          </div>
        )}

        {busy && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs text-white">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            OCR
          </div>
        )}

        {sheetLayout && running && (
          <div className="absolute bottom-10 left-2 z-20">
            <button
              type="button"
              onClick={() => void stopAll()}
              className="inline-flex items-center gap-1 rounded-md border border-white/40 bg-black/55 px-2 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm hover:bg-black/70"
            >
              <CameraOff className="size-3.5 shrink-0" aria-hidden />
              停止
            </button>
          </div>
        )}
      </div>

      {!(sheetLayout && running) && (
        <div
          className={
            sheetLayout
              ? "flex flex-wrap items-center gap-2 px-2 py-0.5"
              : "mt-3 flex flex-wrap items-center gap-2"
          }
        >
          {!running ? (
            <button
              type="button"
              onClick={() => void start()}
              className={`inline-flex items-center gap-2 rounded-lg bg-emerald-600 font-medium text-white hover:bg-emerald-500 ${
                sheetLayout ? "px-2.5 py-1 text-[11px]" : "px-4 py-2 text-sm"
              }`}
            >
              <Camera className={sheetLayout ? "size-3.5" : "size-4"} aria-hidden />
              {sheetLayout ? "読み取り開始" : "カメラで読み取り開始"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void stopAll()}
              className={`inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 ${
                sheetLayout ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
              }`}
            >
              <CameraOff className="size-4" aria-hidden />
              停止
            </button>
          )}
        </div>
      )}

      {error && (
        <p
          className={`text-red-600 dark:text-red-400 ${sheetLayout ? "px-2 py-0 text-xs" : "mt-2 text-sm"}`}
          role="alert"
        >
          {error}
        </p>
      )}

      {lastRaw && (
        <details
          className={`text-zinc-500 dark:text-zinc-400 ${sheetLayout ? "px-2 py-0 text-[10px] leading-tight" : "mt-2 text-xs"}`}
        >
          <summary className="cursor-pointer select-none">直近OCRテキスト</summary>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-zinc-100 p-2 dark:bg-zinc-900">
            {lastRaw}
          </pre>
        </details>
      )}
    </div>
  );
}
