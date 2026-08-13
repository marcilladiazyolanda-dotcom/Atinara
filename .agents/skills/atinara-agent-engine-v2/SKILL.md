---
name: atinara-agent-engine-v2
description: "Usa esta habilidad al tocar Agent Engine V2.1, AI Gateway, inferencias Gemini, rutas, modos legacy_direct o gateway, registries, herramientas, budgets, telemetría, benchmark o proveedores experimentales. No usar para lógica de mercado sin IA."
---

# Agent Engine V2.1 y AI Gateway

## 1. Lectura obligatoria

Lee antes de editar:

- `docs/ATINARA_AGENT_ENGINE.md`;
- `docs/ATINARA_AI_GATEWAY.md`;
- `docs/ATINARA_AGENT_ENGINE_V2_RUNBOOK.md`;
- `docs/ATINARA_RPC_DEPENDENCY_MATRIX.md`;
- `docs/ATINARA_AI_BENCHMARK_TECHNICAL.md`;
- `SECURITY.md`.

Comprueba además settings, versiones de Edge y producción cuando sean relevantes.

## 2. Estado base que no debe inferirse

V2.1 desplegado no significa que una tarea haya sido promovida. Verifica cada una. En el corte vigente las tareas permanecen en `legacy_direct`; OpenRouter, NVIDIA NIM, `gateway_gemini_parity` y `gateway_routing` están apagados hasta autorización nueva.

## 3. Fronteras

- El dominio decide permisos, estados, evidencia y autoridad.
- Runtime selecciona herramientas registradas, controla loops, replans, huellas, snapshot y un solo writer.
- Gateway controla saneamiento, ruta, modelo, presupuesto, transporte, validación y telemetría.
- El proveedor solo propone. Nunca publica, aprueba, resuelve, liquida o modifica Karma/Prestigio.

## 4. Contratos obligatorios

- La Edge no elige modelo, schema, timeout, retries, fallback, data class, budget ni fingerprint.
- El sanitizer usa allowlists recursivas y rechaza datos prohibidos.
- La aceptación exige tamaño, parse, tipos, relaciones de dominio y política, sin coerción silenciosa.
- Todos los componentes comparten `absoluteDeadlineAt` y reservan tiempo para finalizar.
- Un único writer por ronda; CAS e idempotencia donde corresponda.

## 5. Modos y proveedores

- No crees un interruptor global.
- Promueve una sola tarea por vez y conserva rollback a `legacy_direct`.
- `gateway_gemini_parity` requiere presupuesto medido y prueba de paridad.
- `gateway_routing` exige benchmark, revisión y promoción explícita.
- OpenRouter/NVIDIA solo aceptan `public_market`, modelo exacto, endpoint exacto, secreto presente, discovery vigente y budget positivo.
- El fallback solo responde a fallo técnico. Nunca cambia un rechazo o abstención de contenido.

## 6. Observabilidad

- No persistas prompts, payloads, respuestas, PII, secretos ni razonamiento.
- Un fallo de telemetría mantiene el resultado válido, añade warning y no repite inferencia.
- Runs, steps e intentos respetan append-only y la purga service-only documentada.

## 7. Pruebas

Ejecuta sintaxis, unitarias, Edge checks, SQL estático/transaccional, benchmark offline sin red y pruebas específicas de deadline, budget, routing, sanitizer, output contract, fallback técnico, telemetría y un solo writer. Smoke live, shadow, canary o cambio de modo requieren autorización separada.
