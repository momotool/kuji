const ENV_KEY = "NEXT_PUBLIC_LOTTERY_TEST_MODE";

/** ビルド時に埋め込まれる既定のテストモード（クライアントで参照） */
export function defaultTestModeFromEnv(): boolean {
  const v = process.env[ENV_KEY];
  return v === "1" || v?.toLowerCase() === "true";
}
