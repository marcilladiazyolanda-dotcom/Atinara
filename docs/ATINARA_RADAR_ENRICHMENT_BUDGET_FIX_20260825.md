# Radar V6 · presupuesto desacoplado del enriquecimiento

Fecha: 25 de agosto de 2026  
Base canónica: `c2ce6a96918e5e65074fc43218ea290cc9005493`

## Evidencia productiva

`market-radar` v66 quedó `ACTIVE` con `verify_jwt=true`, digest
`cec6ccfeed2a467bcc87c11152ba3f85ecb0651159fa80ca6cabde28b64ab244`.
El refresh Kalshi autenticado `e485f1ba-ddd8-4c61-8001-6ded4fc3abd7` demostró:

- selección y ledger de padres respondieron HTTP 200;
- 23 series sanas y dos series aisladas: `KXSWITCH2` y
  `KXMETACRITICSTALKER2`;
- 11 padres y 148 hijas descubiertas, contabilizadas e identificadas;
- diez padres completos y uno `provider_unavailable`;
- cero hijas sin identidad y ningún padre sano truncado;
- Tavily terminal no bloqueante;
- ningún manifest, batch o cambio de candidata antes de terminar la llamada;
- recuperación de la misma UUID con `claim_count=2`, sin crear otra intención.

Los timestamps de API muestran renovaciones de lease durante el enriquecimiento
y una espera aproximada de 39 s entre el ledger y el terminal de Tavily. El
feed estaba correctamente reconciliado, pero su checkpoint de candidatas seguía
después de una capacidad auxiliar lenta.

## Causa raíz general

El aislamiento de salud era correcto, pero no el aislamiento temporal. Tavily
compartía el deadline global de 135 s y podía consumir una parte material de la
ventana antes de `declare_market_radar_refresh_manifest_v1`. Una pérdida de
transporte obligaba a reanudar discovery pese a que el ledger del proveedor ya
era durable.

Además, la preservación diagnóstica solo reconocía `RadarRpcError`. Errores
locales seguros como `AI_DEADLINE_EXCEEDED` podían caer todavía en la etiqueta
genérica `PROVIDER_UNAVAILABLE`.

## Corrección

- `RADAR_ENRICHMENT_BUDGET_MS` fija 12 s totales para el enriquecimiento del
  refresh masivo.
- `withRadarEnrichmentBudget` deriva un contexto hijo del deadline absoluto,
  conserva la señal padre y ejecuta siempre `cleanup`.
- El heartbeat de los intents de proveedor continúa usando el contexto global;
  el límite auxiliar no acorta ni revive leases.
- Un timeout de Tavily deja los grupos como investigación incompleta y permite
  continuar con la persistencia fail-closed de las candidatas.
- `internalRadarOperationalFailure` conserva códigos locales seguros y distingue
  deadline, lease y aislamiento de persistencia de una caída externa.

El comportamiento es general para cualquier proveedor de candidatas y cualquier
enriquecedor auxiliar lento o caído; no contiene IDs, títulos o reglas especiales
para Kalshi.

## Alcance y activación

Solo cambian `market-radar`, sus pruebas y documentación. No hay migración,
frontend, DML, backfill, Gemini, secretos, cambios de Registry, rutas, modelos,
flags, presupuestos AI ni economía.

Después de subir el paquete:

1. verificar el nuevo SHA y el chequeo Deno de las nueve Edge;
2. desplegar únicamente `market-radar` con `verify_jwt=true`;
3. respetar el cooldown y ejecutar un solo refresh Kalshi fresco;
4. exigir ledger completo o parcial explícito, manifest sellado, batches y
   terminal durable aunque Tavily falle;
5. seleccionar únicamente una candidata fresca, futura, no duplicada y sin
   resultado público para continuar el E2E general Radar → borrador privado.
