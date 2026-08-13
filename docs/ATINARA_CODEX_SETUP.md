# Configuración profesional de Codex para Atinara

## Estado de esta configuración

Base de preparación: `origin/main` en `b8381f9641669b6463aa77944d49257e30e4caf8`, 13 de agosto de 2026.

Este documento describe la configuración versionada del repositorio y las comprobaciones locales necesarias. No contiene secretos, tokens, modelos fijados ni credenciales. No autoriza push, despliegues, SQL remoto, cambios de secretos, publicación ni resolución.

## Arquitectura de instrucciones

Codex recibe contexto en capas complementarias:

1. `AGENTS.md`: constitución permanente de producto, ingeniería y entrega.
2. `SECURITY.md`: modelo de amenazas e invariantes de seguridad.
3. `supabase/functions/AGENTS.md` y `supabase/migrations/AGENTS.md`: instrucciones más cercanas para superficies de alto riesgo.
4. `.codex/config.toml`: sandbox, aprobaciones, web, apps y límite de subagentes.
5. `.codex/rules/atinara.rules`: comandos remotos, destructivos o publicables que deben pedir aprobación.
6. `.agents/skills/*`: procedimientos especializados cargados bajo demanda.
7. `.codex/agents/*`: subagentes delimitados para exploración, auditoría, pruebas y revisión.
8. Documentación canónica de `docs/`: contratos y estado de cada subsistema.

Las skills usan divulgación progresiva. Codex conoce primero su nombre y descripción, y carga el `SKILL.md` completo cuando la tarea coincide. Los subagentes heredan el modelo del hilo principal porque esta configuración no fija uno ni eleva el consumo por sí sola.

## Skills incluidas

| Skill | Uso |
|---|---|
| `$atinara-change-gate` | Implementación o corrección no trivial. |
| `$atinara-incident-diagnostics` | Fallos, bloqueos, producción y pruebas rotas. |
| `$atinara-supabase-safe-change` | Auth, RLS, RPC, migraciones, Edge Functions y producción. |
| `$atinara-market-integrity` | Radar, Editor, Corrector, fuentes, familias y ciclo de mercado. |
| `$atinara-agent-engine-v2` | Agent Engine V2.1, AI Gateway, rutas, budgets y telemetría. |
| `$atinara-security-review` | Codex Security, Sonar, threat model, hallazgos y hardening. |
| `$atinara-ui-regression` | HTML/CSS/JS, móvil, responsive, accesibilidad y estados. |
| `$atinara-release-verification` | Puerta final antes de ZIP, commit, PR o despliegue. |
| `$atinara-docs-memory-consistency` | README, runbooks, memoria y rutas canónicas. |
| `$atinara-codex-environment-check` | Diagnóstico explícito del propio entorno Codex. |

Solo `atinara-codex-environment-check` exige invocación explícita. Las otras nueve pueden activarse implícitamente cuando su descripción coincide. Varias skills pueden combinarse, pero no deben duplicar trabajo.

## Subagentes incluidos

| Subagente | Función | Escritura de producto |
|---|---|---|
| `atinara_explorer` | Traza arquitectura, flujo y causa raíz. | No, `read-only`. |
| `atinara_supabase_auditor` | Contrasta RLS, RPC, migraciones, Edge y producción. | No, `read-only`. |
| `atinara_test_analyst` | Ejecuta y clasifica pruebas sin implementar. | Solo artefactos temporales de prueba. |
| `atinara_reviewer` | Revisa el diff contra contratos reales. | No, `read-only`. |

El máximo de cuatro hilos es un techo de seguridad, no una obligación. No se deben lanzar subagentes cuando la tarea es pequeña ni coordinar dos escritores sobre los mismos archivos. El agente principal sigue siendo el único implementador.

## Validación automatizada

`scripts/validate-codex-setup.py` comprueba sin red ni dependencias externas:

- TOML de configuración y subagentes;
- nombres, descripciones y metadatos de las diez skills;
- política de invocación;
- reglas y ejemplos inline;
- límite acumulado de `AGENTS.md`;
- documentos canónicos V2.1;
- carácter transaccional de la prueba SQL v7;
- ausencia de archivos de entorno o asignaciones evidentes de secretos.

El workflow `.github/workflows/codex-configuration.yml` ejecuta esa validación cuando cambia esta superficie. Las copias obsoletas de raíz generan advertencia mientras se eliminan, no un falso bloqueo.

## Activación después de subir los archivos

1. Confirma que GitHub conserva las carpetas ocultas `.codex/` y `.agents/`, además de `.github/`, `docs/`, `scripts/` y `supabase/`.
2. Elimina los cuatro archivos obsoletos enumerados en la entrega para dejar una única ruta canónica.
3. Espera a que `Configuración Codex de Atinara` y los demás workflows aparezcan en verde.
4. Cierra la sesión actual de Codex y vuelve a abrir el repositorio.
5. Marca el proyecto como confiable. Los proyectos no confiables omiten la capa `.codex/` local.
6. Ejecuta `/skills` y confirma que aparecen las diez skills sin nombres duplicados.
7. Comprueba que los cuatro subagentes aparecen como opciones disponibles.
8. Invoca `$atinara-codex-environment-check` para la primera comprobación.

## Comprobación local determinista

Desde la raíz del repositorio:

```powershell
python scripts/validate-codex-setup.py
```

Después pide a Codex:

```text
Enumera las fuentes de instrucciones que has cargado para este repositorio, las skills y subagentes disponibles, y resume las reglas operativas de Atinara sin modificar archivos.
```

Debe reconocer el `AGENTS.md` raíz, las instrucciones anidadas cuando corresponda y la configuración del proyecto actual. No debe basarse en un ZIP, una transcripción antigua o una carpeta distinta.

## Comprobación runtime de reglas

Ejecuta desde la raíz:

```powershell
codex execpolicy check --pretty --rules .codex/rules/atinara.rules -- git push origin main
codex execpolicy check --pretty --rules .codex/rules/atinara.rules -- npx --no-install supabase db push
codex execpolicy check --pretty --rules .codex/rules/atinara.rules -- npm run checkly:deploy
codex execpolicy check --pretty --rules .codex/rules/atinara.rules -- git status
```

Resultados esperados:

- los tres primeros comandos resuelven como `prompt`;
- `git status` no queda bloqueado por estas reglas;
- el resultado muestra la regla y su justificación.

Las reglas controlan escalados de comandos. No sustituyen `AGENTS.md`, permisos de apps ni autorización de producto.

## GitHub y Supabase

La configuración objetivo es:

- lecturas sin aprobación;
- cualquier escritura con aprobación humana;
- ninguna autorización global de push, deploy, SQL, secretos o resolución.

El 13 de agosto de 2026, los permisos de las apps GitHub y Supabase se ajustaron a `ask_before_writes`. `.codex/config.toml` refuerza el mismo modelo con `default_tools_approval_mode = "writes"`. Los permisos reales siguen siendo una barrera independiente y deben revisarse si se cambia de equipo, cuenta o sesión.

## SonarQube en Codex

La configuración SonarCloud del repositorio no equivale a integrar CLI y MCP en la máquina de Codex. La integración local requiere:

1. Abrir PowerShell en el repositorio.
2. Comprobar `Get-Command sonar`.
3. Actualizar el CLI con el método de instalación que corresponda.
4. Comprobar `sonar auth status`.
5. Si no está autenticado, completar el login de SonarQube Cloud. El token se almacena en el keychain y no se pega en chat.
6. Confirmar que Docker Desktop, Podman o Nerdctl está instalado y activo.
7. Obtener en SonarCloud la clave exacta del proyecto de Atinara.
8. Ejecutar:

```powershell
sonar integrate codex --non-interactive --project <SONAR_PROJECT_KEY>
```

9. Reiniciar Codex y comprobar que aparecen las herramientas MCP de SonarQube.

No inventes organización ni clave de proyecto. `.sonarcloud.properties` no contiene actualmente esa clave.

## Sentry en lectura

La integración de diagnóstico usa un token local de alcance mínimo, por ejemplo `project:read`, `event:read` y `org:read`.

- No pegues el token en chat.
- No lo guardes en `.env` versionado, repositorio, capturas o logs.
- Configura localmente `SENTRY_AUTH_TOKEN` y, cuando convenga, `SENTRY_ORG` y `SENTRY_PROJECT`.
- La skill de Sentry trabaja en lectura. Resolver o borrar incidencias no forma parte del flujo por defecto.

## Protección compatible de `main`

En el baseline de esta entrega, `main` continúa sin protección. Mientras Yol suba entregas manuales directamente, la protección inicial no debe obligar todavía a usar PR para cada cambio. El primer ruleset compatible debería:

- bloquear force push;
- impedir el borrado de la rama;
- no conceder bypass automático a agentes;
- no exigir todavía PR o checks previos que bloqueen el flujo manual actual.

Activar un ruleset es una mutación remota separada. No forma parte de los archivos de esta entrega.

## Selección de modelo y uso

El repositorio no fija modelo ni esfuerzo de razonamiento. La selección permanece local para adaptar coste y capacidad:

- tareas rutinarias y localizadas: modelo eficiente y razonamiento moderado;
- refactors, migraciones delicadas, Agent Engine, seguridad o incidencias complejas: modelo de mayor capacidad y razonamiento alto;
- subagentes: solo para trabajo independiente que justifique el consumo adicional;
- deep security scan: solo ante hito o solicitud expresa, no como comprobación cotidiana.

## Criterio de configuración terminada

La configuración queda operativa cuando:

- el repositorio está trusted;
- se carga `AGENTS.md` sin truncado;
- aparecen diez skills y cuatro subagentes;
- el validador local y el workflow están en verde;
- las reglas runtime devuelven los resultados esperados;
- GitHub y Supabase piden aprobación para escrituras;
- Sonar MCP aparece si se completa su integración local;
- Sentry puede consultar en lectura si se configura el token local;
- ninguna prueba requiere revelar o versionar secretos.
