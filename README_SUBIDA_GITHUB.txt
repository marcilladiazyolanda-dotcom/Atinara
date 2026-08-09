ATINARA · ENTREGA B2B DEL CORRECTOR, RADAR Y FAMILIAS V4

ESTADO VIGENTE · 2026-08-09
- Backend Supabase aplicado y verificado.
- market-radar v26, market-draft-fixer v7, validate-market-draft v8 y
  market-expert v11 activas con verify_jwt=true.
- Frontend coordinado pendiente de revisión y merge; GitHub Pages aún sirve
  origin/main anterior.

NO REPETIR BACKEND
- 20260809120000 y 20260809133000 ya están aplicadas con timestamps remotos
  distintos; consultar el mapeo autoritativo antes de cualquier operación.
- No ejecutar de nuevo 20260809140000_authoritative_radar_fact_gate_v1.sql.
- 20260809145000 verificó su manifiesto material y reconcilió su historial.
- 20260809150000, 20260809160000 y 20260809170000 ya están aplicadas.
- No redesplegar Edge Functions solo para publicar el frontend.

RUTA SEGURA DE GITHUB
1. Validar el árbol y revisar que no contiene secretos.
2. Crear un commit únicamente en work/fix-corrector-radar-b2b.
3. Subir esa rama explícita; no hacer push directo a main.
4. Abrir un PR, exigir checks verdes sobre la SHA exacta y revisar el diff.
5. Fusionar el PR y comprobar que GitHub Pages publica esa misma SHA.

SMOKE ADMINISTRATIVO POSTERIOR
1. Recargar Gestión de mercados tras la publicación de Pages.
2. Revalidar el borrador privado de Marvel y aplicar el Corrector.
3. Ejecutar un ciclo explícito del Radar y comprobar el rechazo terminal FC27.
4. Comprobar que los meses de tráiler GTA aparecen como hermanos, no duplicados.
5. No confirmar, programar, publicar, predecir ni resolver durante el smoke.

El estado y el mapeo exacto de migraciones remotas están en
ORAKLO_PROJECT_CONTEXT.md. Los runbooks anteriores son snapshots históricos.
Este corte es una base técnica de Atinara Engine; no completa todavía la
productización comercial B2B del Paso 13.7.
