const INJECTION_PATTERNS = [
  /ignore (?:all|any|the) previous/i,
  /system prompt/i,
  /developer message/i,
  /reveal (?:your|the) (?:instructions|secrets|token)/i,
  /execute (?:sql|javascript|code|command)/i,
  /act as (?:an?|the) (?:system|administrator)/i,
  /<\/?(?:system|assistant|tool)>/i,
];

export function sanitizeExternalText(value, maxLength = 4000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function inspectPromptInjection(value) {
  const text = sanitizeExternalText(value, 12000);
  const matches = INJECTION_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  return { safe_text: text, suspicious: matches.length > 0, reason_codes: matches.length ? ["EXTERNAL_INSTRUCTION_IGNORED"] : [] };
}

export function wrapUntrustedEvidence(value) {
  const inspected = inspectPromptInjection(value);
  return {
    content: inspected.safe_text,
    trust: "untrusted_external_data",
    instructions_allowed: false,
    policy_flags: inspected.reason_codes,
  };
}
