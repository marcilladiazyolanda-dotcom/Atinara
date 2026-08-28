function text(value, max = 4_000) {
  return String(value ?? "").trim().slice(0, max);
}

function records(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : [];
}

export function hasCurrentInDomainHumanReview(origin = {}) {
  const review = origin.human_domain_review && typeof origin.human_domain_review === "object"
    && !Array.isArray(origin.human_domain_review)
    ? origin.human_domain_review
    : {};
  const currentDomainFingerprint = text(origin.domain_review_fingerprint, 64).toLowerCase();
  const reviewedDomainFingerprint = text(review.domain_fingerprint, 64).toLowerCase();
  const candidateFingerprint = text(origin.fingerprint, 100);
  const reviewedCandidateFingerprint = text(review.candidate_fingerprint, 100);
  return text(origin.domain_status, 40) === "in_domain"
    && !text(origin.domain_reason_code, 100)
    && text(origin.domain_policy_version, 80) === "atinara-gaming-domain-v2"
    && text(review.decision, 40) === "in_domain"
    && text(review.policy_version, 80) === "atinara-gaming-domain-v2"
    && /^[a-f0-9]{64}$/.test(currentDomainFingerprint)
    && reviewedDomainFingerprint === currentDomainFingerprint
    && Boolean(candidateFingerprint)
    && reviewedCandidateFingerprint === candidateFingerprint;
}

export function activeOriginWorkflowIssues(origin = {}) {
  const issues = records(origin.workflow_issues);
  if (!hasCurrentInDomainHumanReview(origin)) return issues;
  // La RPC de origen solo proyecta la atestación exacta de la huella vigente.
  // Si una fase técnica posterior preservó una incidencia anterior, no debe
  // volver a pedir la misma decisión humana. Las puertas factual, temporal y
  // de fuentes siguen activas y viajan al borrador privado sin autoridad.
  return issues.filter((issue) => text(issue.issue_code, 100) !== "GAMING_DOMAIN_REVIEW_REQUIRED");
}
