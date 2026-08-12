export const ATINARA_AGENT_TOOL_REGISTRY_VERSION = "atinara-agent-tools-v2.1.0";

const definitions = [
  ["read_provider_contract", "radar_source_agent", false],
  ["search_official_sources", "radar_source_agent", false],
  ["fetch_official_source", "radar_source_agent", false],
  ["classify_terminal_evidence", "radar_source_agent", false],
  ["select_resolution_authority", "radar_source_agent", false],
  ["load_authoritative_origin", "market_editor_agent", false],
  ["run_deterministic_gate", "market_editor_agent", false],
  ["request_editorial_enrichment", "market_editor_agent", false],
  ["validate_resolution_contract", "market_editor_agent", false],
  ["build_private_draft_gate", "market_editor_agent", false],
  ["persist_editor_run", "market_editor_agent", false],
  ["load_authoritative_draft", "market_corrector_agent", false],
  ["classify_repair_issues", "market_corrector_agent", false],
  ["discover_official_sources", "market_corrector_agent", false],
  ["build_typed_patch", "market_corrector_agent", false],
  ["validate_typed_patch", "market_corrector_agent", false],
  ["persist_single_version", "market_corrector_agent", true],
  ["revalidate_draft", "market_corrector_agent", false],
];

export const ATINARA_AGENT_TOOL_REGISTRY_V2 = Object.freeze(Object.fromEntries(
  definitions.map(([tool, agentType, canWrite]) => [tool, Object.freeze({
    tool,
    agentType,
    canWrite,
    confirmationAuthority: false,
    publicationAuthority: false,
    resolutionAuthority: false,
    liquidationAuthority: false,
  })]),
));

export const ATINARA_AGENT_TOOL_MANIFEST_V2 = Object.freeze(Object.fromEntries(
  [...new Set(definitions.map(([, agentType]) => agentType))].map((agentType) => [
    agentType,
    Object.freeze(definitions.filter(([, owner]) => owner === agentType).map(([tool]) => tool)),
  ]),
));

export function resolveAgentTool(agentType, toolName) {
  const definition = ATINARA_AGENT_TOOL_REGISTRY_V2[toolName];
  if (!definition || definition.agentType !== agentType) throw new Error("AGENT_TOOL_NOT_ALLOWED");
  return definition;
}

export function assertToolHandlers(agentType, handlers) {
  const expected = ATINARA_AGENT_TOOL_MANIFEST_V2[agentType];
  if (!expected) throw new Error("AGENT_TYPE_INVALID");
  if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) throw new Error("AGENT_TOOL_HANDLER_MISSING");
  for (const tool of expected) if (typeof handlers[tool] !== "function") throw new Error("AGENT_TOOL_HANDLER_MISSING");
  for (const tool of Object.keys(handlers)) if (!expected.includes(tool)) throw new Error("AGENT_TOOL_HANDLER_NOT_REGISTERED");
  return true;
}
