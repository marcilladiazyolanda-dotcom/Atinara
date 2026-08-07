export const EXPERT_TOOLS = Object.freeze([
  "get_normalized_origin",
  "get_existing_definitions",
  "get_related_family",
  "check_duplicate",
  "check_temporal_logic",
  "check_option_logic",
  "get_source_registry",
  "get_approved_precedents",
  "validate_resolution_contract",
  "search_official_context_limited",
  "get_context_items",
  "get_authorized_provider_data",
]);

export function routeExpertTool(name, handlers, args = {}) {
  if (!EXPERT_TOOLS.includes(name)) throw new Error("EXPERT_TOOL_NOT_ALLOWED");
  if (name === "search_official_context_limited" && typeof args?.url === "string") throw new Error("ARBITRARY_URL_NOT_ALLOWED");
  const handler = handlers?.[name];
  if (typeof handler !== "function") throw new Error("EXPERT_TOOL_UNAVAILABLE");
  return handler(args);
}
