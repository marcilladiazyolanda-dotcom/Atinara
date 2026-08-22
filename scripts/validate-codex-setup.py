#!/usr/bin/env python3
"""Valida la configuración Codex versionada de Atinara sin red ni dependencias."""

from __future__ import annotations

import re
import shlex
import sys
import tomllib
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_SKILLS = {
    "atinara-agent-engine-v2",
    "atinara-change-gate",
    "atinara-codex-environment-check",
    "atinara-docs-memory-consistency",
    "atinara-incident-diagnostics",
    "atinara-market-integrity",
    "atinara-release-verification",
    "atinara-security-review",
    "atinara-supabase-safe-change",
    "atinara-ui-regression",
}

REQUIRED_AGENTS = {
    "atinara_explorer",
    "atinara_reviewer",
    "atinara_supabase_auditor",
    "atinara_test_analyst",
}

CANONICAL_DOCS = {
    "docs/ATINARA_AGENT_ENGINE.md",
    "docs/ATINARA_AI_GATEWAY.md",
    "docs/ATINARA_AGENT_ENGINE_V2_RUNBOOK.md",
    "docs/ATINARA_CODEX_SETUP.md",
}

OBSOLETE_ROOT_COPIES = {
    "ATINARA_AGENT_ENGINE.md",
    "ATINARA_AI_GATEWAY.md",
    "ATINARA_AGENT_ENGINE_V2_RUNBOOK.md",
    "radar_eligibility_v7_transaction.sql",
}

SECRET_SCAN_IGNORED_DIRECTORIES = {
    ".git",
    "node_modules",
}


def fail(message: str) -> None:
    raise AssertionError(message)


def parse_toml(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as handle:
            return tomllib.load(handle)
    except Exception as exc:  # noqa: BLE001
        fail(f"TOML inválido en {path.relative_to(ROOT)}: {exc}")


def parse_skill_frontmatter(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        fail(f"Falta frontmatter en {path.relative_to(ROOT)}")
    parts = text.split("---\n", 2)
    if len(parts) != 3 or not parts[2].strip():
        fail(f"Frontmatter o cuerpo inválido en {path.relative_to(ROOT)}")
    metadata: dict[str, str] = {}
    for raw_line in parts[1].strip().splitlines():
        key, separator, value = raw_line.partition(":")
        if separator:
            metadata[key.strip()] = value.strip().strip('"').strip("'")
    return metadata


def validate_openai_yaml(path: Path, skill_name: str) -> bool:
    text = path.read_text(encoding="utf-8")
    required_patterns = {
        "interface": r"(?m)^interface:\s*$",
        "display_name": r"(?m)^\s+display_name:\s*.+$",
        "short_description": r"(?m)^\s+short_description:\s*.+$",
        "default_prompt": r"(?m)^\s+default_prompt:\s*.+$",
        "policy": r"(?m)^policy:\s*$",
        "allow_implicit_invocation": r"(?m)^\s+allow_implicit_invocation:\s*(true|false)\s*$",
    }
    for label, pattern in required_patterns.items():
        if not re.search(pattern, text):
            fail(f"Falta {label} en {path.relative_to(ROOT)}")
    if f"${skill_name}" not in text:
        fail(f"default_prompt no invoca ${skill_name} en {path.relative_to(ROOT)}")
    match = re.search(r"(?m)^\s+allow_implicit_invocation:\s*(true|false)\s*$", text)
    assert match is not None
    return match.group(1) == "true"


def argv_matches(pattern: list[object], argv: list[str]) -> bool:
    if len(argv) < len(pattern):
        return False
    for expected, actual in zip(pattern, argv, strict=False):
        if isinstance(expected, list):
            if actual not in expected:
                return False
        elif actual != expected:
            return False
    return True


def validate_rules(path: Path) -> tuple[int, int]:
    rules: list[dict[str, Any]] = []

    def prefix_rule(**kwargs: Any) -> None:
        rules.append(kwargs)

    namespace: dict[str, Any] = {"prefix_rule": prefix_rule, "__builtins__": {}}
    try:
        exec(compile(path.read_text(encoding="utf-8"), str(path), "exec"), namespace, namespace)  # noqa: S102
    except Exception as exc:  # noqa: BLE001
        fail(f"Reglas inválidas en {path.relative_to(ROOT)}: {exc}")

    examples = 0
    for index, rule in enumerate(rules, start=1):
        pattern = rule.get("pattern")
        decision = rule.get("decision", "allow")
        justification = rule.get("justification")
        if not isinstance(pattern, list) or not pattern:
            fail(f"Regla {index} sin pattern válido")
        if decision not in {"allow", "prompt", "forbidden"}:
            fail(f"Regla {index} con decision inválida: {decision}")
        if decision in {"prompt", "forbidden"} and not justification:
            fail(f"Regla {index} restrictiva sin justificación")
        for command in rule.get("match", []):
            examples += 1
            if not argv_matches(pattern, shlex.split(command, posix=True)):
                fail(f"Ejemplo match no coincide en regla {index}: {command}")
        for command in rule.get("not_match", []):
            examples += 1
            if argv_matches(pattern, shlex.split(command, posix=True)):
                fail(f"Ejemplo not_match coincide en regla {index}: {command}")

    if len(rules) < 20:
        fail(f"Número inesperadamente bajo de reglas: {len(rules)}")
    return len(rules), examples


def validate_docs() -> list[str]:
    warnings: list[str] = []
    for rel in CANONICAL_DOCS:
        path = ROOT / rel
        if not path.is_file() or path.stat().st_size < 500:
            fail(f"Documento canónico ausente o vacío: {rel}")
    agent_engine = (ROOT / "docs/ATINARA_AGENT_ENGINE.md").read_text(encoding="utf-8")
    gateway = (ROOT / "docs/ATINARA_AI_GATEWAY.md").read_text(encoding="utf-8")
    runbook = (ROOT / "docs/ATINARA_AGENT_ENGINE_V2_RUNBOOK.md").read_text(encoding="utf-8")
    for label, text in (("Agent Engine", agent_engine), ("AI Gateway", gateway), ("Runbook", runbook)):
        if "legacy_direct" not in text or "producción" not in text:
            fail(f"{label} no refleja el estado productivo V2.1")
    for rel in sorted(OBSOLETE_ROOT_COPIES):
        if (ROOT / rel).exists():
            warnings.append(f"Copia raíz pendiente de eliminar: {rel}")
    return warnings


def validate_no_secrets() -> None:
    forbidden_files = {".env", ".env.local", ".env.production"}
    secret_assignment = re.compile(
        r"(?i)(?:service_role_key|supabase_service_role_key|api_key|auth_token|secret)\s*=\s*['\"][A-Za-z0-9_\-\.]{20,}"
    )
    for path in ROOT.rglob("*"):
        rel = path.relative_to(ROOT)
        if any(part in SECRET_SCAN_IGNORED_DIRECTORIES for part in rel.parts):
            continue
        if not path.is_file():
            continue
        if path.name in forbidden_files or path.name.startswith(".env."):
            fail(f"Archivo de entorno no permitido: {rel}")
        if path.suffix.lower() in {".zip", ".png", ".jpg", ".jpeg", ".gif", ".pdf"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if secret_assignment.search(text):
            fail(f"Posible secreto asignado en {rel}")


def main() -> int:
    required_paths = [
        ROOT / "AGENTS.md",
        ROOT / "SECURITY.md",
        ROOT / ".codex/config.toml",
        ROOT / ".codex/rules/atinara.rules",
        ROOT / "supabase/functions/AGENTS.md",
        ROOT / "supabase/migrations/AGENTS.md",
        ROOT / "supabase/tests/radar_eligibility_v7_transaction.sql",
    ]
    for path in required_paths:
        if not path.is_file():
            fail(f"Falta archivo requerido: {path.relative_to(ROOT)}")

    config = parse_toml(ROOT / ".codex/config.toml")
    if config.get("approval_policy") != "on-request":
        fail("approval_policy debe permanecer en on-request")
    if config.get("approvals_reviewer") != "user":
        fail("approvals_reviewer debe permanecer en user")
    if config.get("sandbox_mode") != "workspace-write":
        fail("sandbox_mode debe permanecer en workspace-write")
    if config.get("sandbox_workspace_write", {}).get("network_access") is not False:
        fail("La red del sandbox debe permanecer desactivada")
    if config.get("apps", {}).get("_default", {}).get("default_tools_approval_mode") != "writes":
        fail("Las escrituras de apps deben requerir aprobación")
    max_threads = int(config.get("agents", {}).get("max_concurrent_threads_per_session", 0))
    if not 1 <= max_threads <= 4:
        fail("El techo de subagentes debe estar entre 1 y 4")

    custom_agents: set[str] = set()
    for path in sorted((ROOT / ".codex/agents").glob("*.toml")):
        data = parse_toml(path)
        for field in ("name", "description", "developer_instructions"):
            if not isinstance(data.get(field), str) or not data[field].strip():
                fail(f"Falta {field} en {path.relative_to(ROOT)}")
        if data["name"] in custom_agents:
            fail(f"Subagente duplicado: {data['name']}")
        custom_agents.add(data["name"])
    missing_agents = REQUIRED_AGENTS - custom_agents
    if missing_agents:
        fail(f"Faltan subagentes: {sorted(missing_agents)}")

    skills_root = ROOT / ".agents/skills"
    skill_names: set[str] = set()
    implicit_count = 0
    for skill_dir in sorted(path for path in skills_root.iterdir() if path.is_dir()):
        skill_path = skill_dir / "SKILL.md"
        yaml_path = skill_dir / "agents/openai.yaml"
        if not skill_path.is_file() or not yaml_path.is_file():
            fail(f"Skill incompleta: {skill_dir.relative_to(ROOT)}")
        metadata = parse_skill_frontmatter(skill_path)
        name = metadata.get("name", "")
        description = metadata.get("description", "")
        if name != skill_dir.name:
            fail(f"El name no coincide con la carpeta en {skill_path.relative_to(ROOT)}")
        if len(description) < 40:
            fail(f"Description demasiado corta en {skill_path.relative_to(ROOT)}")
        if name in skill_names:
            fail(f"Skill duplicada: {name}")
        skill_names.add(name)
        implicit_count += int(validate_openai_yaml(yaml_path, name))
    missing_skills = REQUIRED_SKILLS - skill_names
    if missing_skills:
        fail(f"Faltan skills: {sorted(missing_skills)}")
    if implicit_count != len(skill_names) - 1:
        fail("Solo la comprobación del entorno debe requerir invocación explícita")

    max_bytes = int(config.get("project_doc_max_bytes", 32768))
    root_size = (ROOT / "AGENTS.md").stat().st_size
    for nested in (ROOT / "supabase/functions/AGENTS.md", ROOT / "supabase/migrations/AGENTS.md"):
        combined = root_size + nested.stat().st_size
        if combined > max_bytes:
            fail(f"Cadena AGENTS.md supera {max_bytes} bytes en {nested.relative_to(ROOT)}")

    sql = (ROOT / "supabase/tests/radar_eligibility_v7_transaction.sql").read_text(encoding="utf-8")
    if not sql.lstrip().lower().startswith("begin;") or not sql.rstrip().lower().endswith("rollback;"):
        fail("La prueba SQL v7 debe permanecer transaccional con BEGIN/ROLLBACK")
    if "agent_engine_confirmation_v8_transaction" not in sql:
        fail("La prueba SQL v7 no contiene la referencia de compatibilidad v8 esperada")

    rule_count, example_count = validate_rules(ROOT / ".codex/rules/atinara.rules")
    warnings = validate_docs()
    validate_no_secrets()

    print("Configuración Codex de Atinara válida")
    print(f"- Skills: {len(skill_names)} ({implicit_count} implícitas, 1 explícita)")
    print(f"- Subagentes: {len(custom_agents)}")
    print(f"- Reglas: {rule_count}")
    print(f"- Ejemplos inline: {example_count}")
    print(f"- Límite AGENTS.md: {max_bytes} bytes")
    print("- SQL v7: transaccional y compatible con cierre v8")
    for warning in warnings:
        print(f"ADVERTENCIA: {warning}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
