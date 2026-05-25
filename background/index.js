const FILTER_LISTS = [
  {
    name: "EasyList",
    url: "https://easylist.to/easylist/easylist.txt",
  },
  {
    name: "EasyPrivacy",
    url: "https://easylist.to/easylist/easyprivacy.txt",
  },
  {
    name: "Peter Lowe",
    url: "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext",
  },
  {
    name: "uBlock Badware",
    url: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt",
  },
];
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RULE_LIMIT = 25000;
const COSMETIC_GENERIC_LIMIT = 2000;

const BUNDLED_DYNAMIC_URL = chrome.runtime.getURL("rules/dynamic-rules.json");
const BUNDLED_COSMETIC_URL = chrome.runtime.getURL("rules/cosmetic-bundle.json");

// ---- Parser ----
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
      if (!siteSpecific[domain]) siteSpecific[domain] = [];
      siteSpecific[domain].push(parsed.selector);
    }
  }

  return { generic: [...generic], siteSpecific };
}

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

async function applyDynamicRules(rules) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules,
  });
}

async function applyCosmeticStorage(cosmetic) {
  await chrome.storage.local.set({
    cosmeticGeneric: cosmetic.generic || [],
    cosmeticSiteSpecific: cosmetic.siteSpecific || {},
  });
}

async function applyBundledRules() {
  try {
    const [rulesRes, cosmeticRes] = await Promise.all([
      fetch(BUNDLED_DYNAMIC_URL),
      fetch(BUNDLED_COSMETIC_URL),
    ]);

    if (!rulesRes.ok) return false;

    const rules = await rulesRes.json();
    const cosmetic = cosmeticRes.ok
      ? await cosmeticRes.json()
      : { generic: [], siteSpecific: {} };

    await applyDynamicRules(rules);
    await applyCosmeticStorage(cosmetic);
    await chrome.storage.local.set({ bundledApplied: true });
    return true;
  } catch {
    return false;
  }
}

async function applyCompiledFilters(combinedText, now) {
  const parsed = parseEasyList(combinedText);
  const rules = transformRules(parsed);
  const cosmetic = parseCosmeticRules(combinedText);

  await applyDynamicRules(rules);
  await applyCosmeticStorage(cosmetic);
  await chrome.storage.local.set({ lastUpdated: now });
}

async function updateRules(force = false) {
  const { lastUpdated, autoUpdateFilters, bundledApplied } =
    await chrome.storage.local.get([
      "lastUpdated",
      "autoUpdateFilters",
      "bundledApplied",
    ]);

  const now = Date.now();
  const autoUpdate = autoUpdateFilters !== false;

  if (!bundledApplied) {
    await applyBundledRules();
  }

  if (!force) {
    if (!autoUpdate) return;
    if (lastUpdated && now - lastUpdated < UPDATE_INTERVAL_MS) return;
  }

  try {
    const results = await Promise.allSettled(
      FILTER_LISTS.map((list) =>
        fetch(list.url)
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
          })
          .catch(() => ""),
      ),
    );
    const combinedText = results
      .map((r) => (r.status === "fulfilled" ? r.value : ""))
      .join("\n");

    if (!combinedText.trim()) return;

    await applyCompiledFilters(combinedText, now);
  } catch {
    // Keep bundled / previous rules
  }
}

const UPDATE_ALARM = "chupads-update-filters";

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await applyBundledRules();
    await chrome.storage.local.set({
      enabled: true,
      autoUpdateFilters: true,
      lastUpdated: Date.now(),
      showPinReminder: true,
    });
    chrome.tabs.create({
      url: chrome.runtime.getURL("welcome/welcome.html"),
    });
  }
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 24 * 60 });
  updateRules(false);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) updateRules(false);
});

updateRules(false);

// ---- Block stats (store-safe: cosmetic + getMatchedRules, no debug API) ----
let statsCache = null;
let statsFlushTimer = null;

async function getStatsCache() {
  if (statsCache) return statsCache;
  const data = await chrome.storage.session.get([
    "tabBlocked",
    "siteBlocked",
    "totalBlocked",
    "tabNetwork",
    "tabCosmetic",
  ]);
  statsCache = {
    tabBlocked: data.tabBlocked || {},
    siteBlocked: data.siteBlocked || {},
    totalBlocked: data.totalBlocked || 0,
    tabNetwork: data.tabNetwork || {},
    tabCosmetic: data.tabCosmetic || {},
    dirty: false,
  };
  return statsCache;
}

function scheduleStatsFlush() {
  clearTimeout(statsFlushTimer);
  statsFlushTimer = setTimeout(async () => {
    if (!statsCache?.dirty) return;
    await chrome.storage.session.set({
      tabBlocked: statsCache.tabBlocked,
      siteBlocked: statsCache.siteBlocked,
      totalBlocked: statsCache.totalBlocked,
      tabNetwork: statsCache.tabNetwork,
      tabCosmetic: statsCache.tabCosmetic,
    });
    statsCache.dirty = false;
  }, 200);
}

function updateBadge(total) {
  if (total < 1) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  chrome.action.setBadgeText({ text: total > 999 ? "999+" : String(total) });
  chrome.action.setBadgeBackgroundColor({ color: "#e53e3e" });
}

async function incrementBlockCount(tabId, hostname, count = 1, source = "cosmetic") {
  if (!tabId || tabId < 0 || count < 1) return;
  const cache = await getStatsCache();

  cache.tabBlocked[tabId] = (cache.tabBlocked[tabId] || 0) + count;
  if (source === "network") {
    cache.tabNetwork[tabId] = (cache.tabNetwork[tabId] || 0) + count;
  } else {
    cache.tabCosmetic[tabId] = (cache.tabCosmetic[tabId] || 0) + count;
  }
  if (hostname) {
    cache.siteBlocked[hostname] = (cache.siteBlocked[hostname] || 0) + count;
  }
  cache.totalBlocked += count;
  cache.dirty = true;

  scheduleStatsFlush();
  updateBadge(cache.totalBlocked);
}

async function syncNetworkCountFromDnr(tabId) {
  if (tabId < 0) return 0;
  try {
    const { rulesMatchedInfo } =
      await chrome.declarativeNetRequest.getMatchedRules({
        tabId,
        limit: 1000,
      });
    const count = rulesMatchedInfo?.length ?? 0;
    if (count < 1) return 0;

    const cache = await getStatsCache();
    const prev = cache.tabNetwork[tabId] || 0;
    if (count > prev) {
      const delta = count - prev;
      cache.tabNetwork[tabId] = count;
      cache.tabBlocked[tabId] = (cache.tabBlocked[tabId] || 0) + delta;
      cache.totalBlocked += delta;
      cache.dirty = true;
      scheduleStatsFlush();
      updateBadge(cache.totalBlocked);
    }
    return count;
  } catch {
    return 0;
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const cache = await getStatsCache();
  if (cache.tabBlocked[tabId] == null) return;
  delete cache.tabBlocked[tabId];
  delete cache.tabNetwork[tabId];
  delete cache.tabCosmetic[tabId];
  cache.dirty = true;
  scheduleStatsFlush();
});

async function getOnPageHiddenCount(tabId) {
  try {
    const resp = await chrome.tabs.sendMessage(tabId, {
      type: "GET_PAGE_BLOCK_COUNT",
    });
    return resp?.hiddenOnPage ?? 0;
  } catch {
    return 0;
  }
}

async function getStatsForTab(tabId) {
  const cache = await getStatsCache();

  let hostname = "";
  if (tabId >= 0) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url) hostname = new URL(tab.url).hostname;
    } catch (e) {}
  }

  const networkFromDnr =
    tabId >= 0 ? await syncNetworkCountFromDnr(tabId) : 0;
  const network = Math.max(cache.tabNetwork[tabId] || 0, networkFromDnr);
  const cosmetic = cache.tabCosmetic[tabId] || 0;
  const onPageNow = tabId >= 0 ? await getOnPageHiddenCount(tabId) : 0;

  const tabCount = Math.max(network + cosmetic, onPageNow, cache.tabBlocked[tabId] || 0);
  const siteCount = hostname
    ? Math.max(cache.siteBlocked[hostname] || 0, tabCount)
    : tabCount;

  return {
    tabCount,
    siteCount,
    network,
    cosmetic,
    onPageNow,
    totalBlocked: cache.totalBlocked,
    hostname,
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  if (msg.type === "GET_STATS") {
    getStatsForTab(msg.tabId).then(sendResponse);
    return true;
  }

  if (msg.type === "REPORT_COSMETIC_BLOCKS" && sender.tab?.id != null) {
    const count = Math.min(Number(msg.count) || 0, 500);
    if (count > 0) {
      incrementBlockCount(sender.tab.id, msg.hostname || "", count, "cosmetic");
    }
    return;
  }

  if (msg.type === "FORCE_UPDATE_RULES") {
    updateRules(true).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "SET_ENABLED" && typeof msg.enabled === "boolean") {
    if (msg.enabled) {
      updateRules(false);
      chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: ["static_rules"],
        disableRulesetIds: [],
      });
      chrome.storage.local.get("bundledApplied").then(({ bundledApplied }) => {
        if (!bundledApplied) applyBundledRules();
      });
    } else {
      chrome.declarativeNetRequest.getDynamicRules().then((existing) => {
        chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: existing.map((r) => r.id),
          addRules: [],
        });
      });
      chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: [],
        disableRulesetIds: ["static_rules"],
      });

      statsCache = {
        tabBlocked: {},
        siteBlocked: {},
        totalBlocked: 0,
        tabNetwork: {},
        tabCosmetic: {},
        dirty: true,
      };
      chrome.storage.session.set({
        tabBlocked: {},
        siteBlocked: {},
        totalBlocked: 0,
        tabNetwork: {},
        tabCosmetic: {},
      });
      chrome.action.setBadgeText({ text: "" });
    }
  }
});
