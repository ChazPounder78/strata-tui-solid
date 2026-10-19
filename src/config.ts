export const API_BASE = process.env.STRATA_API ?? "http://127.0.0.1:8080";
export const SYNC_URL = process.env.STRATA_SYNC ?? "http://127.0.0.1:7577/transcript";
export const DEFAULT_MODEL = process.env.STRATA_MODEL ?? "qwen3.8-flash-next-iq3_s";
export const DEFAULT_THINKING = process.env.STRATA_THINKING ?? "xhigh";
export const MAX_FILE_BYTES = Number(process.env.STRATA_MAX_FILE_BYTES ?? 50_000_000);
export const DEFAULT_MAX_CTX = Number(process.env.STRATA_MAX_CTX ?? 196608);
