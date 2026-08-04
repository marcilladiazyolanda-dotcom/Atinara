import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getTemporalDefinitionIssues,
  isReadyForResolution,
} from "../_shared/market-definition.ts";

const MAX_REQUEST_BYTES = 65_536;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getPublishableKey(): string {
  const keysJson = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (keysJson) {
    try {
      const keys = JSON.parse(keysJson) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Fall back to the legacy variable while the project finishes migrating.
    }
  }

  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

function getSecretKey(): string {
  const keysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keysJson) {
    try {
      const keys = JSON.parse(keysJson) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Fall back to the legacy service role variable during key migration.
    }
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function restHeaders(key: string, authorization?: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
  };
  if (authorization) headers.Authorization = authorization;
  else if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function normalizeResult(value: unknown): string | null {
  const result = getText(value).toLowerCase();
  const allowed: Record<string, string> = {
    si: "Sí",
    "sí": "Sí",
    yes: "Sí",
    no: "No",
    anulado: "Anulado",
    anulada: "Anulado",
    void: "Anulado",
  };

  return allowed[result] ?? null;
}

function normalizeSources(value: unknown): JsonRecord[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    return null;
  }

  const sources: JsonRecord[] = [];
  for (const sourceValue of value) {
    if (!isRecord(sourceValue)) return null;

    const title = getText(sourceValue.title);
    const url = getText(sourceValue.url);
    const citedText = getText(sourceValue.cited_text).slice(0, 1000);

    if (
      title.length < 2 || title.length > 200 || url.length > 2048 ||
      !/^https:\/\//i.test(url)
    ) {
      return null;
    }

    sources.push({ title, url, cited_text: citedText });
  }

  return sources;
}

function friendlyDatabaseError(message: string): {
  error: string;
  message: string;
  status: number;
} {
  const errors = [
    {
      match: "MARKET_ALREADY_RESOLVED",
      error: "MARKET_ALREADY_RESOLVED",
      message: "Este mercado ya esta resuelto.",
      status: 409,
    },
    {
      match: "MARKET_NOT_CLOSED",
      error: "MARKET_NOT_CLOSED",
      message: "El mercado todavia no esta cerrado.",
      status: 409,
    },
    {
      match: "MARKET_NOT_FOUND",
      error: "MARKET_NOT_FOUND",
      message: "No se ha encontrado el mercado.",
      status: 404,
    },
    {
      match: "INVALID_RESOLUTION_RESULT",
      error: "INVALID_RESOLUTION_RESULT",
      message: "El resultado debe ser Si, No o Anulado.",
      status: 400,
    },
    {
      match: "INVALID_RESOLUTION_SOURCE",
      error: "INVALID_RESOLUTION_SOURCE",
      message: "Una de las fuentes no es valida.",
      status: 400,
    },
  ];

  return errors.find((item) => message.includes(item.match)) ?? {
    error: "RESOLUTION_FAILED",
    message: "No se ha podido resolver el mercado.",
    status: 500,
  };
}

type ApprovalEnvironment = {
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
};

type ApprovalInput = {
  marketId: string;
  result: string;
  note: string;
  sources: JsonRecord[];
  model: string | null;
  generatedAt: string | null;
};

function getApprovalEnvironment(): ApprovalEnvironment | null {
  const environment = {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    publishableKey: getPublishableKey(),
    secretKey: getSecretKey(),
  };
  return Object.values(environment).every(Boolean) ? environment : null;
}

function getApprovalRequestRejection(req: Request): Response | null {
  if (req.method !== "POST") {
    return jsonResponse({
      error: "METHOD_NOT_ALLOWED",
      message: "Usa una peticion POST.",
    }, 405);
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) {
    return jsonResponse({
      error: "REQUEST_TOO_LARGE",
      message: "La peticion es demasiado grande.",
    }, 413);
  }
  if (!(req.headers.get("authorization") ?? "").startsWith("Bearer ")) {
    return jsonResponse({
      error: "AUTH_REQUIRED",
      message: "Inicia sesion para continuar.",
    }, 401);
  }
  return null;
}

async function authenticateApprovalAdmin(
  environment: ApprovalEnvironment,
  authorization: string,
): Promise<{ userId: string; errorResponse: null } | {
  userId: null;
  errorResponse: Response;
}> {
  const userResponse = await fetch(`${environment.supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: authorization,
      apikey: environment.publishableKey,
    },
  });
  if (!userResponse.ok) {
    return {
      userId: null,
      errorResponse: jsonResponse({
        error: "AUTH_REQUIRED",
        message: "Tu sesion no es valida.",
      }, 401),
    };
  }

  const user = await userResponse.json() as JsonRecord;
  const userId = getText(user.id);
  const appMetadata = isRecord(user.app_metadata) ? user.app_metadata : {};
  if (userId && appMetadata.oraklo_admin === true) {
    return { userId, errorResponse: null };
  }
  return {
    userId: null,
    errorResponse: jsonResponse({
      error: "ADMIN_REQUIRED",
      message: "Esta herramienta es solo para administracion.",
    }, 403),
  };
}

function normalizeGeneratedAt(value: unknown): string | null {
  const text = getText(value);
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function parseApprovalInput(requestBody: JsonRecord): {
  input: ApprovalInput | null;
  errorResponse: Response | null;
} {
  const marketId = getText(requestBody.market_id);
  const result = normalizeResult(requestBody.result);
  const note = getText(requestBody.resolution_note);
  const sources = normalizeSources(requestBody.sources);

  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(marketId)) {
    return { input: null, errorResponse: jsonResponse({
      error: "INVALID_MARKET_ID",
      message: "El identificador del mercado no es valido.",
    }, 400) };
  }
  if (!result) {
    return { input: null, errorResponse: jsonResponse({
      error: "INVALID_RESOLUTION_RESULT",
      message: "El resultado debe ser Si, No o Anulado.",
    }, 400) };
  }
  if (note.length < 10 || note.length > 4000) {
    return { input: null, errorResponse: jsonResponse({
      error: "INVALID_RESOLUTION_NOTE",
      message: "Escribe una explicacion de entre 10 y 4.000 caracteres.",
    }, 400) };
  }
  if (!sources) {
    return { input: null, errorResponse: jsonResponse({
      error: "INVALID_RESOLUTION_SOURCES",
      message: "Selecciona entre 1 y 12 fuentes HTTPS validas.",
    }, 400) };
  }

  return {
    input: {
      marketId,
      result,
      note,
      sources,
      model: getText(requestBody.ai_model).slice(0, 100) || null,
      generatedAt: normalizeGeneratedAt(requestBody.ai_generated_at),
    },
    errorResponse: null,
  };
}

async function verifyMarketForApproval(
  environment: ApprovalEnvironment,
  authorization: string,
  marketId: string,
): Promise<Response | null> {
  const marketResponse = await fetch(
    `${environment.supabaseUrl}/rest/v1/rpc/get_admin_market_for_resolution`,
    {
      method: "POST",
      headers: restHeaders(environment.publishableKey, authorization),
      body: JSON.stringify({ market_id_input: marketId }),
    },
  );
  const market = await marketResponse.json().catch(() => ({})) as JsonRecord;
  if (!marketResponse.ok) {
    return jsonResponse({
      error: "MARKET_LOOKUP_FAILED",
      message: "No se ha podido volver a comprobar el mercado.",
    }, 502);
  }
  if (!isReadyForResolution(market)) {
    return jsonResponse({
      error: "MARKET_PERIOD_NOT_COMPLETE",
      message: "El periodo original que debe investigarse todavía no ha terminado.",
    }, 409);
  }
  const definitionIssues = getTemporalDefinitionIssues(market);
  if (!definitionIssues.length) return null;
  return jsonResponse({
    error: "MARKET_DEFINITION_BLOCKED",
    message: "La definición temporal es incoherente. El mercado no se ha liquidado.",
    blocking_reasons: definitionIssues,
  }, 409);
}

async function resolveApprovedMarket(
  environment: ApprovalEnvironment,
  input: ApprovalInput,
  userId: string,
): Promise<Response> {
  const resolutionResponse = await fetch(
    `${environment.supabaseUrl}/rest/v1/rpc/resolve_market_with_evidence`,
    {
      method: "POST",
      headers: restHeaders(environment.secretKey),
      body: JSON.stringify({
        market_id_input: input.marketId,
        result_input: input.result,
        resolution_note_input: input.note,
        resolution_sources_input: input.sources,
        reviewed_by_input: userId,
        ai_model_input: input.model,
        ai_generated_at_input: input.generatedAt,
      }),
    },
  );
  if (!resolutionResponse.ok) {
    const errorPayload = await resolutionResponse.json().catch(() => ({})) as JsonRecord;
    const databaseMessage = getText(errorPayload.message);
    console.error("Resolution RPC failed", resolutionResponse.status, databaseMessage);
    const friendly = friendlyDatabaseError(databaseMessage);
    return jsonResponse(
      { error: friendly.error, message: friendly.message },
      friendly.status,
    );
  }
  const resolution = await resolutionResponse.json();
  return jsonResponse({
    ok: true,
    resolution,
    message: "Mercado resuelto con aprobacion humana y fuentes verificables.",
  });
}

async function runApproval(
  req: Request,
  environment: ApprovalEnvironment,
  authorization: string,
): Promise<Response> {
  const admin = await authenticateApprovalAdmin(environment, authorization);
  if (admin.errorResponse) return admin.errorResponse;
  const parsed = parseApprovalInput(await req.json() as JsonRecord);
  if (parsed.errorResponse || !parsed.input) return parsed.errorResponse as Response;
  const marketError = await verifyMarketForApproval(
    environment,
    authorization,
    parsed.input.marketId,
  );
  if (marketError) return marketError;
  return resolveApprovedMarket(environment, parsed.input, admin.userId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const requestRejection = getApprovalRequestRejection(req);
  if (requestRejection) return requestRejection;

  const environment = getApprovalEnvironment();
  if (!environment) {
    console.error("Missing required Supabase Edge Function variables.");
    return jsonResponse({
      error: "SERVER_NOT_CONFIGURED",
      message: "La aprobacion segura no esta configurada.",
    }, 500);
  }

  try {
    const authorization = req.headers.get("authorization") ?? "";
    return await runApproval(req, environment, authorization);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error("Approval failed", errorName);
    return jsonResponse({
      error: "APPROVAL_FAILED",
      message: "No se ha podido completar la aprobacion.",
    }, 500);
  }
});
