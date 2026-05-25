export type RawRule = {
  raw: string;
  isException: boolean;    // starts with @@
  isCosmetic: boolean;     // contains ##
  domain: string;
  options: string[];       // $script,image etc
};

export function parseEasyList(text: string): RawRule[] {
  const lines = text.split("\n");
  const rules: RawRule[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("!") || trimmed.startsWith("[")) continue;

    // Skip cosmetic rules for now
    if (trimmed.includes("##") || trimmed.includes("#@#")) continue;

    // Only handle || domain rules for now
    if (!trimmed.startsWith("||") && !trimmed.startsWith("@@||")) continue;

    const isException = trimmed.startsWith("@@");
    const withoutPrefix = trimmed.replace(/^@@\|\|/, "").replace(/^\|\|/, "");

    // Split domain from options
    const [domainPart, ...optionParts] = withoutPrefix.split("$");
    const domain = domainPart.replace("^", "").trim();
    const options = optionParts.length ? optionParts[0].split(",") : [];

    if (!domain) continue;

    rules.push({ raw: trimmed, isException, isCosmetic: false, domain, options });
  }

  return rules;
}