---
name: atinara-supabase-safe-change
description: "Usa esta habilidad para cualquier tarea de Atinara que afecte Supabase: Auth, Postgres, RLS, RPC, triggers, migraciones, Edge Functions, Cron, secretos, logs o producción. No usar en trabajo exclusivamente frontend."
---

# Cambio seguro de Supabase en Atinara

Sigue `AGENTS.md`, `SECURITY.md` y documentación actual de Supabase. Descubre comandos con `--help`; no los adivines.

## 1. Inspecciona antes de cambiar

- Confirma proyecto, entorno, rama, CLI y vínculo antes de cualquier comando remoto.
- Compara migraciones locales y remotas.
- Localiza tablas, policies, grants, funciones, triggers, índices y callers afectados.
- Distingue `anon`, `authenticated`, admin, service-only y esquemas privados.
- Verifica si una advertencia describe exposición real o cierre denegatorio intencional.

## 2. Invariantes

- RLS activa en esquemas expuestos.
- `TO authenticated` no sustituye propiedad o capacidad.
- Nada autorizativo depende de metadata editable por usuaria.
- `SECURITY DEFINER` solo con justificación, `search_path` seguro, autorización interna y `EXECUTE` restringido.
- `service_role` y secretos nunca llegan al navegador, repositorio o logs.
- Escrituras críticas atómicas, idempotentes y seguras bajo concurrencia.

## 3. Migraciones

- No edites una migración aplicada.
- Crea una migración nueva con el flujo vigente de Supabase CLI.
- Preserva datos y compatibilidad o define transición y recuperación.
- Localiza dependientes antes de eliminar o renombrar.
- No alteres Karma, Prestigio, predicciones, mercados o liquidaciones para demostrar una prueba.

## 4. Edge Functions y proveedores

- Mantén `verify_jwt=true` donde el contrato lo exige y vuelve a autorizar en servidor.
- Valida esquema, tipos, tamaño y allowlists.
- Usa hosts permitidos, timeout, cuotas, caché y fallo parcial.
- Pasa toda inferencia nueva por el AI Gateway común.
- No muestres errores técnicos crudos ni valores de secretos.

## 5. Verificación

Cuando aplique, ejecuta:

- `migration list` y advisors;
- pruebas SQL estáticas y transaccionales;
- RLS positivo/negativo con actores representativos;
- checks de Edge Functions;
- integración por la ruta real;
- concurrencia, doble clic, retry e idempotencia;
- verificación productiva de lectura o con rollback.

No hagas `db push`, deploy, SQL productivo, reparación de historial ni cambios de secretos sin la aprobación requerida.
