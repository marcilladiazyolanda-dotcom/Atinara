# Atinara · corrección incremental de caché y puerta CI del Radar

Fecha: 26 de agosto de 2026  
Base exacta: `ddf61bb7667fc209377f2ea120d469b66f2ad65f`  
Estado: corrección mínima verificada en local; pendiente de integración en
GitHub. No aplicada ni desplegada en producción.

## Hallazgo remoto

El rango `addfc0b..ddf61bb` contiene exactamente las 16 rutas del paquete de
checkpoint de discovery y cada blob remoto coincide byte por byte con la
worktree preservada. La subida, por tanto, no perdió ni alteró archivos.

Para el SHA `ddf61bb7667fc209377f2ea120d469b66f2ad65f`:

- GitHub Pages, run `32955814594`: `success`;
- Benchmark IA offline, run `32955816132`: `success`;
- `Calidad de Atinara`, run `32955816058`: `failure`.

La Action funcional falló en `npm run validate`, antes de ejecutar el paso
«Comprobar Edge Functions sin llamadas externas». Las dos aserciones fallidas
fueron:

- `tests/public-brand.test.js`: `admin-markets.html mezcla versiones de caché`;
- `tests/sonarqube-quality.test.js`: el mismo contrato compartido,
  `actual=2`, `expected=1`.

No se consultó ni ejecutó Sonar. El segundo nombre corresponde a una suite
unitaria local incluida en la validación general.

## Causa raíz general

`admin-markets.html` referencia quince recursos locales. La entrega cambió
`radar-refresh-request.js` y `admin-markets.js` a
`20260825-radar-provider-checkpoint1`, pero dejó los otros trece recursos bajo
`20260825-radar-catalog-bound1`. Las nueve páginas hermanas también conservaban
el corte anterior para los recursos compartidos.

La regla de caché pública de Atinara es atómica por documento HTML: todos sus
recursos locales deben compartir una sola versión. Así GitHub Pages no puede
combinar HTML nuevo con CSS o JavaScript de otro corte durante una recarga, una
sesión autenticada o un cambio de viewport. Los contratos del repositorio
exigen además la misma release para `styles`, observabilidad y monitorización
en todas las páginas consumidoras.

## Corrección

Las 110 referencias locales de los diez HTML usan ahora
`20260825-radar-provider-checkpoint1`. No cambia ningún byte del contenido de
los recursos enlazados; solo cambia la query string de las 108 referencias que
conservaban el corte anterior. Se actualizan también seis contratos estáticos
que fijaban literalmente la release previa.

La corrección es general para todas las superficies públicas y administrativas
compartidas y no introduce una excepción por proveedor, serie, evento o
candidata.

## Alcance protegido

- Sin migraciones, Edge Functions, secretos, Auth, RPC o DML.
- Sin cambios en Radar, Kalshi, Polymarket, Tavily, Expert o Editor.
- Sin cambios en Registry V2.1, rutas, modos, modelos, flags o presupuestos.
- Sin cambios en Karma, Prestigio, LMSR, mercados, predicciones o borradores.
- Sin publicación, confirmación, resolución o liquidación.
- La migración de checkpoint sigue pendiente y `market-radar` continúa en v69
  hasta que este paquete se integre y la Action funcional quede verde.

## Verificación local

- Las 110 referencias locales de los diez HTML tienen una única release.
- Ocho suites focalizadas de caché y consumidores: 144/144.
- Suite unitaria completa: 577/577.
- Sintaxis JavaScript: 128/128.
- Canonicalización Node/Deno 2.1.14: verde y huella idéntica.
- TypeScript de monitorización: verde.
- Contratos SQL estáticos: 19/19.
- Nueve Edge Functions con Deno 2.1.14: verdes.
- `git diff --check`: verde.

## Activación posterior a la subida

1. Ejecutar `git fetch --all --prune` y determinar el nuevo `origin/main` real.
2. Exigir exactamente las veinte rutas de este paquete y comparar sus contenidos.
3. Exigir `Calidad de Atinara`, incluido Deno, Pages y benchmark offline verdes;
   no usar Sonar.
4. Solo entonces tomar baseline productivo de lectura, aplicar una vez la
   migración del paquete anterior y desplegar únicamente `market-radar` con
   `verify_jwt=true`.
5. Ejecutar exactamente un refresh Kalshi fresco y continuar solo su UUID.
6. No usar Market Expert hasta que una candidata fresca supere todas las puertas
   de familia, identidad, elegibilidad, fuentes, temporalidad y duplicado.
7. Crear como máximo un borrador privado nuevo y no confirmarlo ni publicarlo.

## Inventario incremental

- `M ORAKLO_PROJECT_CONTEXT.md`
- `M README.md`
- `M admin-community.html`
- `M admin-markets.html`
- `M admin-resolution.html`
- `M community.html`
- `M index.html`
- `M market-detail.html`
- `M my-predictions.html`
- `M profile.html`
- `M ranking.html`
- `M reset-password.html`
- `A docs/ATINARA_RADAR_CACHE_VERSION_CI_FIX_20260826.md`
- `A docs/ATINARA_RADAR_CACHE_VERSION_CI_FIX_20260826_MANIFEST.txt`
- `M tests/agent-engine-frontend.test.js`
- `M tests/human-confirmation-flow.test.js`
- `M tests/market-radar.test.js`
- `M tests/official-opportunity-discovery.test.js`
- `M tests/radar-catalog-boundary.test.js`
- `M tests/radar-eligibility-sources-v5.test.js`

No hay eliminaciones.
