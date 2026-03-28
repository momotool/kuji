/**
 * 年末ジャンボ等で「組・番号」が右寄せになる想定の読取窓（動画解像度上の比率）。
 * UIの破線枠と必ず一致させること。
 */
export const OCR_GUIDE_REGION = {
  /** 左端（0〜1） */
  leftPct: 0.54,
  topPct: 0.08,
  widthPct: 0.44,
  heightPct: 0.8,
} as const;

/**
 * 読取窓内のおおよその3段（上から 第○○回＋ユニット / 組 / 6桁）。
 * 動画に重ねる補助線用（実OCRは従来どおり窓全体1クロップ）。
 * topRel・heightRel は窓の高さに対する比率（合計1）。
 * ジャンボ券は6桁が最も大きいので番号帯を広く、回・組は1行分に近く詰める。
 */
export const OCR_GUIDE_THREE_BANDS = [
  { id: "issue", label: "回", topRel: 0, heightRel: 0.26 },
  { id: "group", label: "組", topRel: 0.26, heightRel: 0.24 },
  { id: "number", label: "番号", topRel: 0.5, heightRel: 0.5 },
] as const;

export type OcrCropYBand = 0 | 1 | 2;

/**
 * OCR クロップ画像上の Y（中心推奨）が、3段ガイドのどの帯に入るか。
 * Tesseract の bbox はこのクロップ座標系。
 */
export function cropYBandIndex(cy: number, imageHeight: number): OcrCropYBand {
  if (imageHeight <= 1) return 1;
  const t = Math.max(0, Math.min(1, cy / imageHeight));
  let low = 0;
  for (let i = 0; i < OCR_GUIDE_THREE_BANDS.length; i++) {
    const high = low + OCR_GUIDE_THREE_BANDS[i].heightRel;
    if (t < high - 1e-9) return i as OcrCropYBand;
    low = high;
  }
  return 2;
}

export function getOcrCropRect(
  videoWidth: number,
  videoHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const { leftPct, topPct, widthPct, heightPct } = OCR_GUIDE_REGION;
  const sx = Math.floor(videoWidth * leftPct);
  const sy = Math.floor(videoHeight * topPct);
  const sw = Math.max(32, Math.floor(videoWidth * widthPct));
  const sh = Math.max(32, Math.floor(videoHeight * heightPct));
  return { sx, sy, sw, sh };
}
