---
name: atinara-change-gate
description: "Usa esta habilidad para implementar o corregir cualquier cambio no trivial en Atinara: bug, incidencia, función nueva, refactor, migración, Edge Function o preparación de entrega. No usar para preguntas, ideas o revisión puramente de lectura."
---

# Puerta de cambio experto de Atinara

Aplica esta habilidad junto con cualquier habilidad específica del dominio afectado.

## 1. Fija el baseline real

1. Lee `AGENTS.md` y la documentación canónica exigida para el área.
2. Ejecuta o inspecciona `git status`, rama, `HEAD`, `origin/main`, divergencia y cambios locales.
3. Conserva trabajo ajeno. No uses reset, clean, restore, rebase ni sobrescrituras para simplificar el entorno.
4. Cuando el resultado dependa de producción, verifica Supabase, versiones de Edge Functions, migraciones, logs o proveedores con herramientas de lectura.
5. Si código, producción y documentación discrepan, determina la fuente autoritativa del hecho concreto antes de editar.

## 2. Declara aceptación y riesgo

Antes de modificar, escribe criterios verificables y clasifica las superficies afectadas:

- interfaz, responsive y accesibilidad;
- dominio y ciclo de mercado;
- Auth, RLS, roles y permisos;
- RPC, Postgres, migraciones y datos;
- Edge Functions, proveedores y AI Gateway;
- concurrencia, idempotencia y recuperación;
- privacidad, seguridad y observabilidad;
- beta, separación Karma/dinero real y futura modularidad B2B.

No amplíes alcance porque exista deuda adyacente. Regístrala aparte.

## 3. Localiza la causa raíz

- Reproduce o demuestra el fallo antes de repararlo cuando sea viable.
- Identifica la clase general del problema y las rutas hermanas que comparten el control.
- Distingue síntoma de interfaz, error de integración, estado persistido incorrecto y fallo de proveedor.
- No optimices solo para el ejemplo que reveló la incidencia.

## 4. Implementa sin atajos

- Corrige la regla, contrato o componente compartido apropiado.
- Preserva contratos válidos o crea una transición compatible.
- No introduzcas hardcodes por caso, fallos silenciosos, mocks productivos, TODO en rutas activas, autoaprobaciones ni estados verdes falsos.
- Mantén Karma separado de cualquier modalidad monetaria futura.
- Las escrituras externas quedan sujetas a `AGENTS.md`, `.codex/config.toml` y `.codex/rules/atinara.rules`.

## 5. Verifica proporcionalmente

Ejecuta las pruebas del repositorio y las específicas del riesgo. Incluye cuando aplique:

- sintaxis y validación estática;
- unitarias e integración real;
- RLS y permisos positivos/negativos;
- concurrencia, reintento e idempotencia;
- Edge Functions y contratos de proveedor;
- responsive, teclado y accesibilidad;
- `git diff --check` y revisión final del diff;
- búsqueda de secretos y cambios fuera de alcance.

## 6. Cierra con evidencia

No declares “corregido”, “desplegado”, “activo” o “terminado” sin prueba. Informa baseline, causa raíz, solución, archivos, pruebas, producción, riesgos residuales y acciones manuales. Actualiza memoria canónica solo cuando el estado material haya cambiado.

## 6. Delegación controlada

Usa subagentes solo cuando separen trabajo independiente y reduzcan ruido del hilo principal:

- `atinara_explorer` para mapa de código y causa raíz;
- `atinara_supabase_auditor` para contraste de RLS, migraciones y producción en lectura;
- `atinara_test_analyst` para ejecución y clasificación de pruebas;
- `atinara_reviewer` para revisión final del diff.

No lances todos por rutina. El agente principal es el único implementador y conserva la decisión final. Ningún subagente realiza mutaciones remotas.
