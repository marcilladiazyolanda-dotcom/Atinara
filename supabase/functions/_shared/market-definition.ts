export type MarketRecord = Record<string, unknown>;

export type DefinitionIssue = {
  code: string;
  field: string;
  message: string;
};

function getText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function timestamp(value: unknown): number | null {
  const parsed = Date.parse(getText(value));
  return Number.isFinite(parsed) ? parsed : null;
}

const MONTHS: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

const DURING_MONTH_PATTERN = /\bdurante\s+(?:el\s+mes\s+de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/;
const RELATIVE_DATE_PATTERN = /\b(proximo|proxima|ultimo|ultima|pronto)\b/;
const ISO_DATE_PATTERN = /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/;
const SPANISH_DATE_PATTERN = /\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+20\d{2}\b/;

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function localDateParts(timestampValue: number, timeZone: string): {
  year: number;
  month: number;
  day: number;
} {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(timestampValue));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      year: Number(values.year),
      month: Number(values.month) - 1,
      day: Number(values.day),
    };
  } catch {
    const date = new Date(timestampValue);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth(),
      day: date.getUTCDate(),
    };
  }
}

export function getEffectiveEvaluationEnd(market: MarketRecord): number | null {
  return timestamp(market.evaluation_ends_at) ?? timestamp(market.closes_at);
}

export function isReadyForResolution(market: MarketRecord, now = Date.now()): boolean {
  const status = normalize(getText(market.status));
  const participationClosed = timestamp(market.participation_closed_at);
  const evaluationEnd = getEffectiveEvaluationEnd(market);
  const noLongerOpen = ["cerrado", "closed"].includes(status) || participationClosed !== null;
  return noLongerOpen && evaluationEnd !== null && evaluationEnd <= now;
}

export function getTemporalDefinitionIssues(market: MarketRecord): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const evaluationEnd = getEffectiveEvaluationEnd(market);
  const structuredEvaluationEnd = timestamp(market.evaluation_ends_at);
  const resolutionDeadline = timestamp(market.resolution_deadline);
  const definingText = normalize(`${getText(market.question)} ${getText(market.description)}`);

  if (structuredEvaluationEnd !== null && timestamp(market.closes_at) !== structuredEvaluationEnd) {
    issues.push({
      code: "TEMPORAL_CONTRADICTION",
      field: "evaluation_ends_at",
      message: "El periodo evaluado y el cierre original no coinciden. No se puede liquidar hasta revisar la definición.",
    });
  }

  if (evaluationEnd !== null && resolutionDeadline !== null && resolutionDeadline < evaluationEnd) {
    issues.push({
      code: "RESOLUTION_DEADLINE_CONTRADICTION",
      field: "resolution_deadline",
      message: "La fecha límite de resolución es anterior al final del periodo que debe investigarse.",
    });
  }

  const duringMonth = DURING_MONTH_PATTERN.exec(definingText);
  if (duringMonth && evaluationEnd !== null) {
    const localDate = localDateParts(
      evaluationEnd,
      getText(market.evaluation_timezone) || "UTC",
    );
    const expectedMonth = MONTHS[duringMonth[1]];
    const expectedLastDay = lastDayOfMonth(localDate.year, expectedMonth);
    if (localDate.month !== expectedMonth || localDate.day !== expectedLastDay) {
      issues.push({
        code: "EVALUATION_PERIOD_NOT_FULL_MONTH",
        field: "evaluation_ends_at",
        message: `La pregunta evalúa todo ${duringMonth[1]}, pero la fecha configurada no llega al final de ese mes.`,
      });
    }
  }

  const relative = RELATIVE_DATE_PATTERN.exec(definingText)?.[1];
  const hasDate = ISO_DATE_PATTERN.test(definingText)
    || SPANISH_DATE_PATTERN.test(definingText);
  if (relative && !hasDate) {
    issues.push({
      code: "RELATIVE_EVENT_UNRESOLVED",
      field: "question",
      message: `La expresión relativa «${relative}» no identifica una edición o fecha exacta.`,
    });
  }

  return issues;
}
