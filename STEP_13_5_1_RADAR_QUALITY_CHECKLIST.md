# Paso 13.5.1 · Checklist de calidad y activación del Radar

Estado: **implementado localmente; no activado**. Fecha: 6 de agosto de 2026.

## Contrato v2

- [x] Evento padre y mercado hijo conservan identificadores y slugs separados.
- [x] URL de mercado original y fuente de resolución son campos diferentes.
- [x] Polymarket valida evento, URL canónica y pertenencia del hijo.
- [x] Kalshi descubre taxonomía real, series dinámicas y eventos anidados.
- [x] Kalshi acepta estados `open` y `active` y rechaza estados cerrados.
- [x] Una tarjeta agrupa un evento y muestra hasta tres opciones hijas.
- [x] La puntuación no puede anular un rechazo factual.
- [x] Verificación caducada, revisión o estado `rejected_*` bloquean preparar.
- [x] La preparación vuelve a comprobar versión, caducidad, duplicados y estado
  actual del proveedor.
- [x] Rechazos conservan código, explicación, fecha, evidencia y enlace original.
- [x] Caché v1 no preparada queda invalidada; `prepared` y `dismissed` se conservan.
- [x] Fotografía pública del 6 de agosto: `Entertainment / Video games`, 108
  series descubiertas, 25 consultadas, 4 eventos abiertos y 28 hijos binarios;
  ninguna serie consultada falló.
- [x] Polymarket: los 3 eventos gaming devueltos por la consulta pública fueron
  validados por Gamma y sus 3 URLs canónicas respondieron `200` (0 enlaces `404`).

## Casos de regresión automatizados

- [x] EA Sports FC 27 ya revelado → `EVENT_ALREADY_RESOLVED`.
- [x] Fable GOTY 2026 con lanzamiento posterior → `EVENT_OUTSIDE_CONTRACT`.
- [x] Half-Life 3 no anunciado tratado como lanzamiento → `SUBJECT_NOT_ANNOUNCED`.
- [x] Pregunta explícita sobre un posible anuncio puede seguir a revisión.
- [x] Incoherencia temporal → `TEMPORAL_INCOHERENCE`.
- [x] URL insegura, local o no validada no es preparable.
- [x] Mercado hijo cerrado o no binario queda bloqueado.

## Seguridad y datos

- [x] JWT y `oraklo_admin` siguen siendo obligatorios.
- [x] Frontend no consulta proveedores externos ni contiene secretos.
- [x] Edge Function solo consulta hosts fijos permitidos.
- [x] RLS y permisos directos de tablas privadas se conservan.
- [x] RPC de servicio solo accesible a `service_role`; RPC administrativas exigen
  `private.require_current_admin()`.
- [x] No se consultan cuentas, órdenes, posiciones, wallets ni traders externos.
- [x] No se publican, programan o aprueban mercados y no se crean predicciones.
- [x] LMSR, Karma, Prestigio, Auth y datos reales no se modifican.
- [x] Fallo de Tavily/Gemini cerrado: revisión privada sin botón de preparar.

## Activación manual de Yol

1. Subir a `main` el contenido completo del ZIP, no el ZIP.
2. Aplicar **solo** `20260806183627_harden_market_radar_quality_sources.sql`.
3. Desplegar **solo** `supabase/functions/market-radar` con JWT obligatorio.
4. Esperar a que GitHub Pages sirva `v=20260806-radar2` en todos los HTML.
5. Abrir `Gestionar mercados → Radar de mercados` con una administradora.
6. Actualizar fuentes y comprobar:
   - Polymarket abre el evento padre real y no devuelve 404;
   - Kalshi muestra catálogo si existen eventos públicos abiertos;
   - cada tarjeta agrupa opciones de un único evento;
   - fuente de resolución y mercado original son enlaces distintos;
   - rechazados no permiten preparar;
   - caché o verificación caducada no permiten preparar;
   - una candidata `verified_open` se recotiza/revalida antes de pre-rellenar.
7. No guardar ni publicar el borrador durante la comprobación si se desea una QA
   sin mutaciones de datos.

No repetir `20260804194933_add_market_radar.sql`. No cambiar secretos. No activar
IGDB, Twitch o YouTube en este paso.
