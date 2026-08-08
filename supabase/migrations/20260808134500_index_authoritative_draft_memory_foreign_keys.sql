-- Paso 13.5.2 · Índices de apoyo para las claves foráneas de la memoria autoritativa.
--
-- Esta migración responde al asesor de rendimiento posterior al despliegue. Los
-- índices no cambian datos ni estados: evitan recorridos completos al comprobar
-- referencias durante restauraciones, revocaciones y limpieza futura.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index if not exists market_draft_versions_restored_from_idx
  on private.market_draft_versions(restored_from_version_id)
  where restored_from_version_id is not null;

create index if not exists market_review_attempts_version_idx
  on private.market_review_attempts(version_id)
  where version_id is not null;

create index if not exists market_effective_reviews_attempt_idx
  on private.market_effective_reviews(attempt_id)
  where attempt_id is not null;

create index if not exists market_effective_reviews_report_idx
  on private.market_effective_reviews(report_id)
  where report_id is not null;

create index if not exists market_effective_reviews_reused_from_idx
  on private.market_effective_reviews(reused_from_effective_review_id)
  where reused_from_effective_review_id is not null;

create index if not exists market_effective_reviews_version_idx
  on private.market_effective_reviews(version_id)
  where version_id is not null;

create index if not exists market_workflow_requests_draft_idx
  on private.market_workflow_requests(draft_id);

commit;
