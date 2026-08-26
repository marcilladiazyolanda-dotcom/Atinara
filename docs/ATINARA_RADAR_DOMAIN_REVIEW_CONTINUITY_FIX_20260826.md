# Atinara · continuidad semántica de la revisión de dominio Radar

Fecha: 26 de agosto de 2026
Base exacta: `d204bde336a63ac83a2991e5916b78fbdc4ef7ee`
Estado: corrección incremental verificada en local; pendiente de integración y
despliegue exclusivo de `market-radar`.

## Objetivo

Permitir que una atestación humana de dominio ya persistida sobreviva a la
revalidación real del proveedor cuando el sujeto y toda la evidencia
clasificable permanecen idénticos. La corrección no rebaja reconciliación,
identidad, elegibilidad, fuentes, duplicados, temporalidad ni confirmación
humana.

No contiene migración, frontend, DML o backfill. No modifica Auth, secretos,
Registry V2.1, AI Gateway, tareas, rutas, modos, modelos, flags, presupuestos,
Karma, Prestigio o LMSR. Radar conserva cero inferencias.

## Estado productivo y evidencia

`origin/main = d204bde336a63ac83a2991e5916b78fbdc4ef7ee` superó Calidad de
Atinara, el chequeo Deno, Pages y el benchmark offline. La migración de revisión
consta aplicada remotamente como
`20260826112912_fix_market_radar_domain_review_contract_v2`. Solo
`market-radar` se desplegó como v71, `ACTIVE`, `verify_jwt=true`, digest
`18b3c501fb7dbd5ed4323e701ec25c2ef046224af3de50838ece0ad7cd8ca695`.

El refresh fresco `c1f677eb-0dae-410f-820d-a4483601ab47` continúa
`completed/terminal`: 215/215 series Kalshi, cero fallidas, 590 padres
indexados, 24 seleccionados completos, 566 diferidos, 192/192 hijas
descubiertas/contabilizadas/identificadas y 162/162 candidatas procesadas y
aceptadas. No se abrió otra UUID.

La candidata `1aa9b332-07d9-4dff-a2e3-d98a7066237e` registró una única
revisión `in_domain`:

- request `6b5249ad-767d-488c-b0cc-5ab902f87b24`;
- candidata revisionada de 85 a 86;
- huella de candidata `r3712d951`;
- huella de dominio
  `0c5c75388ff6690d6963c8ad5375c5628f078d5f34ab8b27fa323a9c97981653`;
- política `atinara-gaming-domain-v2`;
- issue `9a503635-a99e-4f38-823f-bab3e1180e3b` resuelta mediante
  `human_domain_review`.

La lectura service-only devuelve esa fila exacta. No obstante, la única
renovación posterior creó el eligibility check 4572, attempt
`2fd2337a-f246-4371-8da1-9bae46fde828`, y terminó
`technical_hold/GAMING_DOMAIN_REVIEW_REQUIRED`. La candidata avanzó a revision
87 sin cambiar `r3712d951`; los seis borradores permanecieron intactos.

Las API logs demostraron HTTP 200 para la lectura de candidata, la lectura de
reconciliación, `get_market_radar_domain_reviews_v1` y
`apply_market_radar_prepare_eligibility_v4`. La RPC de revisiones devuelve la
atestación al consultarla con su scope exacto. No fue Auth, SQL, RLS, Kalshi,
Tavily ni ausencia del ledger.

## Causa raíz general

El mismo contrato de huella se evaluaba en dos fases distintas:

1. discovery calcula `domain_review_fingerprint` sobre la candidata de
   proveedor reconciliada;
2. después `scoreCandidates` deriva familia y presentación y persiste esa forma;
3. la revalidación parte de la forma persistida, mezcla una observación nueva
   del proveedor y recalcula la huella;
4. los campos familiares derivados que no existían en el primer cálculo ya
   existen en el segundo, por lo que la atestación no se encuentra aunque el
   sujeto sea idéntico.

Además, `radarDomainFingerprintV1` incluye
`parent_reconciliation_fingerprint`. La reconciliación puede cambiar al volver
a observar disponibilidad, evidencia o contrato material de cualquier hermana.
Esa variación debe volver a pasar su puerta de completitud, pero no demuestra
que la relación del sujeto con videojuegos haya cambiado.

Es un defecto de continuidad de fase aplicable a Kalshi y Polymarket, familias
binarias o categóricas y cualquier candidata que requiera revisión humana. No
depende de GTA VI ni de un ID concreto.

## Corrección

`selectRadarDomainReviewFingerprintV1` calcula primero la huella actual. Solo
considera reutilizar el scope persistido si este es un SHA-256 válido y si dos
proyecciones cerradas —observación actual y fila persistida— producen la misma
huella tras neutralizar exclusivamente `parent_reconciliation_fingerprint`.

La comparación conserva proveedor, `external_id`, `external_event_id`, grupo,
título, pregunta, descripción, categoría, tags, subtítulos y taxonomía del
proveedor, contexto, familia, etiqueta canónica, estado/clasificación/fuente de
identidad y el resto del material vigente de `radarDomainFingerprintV1`.
Cualquier diferencia usa la huella recién calculada y no encuentra la revisión
anterior.

`projectRadarDomainReview` sigue exigiendo coincidencia exacta de proveedor,
`external_id`, huella y `atinara-gaming-domain-v2`. La elegibilidad vuelve a
evaluar proveedor, padre, identidad, fuente oficial, resultado público,
duplicados y temporalidad. La corrección selecciona un scope de lectura; no
crea una decisión ni cambia datos por sí sola.

## Pruebas

- Radar y resumibilidad focalizados: 97/97.
- Regresión positiva: huella atestada antes de familia, fila persistida después
  de familia, nuevo parent fingerprint y precio distinto reutilizan la misma
  atestación.
- Regresiones negativas: cambio de pregunta, categoría del proveedor, estado de
  identidad o `external_id` invalida la continuidad.
- Proyección final: una revisión exacta produce `in_domain`; una no exacta sigue
  cerrada.
- Edge Functions con Deno 2.1.14: 9/9.
- Sintaxis del test modificado y `git diff --check`: verdes.

## Activación

1. Verificar `origin/main`, las rutas y el contenido exacto del paquete.
2. Exigir Calidad de Atinara, chequeo Deno, Pages y benchmark offline verdes;
   no usar Sonar.
3. Tomar baseline de solo lectura y confirmar v71, seis borradores y
   fingerprints protegidos.
4. Desplegar únicamente `market-radar` con `verify_jwt=true`; no aplicar SQL.
5. Confirmar nueva versión, `ACTIVE`, JWT, digest e invariantes.
6. No iniciar refresh ni crear otra revisión. Renovar elegibilidad exactamente
   una vez sobre la candidata existente.
7. Solo si queda elegible y sigue sin resultado público, ejecutar una única
   inferencia de Market Expert/Editor y materializar exactamente un borrador
   privado.
8. Nunca confirmar, publicar, resolver o liquidar.

## Rollback y riesgos

El rollback consiste en restaurar el bundle productivo v71 de `market-radar`;
no hay esquema ni datos que revertir. Si la Edge nueva no queda activa o la
renovación vuelve a fallar, no repetirla: conservar el expediente y diagnosticar
el código tipado.

La continuidad es deliberadamente conservadora: cualquier diferencia fuera de
la huella de reconciliación invalida la reutilización. Un cambio real del
contrato o del sujeto puede exigir una revisión nueva aunque la operadora lo
considere menor. Este coste es preferible a trasladar una atestación a una
proposición distinta.
