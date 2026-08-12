import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getTemporalDefinitionIssues,
  isReadyForResolution,
} from "../_shared/market-definition.ts";
import { createAiGateway } from "../_shared/ai/gateway.mjs";
import { asAiGatewayError } from "../_shared/ai/errors.mjs";
import {
  createAbsoluteExecutionContext,
  createChildAbort,
  fetchWithinDeadline,
} from "../_shared/ai/deadline.mjs";
import { AI_TASK_CONTRACTS } from "../_shared/ai/task-policy.mjs";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_REQUEST_TIMEOUT_MS = 25_000;
const OPERATION_TIMEOUT_MS = 100_000;
const FINALIZATION_RESERVE_MS = 10_000;
const MAX_REQUEST_BYTES = 8_192;
const MAX_RESEARCH_TEXT_LENGTH = 20_000;
const DEFINITION_CHECK_MODEL = "oraklo-definition-check-v1";
const ORAKLO_PUBLIC_SITE_URL =
  "https://marcilladiazyolanda-dotcom.github.io/Atinara/";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

type EvidenceOutput = {
  text: string;
  sources: JsonRecord[];
  searchQueries: string[];
};

type TavilyProviderResult = {
  ok: boolean;
  status: number;
  payload: JsonRecord | null;
  detail: string;
};

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

function getPublishableKey(): string {
  const keysJson = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");

  if (keysJson) {
    try {
      const keys = JSON.parse(keysJson) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Fall back to the legacy variable while the project finishes migrating keys.
    }
  }

  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "Fuente web";
  }
}

function normalizeMarket(payload: unknown): JsonRecord | null {
  if (Array.isArray(payload)) {
    return isRecord(payload[0]) ? payload[0] : null;
  }

  return isRecord(payload) ? payload : null;
}

function isMarketClosed(market: JsonRecord): boolean {
  return isReadyForResolution(market);
}

function getMarketEvidence(market: JsonRecord): JsonRecord {
  return {
    question: getText(market.question),
    description: getText(market.description),
    closes_at: getText(market.closes_at),
    evaluation_ends_at: getText(market.evaluation_ends_at),
    resolution_deadline: getText(market.resolution_deadline),
    participation_closed_at: getText(market.participation_closed_at),
    resolution_source: getText(market.resolution_source),
    yes_criteria: getText(market.yes_criteria),
    no_criteria: getText(market.no_criteria),
    edge_case: getText(market.edge_case),
  };
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function hasExplicitDateAnchor(value: string): boolean {
  const normalized = normalizeForMatch(value);
  const month =
    "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre";

  return new RegExp(String.raw`\b\d{1,2}\s+de\s+(?:${month})\s+de\s+20\d{2}\b`)
    .test(normalized) ||
    /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/.test(normalized) ||
    /\b\d{1,2}[/.-]\d{1,2}[/.-]20\d{2}\b/.test(normalized);
}

function getMarketDefinitionIssues(market: JsonRecord): string[] {
  const question = getText(market.question);
  const description = getText(market.description);
  const definingText = `${question} ${description}`;
  const normalized = normalizeForMatch(definingText);
  const relativeReference = /\b(ultimo|ultima|ultimos|ultimas|proximo|proxima|proximos|proximas)\b/
    .exec(normalized)?.[0];

  if (!relativeReference || hasExplicitDateAnchor(definingText)) return [];

  const issues = [
    `La expresion relativa "${relativeReference}" no esta vinculada a una fecha exacta en la pregunta ni en la descripcion.`,
    "El evento, contenido o periodo que debe evaluarse no queda identificado de forma univoca, por lo que dos revisores podrian resolver mercados distintos.",
  ];
  const resolutionSource = getText(market.resolution_source);

  if (!/https:\/\//i.test(resolutionSource)) {
    issues.push(
      "La fuente de resolucion es generica y no identifica una publicacion oficial concreta que elimine la ambiguedad.",
    );
  }

  return issues;
}

function getMarketDetailUrl(marketId: string): string {
  const url = new URL("market-detail.html", ORAKLO_PUBLIC_SITE_URL);
  url.searchParams.set("id", marketId);
  return url.href;
}

function getMarketSummary(market: JsonRecord): JsonRecord {
  return {
    id: getText(market.id),
    question: getText(market.question),
    status: getText(market.status),
    closes_at: getText(market.closes_at),
  };
}

function buildDefinitionIssueResponse(
  market: JsonRecord,
  issues: string[],
): JsonRecord {
  const sourceTitle = "Ficha original y criterios del mercado en Atinara";
  const citedText = [
    `Pregunta: ${getText(market.question)}`,
    `Descripcion: ${getText(market.description)}`,
    `Criterio de Si: ${getText(market.yes_criteria)}`,
    `Criterio de No: ${getText(market.no_criteria)}`,
    `Fuente prevista: ${getText(market.resolution_source)}`,
  ].filter(Boolean).join(" ").slice(0, 1_000);
  return {
    ok: true,
    market: getMarketSummary(market),
    analysis_kind: "definition_check",
    analysis: {
      proposed_result: "No concluyente",
      confidence: "Alta",
      summary:
        "La definición presenta un bloqueo y no debe preseleccionarse ningún resultado.",
      reasons: issues.slice(0, 6),
      cutoff_analysis:
        "La ambiguedad ya existe en la ficha original y no puede corregirse despues del cierre sin alterar las condiciones para quienes participaron.",
      caveats: [
        "No selecciones Sí, No ni Anulado mientras permanezca este bloqueo.",
      ],
      recommended_note: "",
      source_dates: [{
        title: sourceTitle,
        published_at: "No aplica",
        relevance: "Documenta la redaccion y los criterios ambiguos originales.",
      }],
    },
    sources: [{
      title: sourceTitle,
      url: getMarketDetailUrl(getText(market.id)),
      cited_text: citedText,
    }],
    search_queries: [],
    evidence_warning:
      "Revisión necesaria. La liquidación permanece bloqueada y no se ha modificado ningún saldo.",
    model: DEFINITION_CHECK_MODEL,
    research_model: "not_applicable",
    provider_api: "definition-check",
    generated_at: new Date().toISOString(),
    can_resolve_market: false,
  };
}

function buildNoEvidenceResponse(market: JsonRecord): JsonRecord {
  return {
    ok: true,
    market: getMarketSummary(market),
    analysis_kind: "no_evidence",
    analysis: {
      proposed_result: "No concluyente",
      confidence: "Baja",
      summary:
        "El mercado parece estar definido, pero la busqueda no ha encontrado pruebas suficientes para proponer Si o No.",
      reasons: [
        "No se han obtenido fuentes verificables anteriores al cierre con las que aplicar los criterios.",
      ],
      cutoff_analysis:
        "Sin una fuente fechada antes del cierre no puede comprobarse el resultado de forma segura.",
      caveats: [
        "No confirmes una resolucion hasta localizar y revisar al menos una fuente oficial.",
      ],
      recommended_note: "",
      source_dates: [],
    },
    sources: [],
    search_queries: [],
    evidence_warning:
      "No se han encontrado fuentes. El mercado permanece pendiente y no se ha modificado ningun saldo.",
    model: null,
    research_model: "tavily-search-basic",
    provider_api: "research:tavily;analysis:not-run",
    generated_at: new Date().toISOString(),
    can_resolve_market: false,
  };
}

function compactSearchQuery(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ").slice(
    0,
    400,
  );
}

function buildTavilyQueries(market: JsonRecord): string[] {
  const question = getText(market.question);
  const closesAt = getText(market.closes_at);
  const resolutionSource = getText(market.resolution_source);
  const yesCriteria = getText(market.yes_criteria);
  const noCriteria = getText(market.no_criteria);

  return [
    compactSearchQuery([
      question,
      resolutionSource,
      `fuente oficial anuncio resultado antes de ${closesAt}`,
    ]),
    compactSearchQuery([
      question,
      `pruebas del criterio de Si: ${yesCriteria}`,
      `antes de ${closesAt}`,
    ]),
    compactSearchQuery([
      question,
      `pruebas del criterio de No: ${noCriteria}`,
      `antes de ${closesAt}`,
    ]),
  ].filter((query, index, queries) =>
    Boolean(query) && queries.indexOf(query) === index
  );
}

function getTavilyEndDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function readTavilyResponse(
  response: Response,
): Promise<TavilyProviderResult> {
  const responseText = await response.text();
  let payload: JsonRecord | null = null;

  try {
    const parsed = JSON.parse(responseText);
    payload = isRecord(parsed) ? parsed : null;
  } catch {
    // Keep the shortened text only in private function logs.
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
    detail: response.ok ? "" : responseText.slice(0, 600),
  };
}

async function requestTavilySearch(
  apiKey: string,
  query: string,
  endDate: string | null,
  execution: AnalysisEnvironment["execution"],
): Promise<TavilyProviderResult> {
  const child = createChildAbort(
    execution,
    TAVILY_REQUEST_TIMEOUT_MS,
    FINALIZATION_RESERVE_MS,
  );
  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        topic: "general",
        max_results: 6,
        end_date: endDate ?? undefined,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        auto_parameters: false,
        include_usage: true,
      }),
      signal: child.signal,
    });

    return await readTavilyResponse(response);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: null,
      detail: error instanceof DOMException && error.name === "TimeoutError"
        ? "timeout"
        : "network_error",
    };
  } finally {
    child.cleanup();
  }
}

function getFriendlyTavilyFailure(result: TavilyProviderResult): {
  error: string;
  message: string;
  status: number;
} {
  if ([429, 432, 433].includes(result.status)) {
    return {
      error: "SEARCH_QUOTA_EXCEEDED",
      message:
        "Se ha alcanzado el limite gratuito de busquedas de Tavily. Revisa el consumo o reintentalo cuando se renueve.",
      status: 429,
    };
  }

  if ([401, 403].includes(result.status)) {
    return {
      error: "SEARCH_CONFIGURATION_ERROR",
      message:
        "Tavily ha rechazado la clave configurada. Revisa el secreto TAVILY_API_KEY.",
      status: 502,
    };
  }

  if (result.status === 0 && result.detail === "timeout") {
    return {
      error: "SEARCH_TIMEOUT",
      message: "La busqueda ha tardado demasiado. Reintentalo.",
      status: 504,
    };
  }

  return {
    error: "SEARCH_PROVIDER_ERROR",
    message:
      "Tavily no ha podido completar la busqueda. Reintentalo antes de resolver el mercado.",
    status: 502,
  };
}

function normalizeHttpsUrl(value: unknown): string {
  const rawUrl = getText(value);
  if (!URL.canParse(rawUrl)) return "";
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") return "";
  url.hash = "";
  return url.href.length <= 2_048 ? url.href : "";
}

function collectTavilyResult(
  resultValue: unknown,
  sourceByUrl: Map<string, { source: JsonRecord; score: number }>,
): void {
  if (!isRecord(resultValue)) return;
  const url = normalizeHttpsUrl(resultValue.url);
  const citedText = getText(resultValue.content).slice(0, 1_200);
  if (!url || !citedText) return;

  const title = getText(resultValue.title).slice(0, 200) || getHostname(url);
  const scoreValue = Number(resultValue.score);
  const score = Number.isFinite(scoreValue) ? scoreValue : 0;
  const previous = sourceByUrl.get(url);
  if (previous && score <= previous.score) return;
  sourceByUrl.set(url, {
    source: { title, url, cited_text: citedText },
    score,
  });
}

function collectTavilyResponse(
  response: TavilyProviderResult,
  sourceByUrl: Map<string, { source: JsonRecord; score: number }>,
  executedQueries: Set<string>,
): void {
  if (!response.payload) return;
  const executedQuery = getText(response.payload.query);
  if (executedQuery) executedQueries.add(executedQuery);
  const results = Array.isArray(response.payload.results)
    ? response.payload.results
    : [];
  results.forEach((result) => collectTavilyResult(result, sourceByUrl));
}

async function researchWithTavily(
  apiKey: string,
  market: JsonRecord,
  execution: AnalysisEnvironment["execution"],
): Promise<
  | { ok: true; research: EvidenceOutput }
  | { ok: false; failure: ReturnType<typeof getFriendlyTavilyFailure> }
> {
  const queries = buildTavilyQueries(market);
  const endDate = getTavilyEndDate(getText(market.closes_at));
  const responses = await Promise.all(
    queries.map((query) =>
      requestTavilySearch(apiKey, query, endDate, execution)
    ),
  );
  const successfulResponses = responses.filter((response) =>
    response.ok && response.payload
  );

  responses.filter((response) => !response.ok).forEach((response) => {
    console.error("Tavily search failed", response.status, response.detail);
  });

  if (!successfulResponses.length) {
    return {
      ok: false,
      failure: getFriendlyTavilyFailure(responses[0] ?? {
        ok: false,
        status: 0,
        payload: null,
        detail: "network_error",
      }),
    };
  }

  const sourceByUrl = new Map<
    string,
    { source: JsonRecord; score: number }
  >();
  const executedQueries = new Set<string>();

  successfulResponses.forEach((response) => {
    collectTavilyResponse(response, sourceByUrl, executedQueries);
  });

  const sources = [...sourceByUrl.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
    .map((entry) => entry.source);

  if (!sources.length) {
    return {
      ok: false,
      failure: {
        error: "SEARCH_NO_EVIDENCE",
        message:
          "Tavily no ha encontrado fuentes verificables para este mercado. Reintentalo o usa la resolucion manual.",
        status: 422,
      },
    };
  }

  console.log(
    "Tavily research completed",
    JSON.stringify({
      requested_queries: queries.length,
      successful_queries: successfulResponses.length,
      sources: sources.length,
      end_date: endDate,
    }),
  );

  const text = sources.map((source, index) =>
    `FUENTE ${index + 1}: ${getText(source.title)}\n` +
    `URL: ${getText(source.url)}\n` +
    `EXTRACTO: ${getText(source.cited_text)}`
  ).join("\n\n");

  return {
    ok: true,
    research: {
      text,
      sources,
      searchQueries: [...executedQueries].slice(0, 12),
    },
  };
}

async function analyzeWithGateway(
  environment: AnalysisEnvironment,
  market: JsonRecord,
  research: EvidenceOutput,
): Promise<
  | {
    ok: true;
    analysis: JsonRecord;
    transportMode: string;
    telemetryStatus: string;
    warnings: readonly string[];
  }
  | {
    ok: false;
    failure: { error: string; message: string; status: number };
  }
> {
  try {
    const gateway = createAiGateway({
      supabaseUrl: environment.supabaseUrl,
      supabaseSecretKey: environment.secretKey,
    });
    const result = await gateway.generateStructured({
      taskType: "market_resolution_analysis",
      ...AI_TASK_CONTRACTS.market_resolution_analysis,
      input: {
        market: getMarketEvidence(market),
        researchText: research.text.slice(0, MAX_RESEARCH_TEXT_LENGTH),
        sources: research.sources.map((source) => ({
          title: getText(source.title),
          url: getText(source.url),
          cited_text: getText(source.cited_text),
        })),
        searchQueries: research.searchQueries,
      },
    }, environment.execution);
    return {
      ok: true,
      analysis: result.value as JsonRecord,
      transportMode: result.metadata.transportMode,
      telemetryStatus: result.telemetryStatus,
      warnings: result.warnings,
    };
  } catch (error) {
    const gatewayError = asAiGatewayError(error);
    console.error("Resolution AI Gateway failed", JSON.stringify({
      code: gatewayError.code,
      invocation_id: environment.execution.invocationId,
    }));
    return {
      ok: false,
      failure: {
        error: gatewayError.code,
        message: gatewayError.code === "AI_PROVIDER_NOT_CONFIGURED"
          ? "El analizador de evidencia no esta configurado. Usa la resolucion manual con fuentes verificadas."
          : gatewayError.code === "AI_MODEL_NOT_AVAILABLE"
          ? "El modelo exacto de analisis no esta disponible. Usa la resolucion manual con fuentes verificadas."
          : "El analizador de evidencia no esta disponible ahora. Reintentalo o usa la resolucion manual.",
        status: gatewayError.httpStatus,
      },
    };
  }
}

type AnalysisEnvironment = {
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
  tavilyApiKey: string;
  execution: {
    invocationId: string;
    agentRunId: string | null;
    absoluteDeadlineAt: number;
    signal: AbortSignal;
  };
};

function configuredKey(variable: string, legacy: string): string {
  const configured = Deno.env.get(variable);
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Compatibilidad con el formato de secreto simple.
    }
  }
  return Deno.env.get(legacy) ?? "";
}

function getAnalysisEnvironment(
  execution: AnalysisEnvironment["execution"],
): AnalysisEnvironment | null {
  const environment = {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    publishableKey: getPublishableKey(),
    secretKey: configuredKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    tavilyApiKey: Deno.env.get("TAVILY_API_KEY") ?? "",
    execution,
  };
  return environment.supabaseUrl && environment.publishableKey &&
      environment.secretKey && environment.tavilyApiKey
    ? environment
    : null;
}

async function fetchInternal(
  environment: AnalysisEnvironment,
  input: string,
  init: RequestInit,
): Promise<Response> {
  return fetchWithinDeadline(input, init, environment.execution, {
    timeoutPolicyMs: 30_000,
    finalizationReserveMs: FINALIZATION_RESERVE_MS,
  });
}

function getRequestRejection(req: Request): Response | null {
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

async function authenticateResolutionAdmin(
  environment: AnalysisEnvironment,
  authorization: string,
): Promise<Response | null> {
  const userResponse = await fetchInternal(environment, `${environment.supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: authorization,
      apikey: environment.publishableKey,
    },
    signal: environment.execution.signal,
  });
  if (!userResponse.ok) {
    return jsonResponse({
      error: "AUTH_REQUIRED",
      message: "Tu sesion no es valida.",
    }, 401);
  }

  const user = await userResponse.json() as JsonRecord;
  const appMetadata = isRecord(user.app_metadata) ? user.app_metadata : {};
  if (appMetadata.oraklo_admin === true) return null;
  return jsonResponse({
    error: "ADMIN_REQUIRED",
    message: "Esta herramienta es solo para administracion.",
  }, 403);
}

async function loadResolutionMarket(
  environment: AnalysisEnvironment,
  authorization: string,
  marketId: string,
): Promise<{ market: JsonRecord | null; errorResponse: Response | null }> {
  const marketResponse = await fetchInternal(
    environment,
    `${environment.supabaseUrl}/rest/v1/rpc/get_admin_market_for_resolution`,
    {
      method: "POST",
      headers: {
        Authorization: authorization,
        apikey: environment.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ market_id_input: marketId }),
      signal: environment.execution.signal,
    },
  );
  if (!marketResponse.ok) {
    console.error("Market RPC failed", marketResponse.status);
    return {
      market: null,
      errorResponse: jsonResponse({
        error: "MARKET_LOOKUP_FAILED",
        message: "No se ha podido consultar el mercado.",
      }, 502),
    };
  }
  const market = normalizeMarket(await marketResponse.json());
  const errorResponse = market
    ? null
    : jsonResponse({
      error: "MARKET_NOT_FOUND",
      message: "No se ha encontrado el mercado.",
    }, 404);
  return { market, errorResponse };
}

function getDefinitionIssues(market: JsonRecord): string[] {
  const temporalIssues = getTemporalDefinitionIssues(market)
    .map((issue) => issue.message);
  return [...temporalIssues, ...getMarketDefinitionIssues(market)];
}

function buildSuccessfulAnalysisResponse(
  market: JsonRecord,
  research: EvidenceOutput,
  gatewayAnalysis: {
    analysis: JsonRecord;
    transportMode: string;
    telemetryStatus: string;
    warnings: readonly string[];
  },
): Response {
  const evidenceWarning = research.sources.length
    ? "Comprueba las fuentes y sus fechas antes de aprobar la resolucion."
    : "La IA no ha devuelto fuentes verificables. No apruebes esta propuesta.";
  return jsonResponse({
    ok: true,
    market: getMarketSummary(market),
    analysis_kind: "evidence_analysis",
    analysis: {
      ...gatewayAnalysis.analysis,
      proposed_result: gatewayAnalysis.analysis.proposed_result === "Si"
        ? "S\u00ed"
        : gatewayAnalysis.analysis.proposed_result,
    },
    sources: research.sources,
    search_queries: research.searchQueries,
    evidence_warning: evidenceWarning,
    research_model: "tavily-search-basic",
    analysis_contract: AI_TASK_CONTRACTS.market_resolution_analysis.contractVersion,
    provider_api: "research:tavily;analysis:ai_gateway",
    transport_mode: gatewayAnalysis.transportMode,
    telemetry_status: gatewayAnalysis.telemetryStatus,
    warnings: gatewayAnalysis.warnings,
    generated_at: new Date().toISOString(),
    analysis_ready_for_human_review: true,
    // Alias temporal para clientes v1. No concede autoridad de resolucion.
    can_resolve_market: true,
  });
}

async function runResolutionAnalysis(
  req: Request,
  environment: AnalysisEnvironment,
  authorization: string,
): Promise<Response> {
  const authError = await authenticateResolutionAdmin(environment, authorization);
  if (authError) return authError;

  const requestBody = await req.json() as JsonRecord;
  const marketId = getText(requestBody.market_id);
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(marketId)) {
    return jsonResponse({
      error: "INVALID_MARKET_ID",
      message: "El identificador del mercado no es valido.",
    }, 400);
  }

  const { market, errorResponse } = await loadResolutionMarket(
    environment,
    authorization,
    marketId,
  );
  if (errorResponse || !market) return errorResponse as Response;
  if (!isMarketClosed(market)) {
    return jsonResponse({
      error: "MARKET_NOT_CLOSED",
      message: "El mercado todavia no esta cerrado.",
    }, 409);
  }

  const definitionIssues = getDefinitionIssues(market);
  if (definitionIssues.length) {
    console.log(
      "Market definition check proposed annulment",
      JSON.stringify({
        market_id: getText(market.id),
        issues: definitionIssues.length,
      }),
    );
    return jsonResponse(buildDefinitionIssueResponse(market, definitionIssues));
  }

  const tavilyResearch = await researchWithTavily(
    environment.tavilyApiKey,
    market,
    environment.execution,
  );
  if (!tavilyResearch.ok) {
    if (tavilyResearch.failure.error === "SEARCH_NO_EVIDENCE") {
      return jsonResponse(buildNoEvidenceResponse(market));
    }
    return jsonResponse({
      error: tavilyResearch.failure.error,
      message: tavilyResearch.failure.message,
    }, tavilyResearch.failure.status);
  }

  const gatewayAnalysis = await analyzeWithGateway(
    environment,
    market,
    tavilyResearch.research,
  );
  if (!gatewayAnalysis.ok) {
    return jsonResponse({
      error: gatewayAnalysis.failure.error,
      message: gatewayAnalysis.failure.message,
    }, gatewayAnalysis.failure.status);
  }
  return buildSuccessfulAnalysisResponse(
    market,
    tavilyResearch.research,
    gatewayAnalysis,
  );
}

function buildAnalysisFailure(error: unknown): Response {
  const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
  const errorName = error instanceof Error ? error.name : "UnknownError";
  console.error("Resolution analysis failed", isTimeout ? "timeout" : errorName);
  return jsonResponse({
    error: isTimeout ? "AI_TIMEOUT" : "ANALYSIS_FAILED",
    message: isTimeout
      ? "La busqueda ha tardado demasiado. Intentalo de nuevo."
      : "No se ha podido completar el analisis.",
  }, isTimeout ? 504 : 500);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const requestRejection = getRequestRejection(req);
  if (requestRejection) return requestRejection;

  const execution = createAbsoluteExecutionContext({
    durationMs: OPERATION_TIMEOUT_MS,
    parentSignal: req.signal,
  });
  const environment = getAnalysisEnvironment(execution.context);
  if (!environment) {
    execution.cleanup();
    console.error("Missing required Edge Function environment variables.");
    return jsonResponse({
      error: "SERVER_NOT_CONFIGURED",
      message: "El analizador no esta configurado.",
    }, 500);
  }

  try {
    const authorization = req.headers.get("authorization") ?? "";
    return await runResolutionAnalysis(req, environment, authorization);
  } catch (error) {
    return buildAnalysisFailure(error);
  } finally {
    execution.cleanup();
  }
});
