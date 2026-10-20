// Stable RPC error codes (SPEC §11.4). RPCs RAISE with ERRCODE 'P0001', MESSAGE = code and
// DETAIL = JSON. Server actions map every failure to one of these codes or to UNKNOWN.

export const ERROR_CODES = [
  "NOT_AUTHENTICATED",
  "NO_PROFILE",
  "FORBIDDEN",
  "NOT_FOUND",
  "WORKSHOP_REQUIRED",
  "VALIDATION",
  "IDEMPOTENCY_KEY_REUSED",
  "INVARIANT_VIOLATION",
  "INVALID_TRANSITION",
  "MFG_YEAR_OUT_OF_RANGE",
  "FINDINGS_LOCKED",
  "UNRESOLVED_FINDINGS",
  "JOB_CARD_NOT_CONFIRMED",
  "LINE_CANCELLED",
  "BIKE_NOT_ARRIVED",
  "BIKE_NOT_ACTIVE",
  "OPEN_LINES",
  "ISSUED_PARTS_OUTSTANDING",
  "RETURN_PARTS_FIRST",
  "INSUFFICIENT_RESERVATION",
  "INSUFFICIENT_BIN_STOCK",
  "BIN_NOT_ISSUABLE",
  "BIN_KIND_NOT_ALLOWED",
  "RETURN_EXCEEDS_ISSUED",
  "STALE_COUNT",
  "OVER_RECEIPT",
  "DUPLICATE_INVOICE",
  "PO_NOT_SENDABLE",
  "PO_NOT_RECEIVABLE",
  "ALREADY_RECEIVED",
  "BILL_NOT_FOUND",
  "RESET_IN_PROGRESS",
  "RESET_COOLDOWN",
  "DEMO_TEMPLATE_STALE",
  "SESSION_EXPIRED",
  "SESSION_CHANGED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
export type ResultCode = ErrorCode | "UNKNOWN";
type Lang = "en" | "hi";

export const ERROR_MESSAGES: Record<ErrorCode, Record<Lang, string>> = {
  NOT_AUTHENTICATED: {
    en: "You are signed out. Sign in again.",
    hi: "आप साइन आउट हो गए हैं। फिर से साइन इन करें।",
  },
  NO_PROFILE: {
    en: "Your account has no workshop access. Ask an admin.",
    hi: "आपके खाते को वर्कशॉप की अनुमति नहीं है। एडमिन से पूछें।",
  },
  FORBIDDEN: {
    en: "Your role cannot do this.",
    hi: "आपकी भूमिका यह काम नहीं कर सकती।",
  },
  NOT_FOUND: {
    en: "Not found in your workshop.",
    hi: "आपकी वर्कशॉप में नहीं मिला।",
  },
  WORKSHOP_REQUIRED: {
    en: "Pick a workshop first.",
    hi: "पहले वर्कशॉप चुनें।",
  },
  VALIDATION: {
    en: "Some values are not valid. Check the form.",
    hi: "कुछ जानकारी सही नहीं है। फ़ॉर्म जाँचें।",
  },
  IDEMPOTENCY_KEY_REUSED: {
    en: "Your earlier submit was saved.",
    hi: "आपका पिछला सबमिट सेव हो गया था।",
  },
  INVARIANT_VIOLATION: {
    en: "Stock numbers would become inconsistent, so nothing was saved.",
    hi: "स्टॉक संख्या गड़बड़ हो जाती, इसलिए कुछ सेव नहीं हुआ।",
  },
  INVALID_TRANSITION: {
    en: "This is not allowed in the current status.",
    hi: "मौजूदा स्थिति में यह संभव नहीं है।",
  },
  MFG_YEAR_OUT_OF_RANGE: {
    en: "The manufacturing year is outside this model's years.",
    hi: "निर्माण वर्ष इस मॉडल के वर्षों से बाहर है।",
  },
  FINDINGS_LOCKED: {
    en: "Findings are locked once the job card is confirmed.",
    hi: "जॉब कार्ड कन्फर्म होने के बाद फाइंडिंग्स बदली नहीं जा सकतीं।",
  },
  UNRESOLVED_FINDINGS: {
    en: "Resolve every finding before confirming.",
    hi: "कन्फर्म करने से पहले हर फाइंडिंग का हल चुनें।",
  },
  JOB_CARD_NOT_CONFIRMED: {
    en: "The job card is not confirmed yet.",
    hi: "जॉब कार्ड अभी कन्फर्म नहीं हुआ है।",
  },
  LINE_CANCELLED: {
    en: "This line was cancelled.",
    hi: "यह लाइन रद्द हो चुकी है।",
  },
  BIKE_NOT_ARRIVED: {
    en: "The bike has not arrived at the workshop yet.",
    hi: "बाइक अभी वर्कशॉप नहीं पहुँची है।",
  },
  BIKE_NOT_ACTIVE: {
    en: "The bike is no longer active.",
    hi: "बाइक अब सक्रिय नहीं है।",
  },
  OPEN_LINES: {
    en: "Some lines are still open.",
    hi: "कुछ लाइनें अभी खुली हैं।",
  },
  ISSUED_PARTS_OUTSTANDING: {
    en: "Issued parts must be returned or kept first.",
    hi: "पहले जारी किए गए पार्ट्स वापस करें या रखें।",
  },
  RETURN_PARTS_FIRST: {
    en: "Return the issued parts first.",
    hi: "पहले जारी पार्ट्स वापस करें।",
  },
  INSUFFICIENT_RESERVATION: {
    en: "Not enough reserved stock. The screen was refreshed.",
    hi: "आरक्षित स्टॉक कम है। स्क्रीन रिफ्रेश की गई।",
  },
  INSUFFICIENT_BIN_STOCK: {
    en: "Not enough stock in this bin. The screen was refreshed.",
    hi: "इस बिन में स्टॉक कम है। स्क्रीन रिफ्रेश की गई।",
  },
  BIN_NOT_ISSUABLE: {
    en: "Parts cannot be issued from this bin.",
    hi: "इस बिन से पार्ट्स जारी नहीं हो सकते।",
  },
  BIN_KIND_NOT_ALLOWED: {
    en: "This bin type is not allowed here.",
    hi: "यहाँ इस प्रकार का बिन नहीं चलेगा।",
  },
  RETURN_EXCEEDS_ISSUED: {
    en: "You cannot return more than was issued.",
    hi: "जितना जारी हुआ उससे ज़्यादा वापस नहीं हो सकता।",
  },
  STALE_COUNT: {
    en: "Stock changed since you started counting. The screen was refreshed.",
    hi: "गिनती शुरू होने के बाद स्टॉक बदल गया। स्क्रीन रिफ्रेश की गई।",
  },
  OVER_RECEIPT: {
    en: "More than the open quantity on the PO.",
    hi: "PO की बाकी मात्रा से ज़्यादा है।",
  },
  DUPLICATE_INVOICE: {
    en: "This supplier invoice was already received.",
    hi: "यह सप्लायर इनवॉइस पहले ही प्राप्त हो चुका है।",
  },
  PO_NOT_SENDABLE: {
    en: "This PO cannot be sent.",
    hi: "यह PO भेजा नहीं जा सकता।",
  },
  PO_NOT_RECEIVABLE: {
    en: "This PO cannot be received.",
    hi: "यह PO प्राप्त नहीं किया जा सकता।",
  },
  ALREADY_RECEIVED: {
    en: "Already received.",
    hi: "पहले ही प्राप्त हो चुका है।",
  },
  BILL_NOT_FOUND: {
    en: "The bill photo was not found. Upload it again.",
    hi: "बिल की फ़ोटो नहीं मिली। फिर से अपलोड करें।",
  },
  RESET_IN_PROGRESS: {
    en: "A demo reset is already running.",
    hi: "डेमो रीसेट पहले से चल रहा है।",
  },
  RESET_COOLDOWN: {
    en: "The demo was reset moments ago. Try again in a minute.",
    hi: "डेमो अभी-अभी रीसेट हुआ है। एक मिनट बाद कोशिश करें।",
  },
  DEMO_TEMPLATE_STALE: {
    en: "The demo template is out of date. Run pnpm seed:gen and reload the template.",
    hi: "डेमो टेम्पलेट पुराना है। pnpm seed:gen चलाकर टेम्पलेट फिर से लोड करें।",
  },
  SESSION_EXPIRED: {
    en: "Your session expired. Sign in again.",
    hi: "आपका सेशन खत्म हो गया। फिर से साइन इन करें।",
  },
  SESSION_CHANGED: {
    en: "You signed in as someone else in another tab. Reload this page.",
    hi: "आपने दूसरे टैब में किसी और खाते से साइन इन किया है। यह पेज रीलोड करें।",
  },
};

export const UNKNOWN_MESSAGE: Record<Lang, string> = {
  en: "Something went wrong (ref {ref})",
  hi: "कुछ गड़बड़ हो गई (रेफ़ {ref})",
};

const CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && CODE_SET.has(value);
}

// lock_timeout (55P03) and deadlock (40P01): safe to retry once with the same request_id.
const RETRYABLE_SQLSTATES = new Set(["55P03", "40P01"]);
// PostgREST JWT errors: expired or invalid token.
const SESSION_EXPIRED_CODES = new Set(["PGRST301", "PGRST303"]);

export type RpcErrorLike = { code?: string | null; message?: string | null; details?: string | null };

export type ParsedRpcError = {
  code: ResultCode;
  detail: unknown;
  retryable: boolean;
  /** The SQLSTATE or PostgREST code as received, for logging. */
  rawCode: string;
  rawMessage: string;
};

/** Reads MESSAGE as the stable code and DETAIL as JSON (SPEC §11.4). */
export function parseRpcError(error: RpcErrorLike): ParsedRpcError {
  const rawCode = error.code ?? "";
  const rawMessage = error.message ?? "";
  const base = { detail: null as unknown, retryable: false, rawCode, rawMessage };

  if (SESSION_EXPIRED_CODES.has(rawCode)) return { ...base, code: "SESSION_EXPIRED" };
  if (RETRYABLE_SQLSTATES.has(rawCode)) return { ...base, code: "UNKNOWN", retryable: true };
  if (rawCode === "P0001" && isErrorCode(rawMessage)) {
    return { ...base, code: rawMessage, detail: parseDetail(error.details) };
  }
  return { ...base, code: "UNKNOWN" };
}

function parseDetail(details: string | null | undefined): unknown {
  if (!details) return null;
  try {
    return JSON.parse(details);
  } catch {
    return null;
  }
}

/** The user-facing message for a code. UNKNOWN includes the ref id of the app_errors row. */
export function errorMessage(code: ResultCode, lang: Lang, ref?: string): string {
  if (code === "UNKNOWN") return UNKNOWN_MESSAGE[lang].replace("{ref}", ref ?? "—");
  return ERROR_MESSAGES[code][lang];
}
