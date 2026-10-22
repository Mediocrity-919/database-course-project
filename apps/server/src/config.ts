import "dotenv/config";
export interface Config {
  uri: string;
  origins: string[];
  publicBaseUrl: string;
  hmacKey: string;
  secure: boolean;
  sessionHours: number;
  port: number;
  host: string;
  production: boolean;
}
export function config(): Config {
  const hmacKey = process.env.PARTICIPANT_HMAC_KEY ?? "";
  if (hmacKey.length < 32 || hmacKey === "generate-with-npm-run-setup")
    throw new Error("请先执行 npm run setup 生成 .env 和持久 HMAC 密钥");
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
  const url = new URL(publicBaseUrl);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("PUBLIC_BASE_URL 无效");
  return {
    uri:
      process.env.MONGODB_URI ??
      "mongodb://127.0.0.1:27018/questionnaire_stage1?replicaSet=survey-rs",
    origins: (process.env.APP_ORIGIN ?? "http://localhost:3000")
      .split(",")
      .map((x) => x.trim()),
    publicBaseUrl: url.origin,
    hmacKey,
    secure: process.env.COOKIE_SECURE === "true",
    sessionHours: Number(process.env.SESSION_TTL_HOURS ?? 24),
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "127.0.0.1",
    production: process.env.NODE_ENV === "production",
  };
}
