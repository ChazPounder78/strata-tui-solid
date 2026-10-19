export const API_BASE = process.env.STRATA_API ?? "http://127.0.0.1:8080";
export const SYNC_URL = process.env.STRATA_SYNC ?? "http://127.0.0.1:7577/transcript";
export const DEFAULT_MODEL = "local";
export const DEFAULT_THINKING = "high";
export const MAX_FILE_BYTES = 512 * 1024;
