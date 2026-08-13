---
name: atinara-codex-environment-check
description: "Usa explícitamente esta habilidad para instalar, comprobar o diagnosticar la configuración local de Codex para Atinara, sus skills, reglas, permisos, MCP, SonarQube o Sentry. No usar para desarrollar funciones del producto."
---

# Comprobación del entorno Codex de Atinara

Esta habilidad es de diagnóstico. No modifica producción ni instala herramientas sin aprobación.

## 1. Proyecto y confianza

- Confirma que Codex se abrió dentro del repositorio Atinara correcto.
- Comprueba `git rev-parse --show-toplevel`, `git remote -v`, rama y `origin/main`.
- Verifica que el proyecto está marcado como trusted; de lo contrario `.codex/` no se carga.

## 2. Instrucciones

- Pide a Codex que enumere las fuentes de instrucciones cargadas.
- Confirma que incluye el `AGENTS.md` raíz y no una copia antigua externa.
- Comprueba que `project_doc_max_bytes` no trunca la cadena.

## 3. Skills

- Ejecuta `/skills` y confirma nombres únicos bajo `.agents/skills`.
- Prueba una invocación explícita con `$atinara-change-gate`.
- Comprueba activación implícita con un prompt representativo.
- Si una skill nueva no aparece, reinicia Codex.

## 4. Reglas

Valida `.codex/rules/atinara.rules` con `codex execpolicy check`. Como mínimo, `git push`, `npx --no-install supabase db push` y `npm run checkly:deploy` deben resolver a `prompt`. Comandos de lectura como `git status` no deben quedar bloqueados por estas reglas.

## 5. Apps y MCP

- GitHub y Supabase deben permitir lectura y pedir aprobación para escrituras.
- No imprimas tokens ni valores de secretos.
- Verifica SonarQube MCP solo después de comprobar `sonar auth status` y un runtime de contenedores activo.
- Sentry se usa en lectura con `SENTRY_AUTH_TOKEN` local de alcance mínimo; nunca se pega en chat ni se versiona.

## 6. Resultado

Entrega una tabla: componente, comprobación, evidencia, estado y acción pendiente. Distingue configuración del repositorio, configuración personal local y servicios externos. No declares configurado aquello que no puedas inspeccionar.
