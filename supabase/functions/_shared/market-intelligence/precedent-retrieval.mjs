export function applicablePrecedents(precedents = [], input = {}) {
  const tags = new Set((input.tags || []).map((tag) => String(tag).toLowerCase()));
  return (Array.isArray(precedents) ? precedents : [])
    .filter((item) => item?.active === true && item?.policy_version === input.policy_version)
    .map((item) => ({
      ...item,
      relevance: (item.category === input.category ? 2 : 0) + (item.tags || []).filter((tag) => tags.has(String(tag).toLowerCase())).length,
    }))
    .filter((item) => item.relevance > 0)
    .sort((left, right) => right.relevance - left.relevance)
    .slice(0, 5);
}
