/** 全角数字を半角に */
export function normalizeDigits(input: string): string {
  return input.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

/** OCRで簡体字「组」などが出たときの券面用正規化 */
export function normalizeOcrForLottery(raw: string): string {
  return normalizeDigits(raw)
    .replace(/\s+/g, " ")
    .replace(/组/g, "組");
}

/**
 * 券面上部の「回」（抽選回・回番号）付近の数字を弱く除去。
 * 組・番号のヒューリスティックが4桁の回番号を拾わないようにする。
 */
function stripRoundIssuePhrases(text: string): string {
  let t = text;
  t = t.replace(/第\s*\d{3,4}\s*回/g, " ");
  t = t.replace(/(?<!\d)\d{4}\s*回(?!\d)/g, " ");
  t = t.replace(/回(?:番号|No\.?|Ｎｏ\.?)?\s*[：:\-－]?\s*\d{4}(?!\d)/gi, " ");
  return t.replace(/\s+/g, " ").trim();
}

/** ユニット表記（OCRノイズの温床）を弱く除去 */
function stripUnitLine(text: string): string {
  return text
    .replace(/ユニット\s*\d{1,3}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 組の桁推定用（回・ユニット表記を弱く除いたあとの1行に近いテキスト） */
export function strippedForGroupInference(raw: string): string {
  const normalized = normalizeOcrForLottery(raw);
  let s = stripUnitLine(normalized);
  s = stripRoundIssuePhrases(s);
  s = stripUnitLine(s);
  return s;
}

type DigitSpan = { value: string; start: number; end: number };

function digitSpans(text: string): DigitSpan[] {
  const out: DigitSpan[] = [];
  const re = /\d+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      value: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

function isLikelyIssueRoundToken(len: number): boolean {
  return len === 4;
}

function spanOverlaps(a: DigitSpan, b: DigitSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

/** 抽選日などが4桁（1028・1082など）に紛れ込むのを弱く除去（回番号フォールバック用） */
function stripJapaneseDateNoiseForIssue(text: string): string {
  return text
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*日?/g, " ")
    .replace(/\d{1,2}\s*[\uFF0F\/．]\s*\d{1,2}\s*日?/g, " ")
    .replace(/\d{1,2}月\d{1,2}日?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 4桁が MM+DD（例 0825≒8/25）の日付に見えるか。ジャンボの回（1082 等）と取り違えやすい。
 */
export function looksLikeFourDigitMonthDay(s: string): boolean {
  const d = normalizeDigits(s).replace(/\D/g, "");
  if (d.length !== 4) return false;
  const mm = parseInt(d.slice(0, 2), 10);
  const dd = parseInt(d.slice(2), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  return true;
}

/**
 * 「第」の直後にスペース区切りの数字が続くOCRを1本の回番にまとめる。
 */
function digitsAfter第Before回(normalized: string): string | undefined {
  const m = normalized.match(/第\s*([０-９0-9\s]+)\s*回/);
  if (!m) return undefined;
  const d = normalizeDigits(m[1]).replace(/\D/g, "");
  if (d.length < 3 || d.length > 5) return undefined;
  const core = d.length <= 4 ? d : d.slice(0, 4);
  if (looksLikeFourDigitMonthDay(core)) return undefined;
  return core;
}

/** OCR全文から4桁の回番号を取る（除去前に呼ぶ。1076→「10」誤組を弾く） */
function extractIssueFourDigits(normalized: string): string | undefined {
  const from第 = digitsAfter第Before回(normalized);
  if (from第) return from第;
  const m2 = normalized.match(/(?<!\d)(\d{4})\s*回(?!\d)/);
  if (m2) return m2[1];
  return undefined;
}

/** 「組」の直前の 2〜3 桁（組番号が回番号4桁に食い込むのを弾く用） */
export function groupDigitsAdjacentTo組(normalized: string): string | undefined {
  const m3 = normalized.match(/(?<!\d)(\d{3})\s*組(?!\d)/);
  if (m3) return m3[1];
  const m2 = normalized.match(/(?<!\d)(\d{2})\s*組(?!\d)/);
  if (m2) return m2[1];
  return undefined;
}

/**
 * 回番号（表示用）。第○○回が最優先。日付まわりを除いたうえで4桁＋ユニット/組フォールバック。
 * 「194 組」の 194 が「1944」にくっついた誤4桁は採用しない。
 */
export function extractIssueRoundFromOcrText(normalized: string): string | undefined {
  const from第 = digitsAfter第Before回(normalized);
  if (from第) return from第;
  const m2 = normalized.match(/(?<!\d)(\d{4})\s*回(?!\d)/);
  if (m2 && !looksLikeFourDigitMonthDay(m2[1])) return m2[1];
  const sansDate = stripJapaneseDateNoiseForIssue(normalized);
  const gAdjacent = groupDigitsAdjacentTo組(sansDate);
  const re = /(?:^|\s)(\d{4})(?=\s+(?:ユニット|組|$))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sansDate)) !== null) {
    const cand = m[1];
    if (looksLikeFourDigitMonthDay(cand)) continue;
    if (gAdjacent && gAdjacent.length === 3 && cand.startsWith(gAdjacent)) {
      continue;
    }
    return cand;
  }
  return undefined;
}

function isIssueTwoDigitFragment(two: string, issueFour: string): boolean {
  const a = normalizeDigits(two).replace(/\D/g, "");
  const b = normalizeDigits(issueFour).replace(/\D/g, "");
  if (a.length !== 2 || b.length !== 4) return false;
  for (let i = 0; i <= 2; i++) {
    if (b.slice(i, i + 2) === a) return true;
  }
  return false;
}

/** ユニット番号と同じ2桁は組にしない（例: ユニット11→「11」） */
function extractUnitDigits(normalized: string): string | undefined {
  const m = normalizeDigits(normalized).match(/ユニット\s*(\d{1,3})(?!\d)/i);
  return m?.[1];
}

function isPlausibleThreeDigitGroup(s: string): boolean {
  if (s.length !== 3 || !/^\d{3}$/.test(s)) return false;
  const n = parseInt(s, 10);
  return n >= 1 && n <= 399;
}

/**
 * 「組」の直左の組番を取る。
 * 1) まず「左に3桁＋組」→「左に2桁＋組」の順でマッチ（桁数を先に決める）
 * 2) だめなら「組」の直前までの連続数字を切り出し、長さで 3桁→2桁 を試す
 * digitsHint が 2 または 3 のときはその桁に寄せる（回番号で桁が分かっている前提）。
 */
function extractGroupLeftOf組(
  stripped: string,
  issueFour: string | undefined,
  unitDigits: string | undefined,
  digitsHint?: 2 | 3,
): string | undefined {
  const accept2 = (g: string): string | undefined => {
    if (g.length !== 2) return undefined;
    if (issueFour && isIssueTwoDigitFragment(g, issueFour)) return undefined;
    if (unitDigits !== undefined && g === unitDigits) return undefined;
    return g;
  };

  const accept3 = (g: string): string | undefined => {
    if (g.length !== 3) return undefined;
    if (unitDigits !== undefined && g === unitDigits) return undefined;
    return g;
  };

  const tryRegexOrder = (): string | undefined => {
    const try3 = () => {
      const m3 = stripped.match(/(?<!\d)(\d{3})\s*組(?!\d)/);
      if (m3) return accept3(m3[1]);
      return undefined;
    };
    const try2 = () => {
      const m2 = stripped.match(/(?<!\d)(\d{2})\s*組(?!\d)/);
      if (m2) return accept2(m2[1]);
      return undefined;
    };
    const try3as2 = () => {
      const m3 = stripped.match(/(?<!\d)(\d{3})\s*組(?!\d)/);
      if (m3) return accept2(m3[1].slice(0, 2));
      return undefined;
    };
    const try2pad3 = () => {
      const m2 = stripped.match(/(?<!\d)(\d{2})\s*組(?!\d)/);
      if (m2) return accept3(m2[1].padStart(3, "0"));
      return undefined;
    };

    if (digitsHint === 2) {
      return try2() ?? try3as2();
    }
    if (digitsHint === 3) {
      return try3() ?? try2pad3() ?? try2();
    }
    return try3() ?? try2();
  };

  const fromRegex = tryRegexOrder();
  if (fromRegex) return fromRegex;

  const idx組 = stripped.search(/組/);
  if (idx組 < 0) return undefined;
  const left = stripped.slice(0, idx組).replace(/\s+$/g, "");
  const runM = left.match(/(\d+)$/);
  if (!runM) return undefined;
  const run = runM[1];

  if (digitsHint === 2) {
    if (run.length === 2) return accept2(run);
    if (run.length === 3) return accept2(run.slice(0, 2));
    if (run.length >= 3) return accept2(run.slice(-2));
    return undefined;
  }

  if (digitsHint === 3) {
    if (run.length === 3) return accept3(run);
    if (run.length === 2) return accept3(run.padStart(3, "0"));
    if (run.length >= 4) {
      const last3 = run.slice(-3);
      if (isPlausibleThreeDigitGroup(last3)) {
        const g3 = accept3(last3);
        if (g3) return g3;
      }
      return accept3(run.slice(-2).padStart(3, "0"));
    }
    return undefined;
  }

  if (run.length === 2) return accept2(run);
  if (run.length === 3) return accept3(run);

  if (run.length >= 4) {
    const last3 = run.slice(-3);
    const last2 = run.slice(-2);
    if (isPlausibleThreeDigitGroup(last3)) {
      const g3 = accept3(last3);
      if (g3) return g3;
    }
    return accept2(last2);
  }

  return undefined;
}

/** 「組」が欠けたOCRで、6桁番号の直前の 2〜3 桁を組とみなす（例: 62 100801） */
function extractGroupBeforeKnownSixDigits(
  stripped: string,
  six: string,
  issueFour: string | undefined,
  unitDigits: string | undefined,
  digitsHint?: 2 | 3,
): string | undefined {
  const n = six.replace(/\D/g, "");
  if (n.length !== 6) return undefined;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const accept2 = (g: string): string | undefined => {
    if (g.length !== 2) return undefined;
    if (issueFour && isIssueTwoDigitFragment(g, issueFour)) return undefined;
    if (unitDigits !== undefined && g === unitDigits) return undefined;
    return g;
  };
  const accept3 = (g: string): string | undefined => {
    if (g.length !== 3) return undefined;
    if (unitDigits !== undefined && g === unitDigits) return undefined;
    return g;
  };
  const gap = String.raw`(?:\s|\D){0,6}`;
  const re3 = new RegExp(`(?<!\\d)(\\d{3})${gap}${esc}(?!\\d)`);
  const re2 = new RegExp(`(?<!\\d)(\\d{2})${gap}${esc}(?!\\d)`);

  if (digitsHint === 2) {
    const t2 = stripped.match(re2);
    if (t2) return accept2(t2[1]);
    const t3 = stripped.match(re3);
    if (t3) return accept2(t3[1].slice(0, 2));
    return undefined;
  }
  if (digitsHint === 3) {
    const t3 = stripped.match(re3);
    if (t3) {
      const g = accept3(t3[1]);
      if (g) return g;
    }
    const t2 = stripped.match(re2);
    if (t2) return accept3(t2[1].padStart(3, "0"));
    return undefined;
  }
  const t3 = stripped.match(re3);
  if (t3) {
    const g = accept3(t3[1]);
    if (g) return g;
  }
  const t2 = stripped.match(re2);
  if (t2) return accept2(t2[1]);
  return undefined;
}

/** 「組」より後ろに現れる6桁を優先（バーコード列より先に券面番号が来ることが多い） */
function pickSixDigitAfter組(stripped: string, spans: DigitSpan[]): DigitSpan | undefined {
  const six = spans.filter((s) => s.value.length === 6);
  if (six.length === 0) return undefined;
  const m = stripped.match(/(\d{2,3})\s*組|組/);
  const idx = m?.index ?? stripped.search(/組/);
  if (idx < 0) return six.sort((a, b) => a.start - b.start)[0];
  const after = six.filter((s) => s.start >= idx);
  if (after.length > 0) {
    return after.sort((a, b) => a.start - b.start)[0];
  }
  return six.sort((a, b) => a.start - b.start)[0];
}

export type ParseLotteryOcrOptions = {
  /** 組を 2 桁 / 3 桁に固定して読む（undefined＝従来どおり両方試す） */
  groupDigits?: 2 | 3;
};

/**
 * OCRテキストから「組」「番号」を推定する。
 * - 組は「組」の直左の 2桁または3桁（先に桁パターンを試してから切り出し）
 * - 4桁の回番号トークンは除外
 * - 番号は券面では6桁が標準
 * - issueRound は第○○回または先頭付近の4桁（表示用）
 */
export function parseLotteryFromOcr(
  raw: string,
  options?: ParseLotteryOcrOptions,
): {
  group?: string;
  number?: string;
  issueRound?: string;
} {
  const digitsHint = options?.groupDigits;
  const normalized = normalizeOcrForLottery(raw);
  const issueRound = extractIssueRoundFromOcrText(normalized);
  const issueFour =
    issueRound && issueRound.length === 4
      ? issueRound
      : extractIssueFourDigits(normalized);
  const unitDigits = extractUnitDigits(normalized);

  let stripped = stripUnitLine(normalized);
  stripped = stripRoundIssuePhrases(stripped);
  stripped = stripUnitLine(stripped);

  const out: { group?: string; number?: string; issueRound?: string } = {
    issueRound,
  };

  out.group = extractGroupLeftOf組(stripped, issueFour, unitDigits, digitsHint);

  const groupAfter組 = stripped.match(/組[^\d]{0,24}(\d{2,3})(?!\d)/);
  if (!out.group && groupAfter組) {
    let g = groupAfter組[1];
    if (digitsHint === 2 && g.length === 3) g = g.slice(0, 2);
    if (digitsHint === 3 && g.length === 2) g = g.padStart(3, "0");
    const badIssue =
      g.length === 2 &&
      issueFour &&
      isIssueTwoDigitFragment(g, issueFour);
    if (!badIssue) out.group = g;
  }

  const numLabeled = stripped.match(/番(?:号)?[^\d]{0,24}(\d{6})(?!\d)/);
  if (numLabeled) out.number = numLabeled[1];

  if (out.group && out.number) return out;

  const spans = digitSpans(stripped).filter(
    (s) => !isLikelyIssueRoundToken(s.value.length),
  );

  let numberSpan: DigitSpan | undefined;
  if (!out.number) {
    const ticketSpans = spans.filter((s) => s.value.length === 6);
    numberSpan =
      pickSixDigitAfter組(stripped, ticketSpans) ??
      ticketSpans.sort((a, b) => a.start - b.start)[0];
    if (numberSpan) out.number = numberSpan.value;
  } else {
    numberSpan = spans.find((s) => s.value === out.number);
  }

  if (!out.group && out.number) {
    const adj = extractGroupBeforeKnownSixDigits(
      stripped,
      out.number,
      issueFour,
      unitDigits,
      digitsHint,
    );
    if (adj) out.group = adj;
  }

  if (!out.group) {
    const idx組 = stripped.search(/組/);
    let groupCandidates = spans.filter((s) => {
      if (s.value.length < 2 || s.value.length > 3) return false;
      if (digitsHint === 2 && s.value.length !== 2) return false;
      if (numberSpan && spanOverlaps(s, numberSpan)) return false;
      if (idx組 >= 0 && s.end > idx組 + 4) return false;
      return true;
    });

    groupCandidates = groupCandidates.filter((s) => {
      if (
        s.value.length === 2 &&
        issueFour &&
        isIssueTwoDigitFragment(s.value, issueFour)
      ) {
        return false;
      }
      if (unitDigits && s.value === unitDigits) return false;
      return true;
    });

    if (groupCandidates.length === 0) {
      return out;
    }

    const pool =
      idx組 >= 0
        ? groupCandidates.filter((s) => s.end <= idx組 + 2)
        : groupCandidates;
    const usePool = pool.length > 0 ? pool : groupCandidates;

    const threes = usePool.filter((s) => s.value.length === 3);
    const twos = usePool.filter((s) => s.value.length === 2);
    let gPick: DigitSpan | undefined;
    if (digitsHint === 2) {
      gPick = twos.sort((a, b) => b.end - a.end)[0];
    } else if (digitsHint === 3) {
      gPick =
        threes.sort((a, b) => b.end - a.end)[0] ??
        twos.sort((a, b) => b.end - a.end)[0];
    } else {
      gPick =
        threes.sort((a, b) => b.end - a.end)[0] ??
        twos.sort((a, b) => b.end - a.end)[0];
    }

    if (!gPick && numberSpan) {
      const beforeNum = usePool.filter((s) => s.end <= numberSpan.start);
      gPick =
        beforeNum[beforeNum.length - 1] ??
        usePool.find((s) => !spanOverlaps(s, numberSpan)) ??
        usePool[0];
    }
    if (!gPick) gPick = usePool[0];
    const rawG = gPick.value;
    out.group =
      digitsHint === 3 && rawG.length === 2
        ? rawG.padStart(3, "0")
        : rawG;
  }

  return out;
}
