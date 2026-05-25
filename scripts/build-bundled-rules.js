/**
 * Build bundled filter files for production (no network needed on install).
 * Usage: node scripts/build-bundled-rules.js [path/to/easylist.txt]
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const input =
  process.argv[2] || path.join(root, "easylist.txt");
const dynamicOut = path.join(root, "rules", "dynamic-rules.json");
const cosmeticOut = path.join(root, "rules", "cosmetic-bundle.json");

const RULE_LIMIT = 25000;
const COSMETIC_GENERIC_LIMIT = 2000;
const SITE_DOMAIN_LIMIT = 4000;
const SITE_SELECTORS_PER_DOMAIN = 40;

const RESOURCE_MAP = {
  script: "script",
  image: "image",
  stylesheet: "stylesheet",
  xmlhttprequest: "xmlhttprequest",
  subdocument: "sub_frame",
  font: "font",
  media: "media",
  websocket: "websocket",
  object: "object",
};
const DEFAULT_TYPES = [
  "script",
  "image",
  "stylesheet",
  "xmlhttprequest",
  "sub_frame",
  "font",
  "media",
];

function parseEasyList(text) {
  const rules = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("!") || t.startsWith("[")) continue;
    if (t.includes("##") || t.includes("#@#")) continue;
    if (!t.startsWith("||") && !t.startsWith("@@||")) continue;

    const isException = t.startsWith("@@");
    const withoutPrefix = t.replace(/^@@\|\|/, "").replace(/^\|\|/, "");
    const [domainPart, ...optionParts] = withoutPrefix.split("$");
    const domain = domainPart.replace("^", "").trim();
    const options = optionParts.length ? optionParts[0].split(",") : [];
    if (!domain || domain.length < 4) continue;

    rules.push({ domain, isException, options });
  }
  return rules;
}

function parseCosmeticLine(t) {
  if (t.includes("#@#")) return null;
  if (t.startsWith("###")) {
    const selector = `#${t.slice(3).trim()}`;
    return selector && !selector.startsWith("+js") ? { generic: selector } : null;
  }
  if (t.startsWith("##")) {
    const selector = t.slice(2).trim();
    return selector && !selector.startsWith("+js") ? { generic: selector } : null;
  }
  const sep = t.indexOf("##");
  if (sep === -1) return null;
  const sitePart = t.slice(0, sep).trim();
  const selector = t.slice(sep + 2).trim();
  if (!sitePart || !selector || selector.startsWith("+js")) return null;
  return { sitePart, selector };
}

function parseCosmeticRules(text) {
  const generic = new Set();
  const siteSpecific = {};
  let domainCount = 0;

  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("!") || t.startsWith("[")) continue;

    const parsed = parseCosmeticLine(t);
    if (!parsed) continue;

    if (parsed.generic) {
      if (generic.size < COSMETIC_GENERIC_LIMIT) generic.add(parsed.generic);
      continue;
    }

    const domains = parsed.sitePart
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    for (const domain of domains) {
      if (!siteSpecific[domain]) {
        if (domainCount >= SITE_DOMAIN_LIMIT) continue;
        siteSpecific[domain] = [];
        domainCount++;
      }
      if (siteSpecific[domain].length < SITE_SELECTORS_PER_DOMAIN) {
        siteSpecific[domain].push(parsed.selector);
      }
    }
  }

  return { generic: [...generic], siteSpecific };
}

function transformRules(parsed) {
  const seen = new Set();
  const result = [];
  let id = 1;

  for (const r of parsed) {
    const key = `${r.domain}:${r.isException}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const mappedTypes = r.options
      .map((o) => RESOURCE_MAP[o.replace("~", "")])
      .filter(Boolean);

    result.push({
      id: id++,
      priority: r.isException ? 2 : 1,
      action: { type: r.isException ? "allow" : "block" },
      condition: {
        urlFilter: `||${r.domain}^`,
        resourceTypes: mappedTypes.length ? mappedTypes : DEFAULT_TYPES,
        isUrlFilterCaseSensitive: false,
      },
    });

    if (result.length >= RULE_LIMIT) break;
  }
  return result;
}

if (!fs.existsSync(input)) {
  console.error(`Missing filter input: ${input}`);
  console.error("Place easylist.txt in project root or pass a path.");
  process.exit(1);
}

console.log("Reading", input);
const text = fs.readFileSync(input, "utf-8");

const parsed = parseEasyList(text);
const dynamic = transformRules(parsed);
fs.mkdirSync(path.dirname(dynamicOut), { recursive: true });
fs.writeFileSync(dynamicOut, JSON.stringify(dynamic));
console.log(`Wrote ${dynamic.length} network rules → ${dynamicOut}`);

const cosmetic = parseCosmeticRules(text);
fs.writeFileSync(cosmeticOut, JSON.stringify(cosmetic));
console.log(
  `Wrote cosmetic bundle (${cosmetic.generic.length} generic, ${Object.keys(cosmetic.siteSpecific).length} domains) → ${cosmeticOut}`,
);
