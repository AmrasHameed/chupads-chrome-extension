import { DNRRule } from "./transformer";

export function optimize(rules: DNRRule[]): DNRRule[] {
  const seen = new Set<string>();
  const deduped: DNRRule[] = [];

  for (const rule of rules) {
    const key = `${rule.condition.urlFilter}:${rule.action.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(rule);
  }

  // Re-assign IDs cleanly after dedup
  return deduped.map((rule, i) => ({ ...rule, id: i + 1 }));
}