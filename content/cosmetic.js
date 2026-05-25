// ========== ELEMENT PICKER ==========
let pickerActive = false;
let pickerOverlay = null;
let pickerTarget = null;

function startPicker() {
  if (pickerActive) return;
  pickerActive = true;

  pickerOverlay = document.createElement("div");
  pickerOverlay.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100% !important;
    height: 100% !important;
    z-index: 2147483647 !important;
    cursor: crosshair !important;
    background: rgba(33, 150, 243, 0.05) !important;
  `;
  document.documentElement.appendChild(pickerOverlay);

  pickerOverlay.addEventListener("mousemove", onPickerHover);
  pickerOverlay.addEventListener("click", onPickerClick);
  document.addEventListener("keydown", onPickerKeydown);
}

function onPickerHover(e) {
  pickerOverlay.style.pointerEvents = "none";
  const el = document.elementFromPoint(e.clientX, e.clientY);
  pickerOverlay.style.pointerEvents = "auto";

  if (!el || el === pickerOverlay) return;

  if (pickerTarget && pickerTarget !== el) {
    pickerTarget.style.outline = "";
    pickerTarget.style.outlineOffset = "";
  }

  pickerTarget = el;
  pickerTarget.style.outline = "2px solid #2196f3";
  pickerTarget.style.outlineOffset = "-2px";
}

function onPickerClick(e) {
  e.preventDefault();
  e.stopPropagation();

  pickerOverlay.style.pointerEvents = "none";
  const clickedEl = document.elementFromPoint(e.clientX, e.clientY);
  pickerOverlay.style.pointerEvents = "auto";

  if (!clickedEl || clickedEl === pickerOverlay) return;

  const selector = generateSelector(clickedEl);

  chrome.storage.local.get(["customSelectors"], (data) => {
    const customSelectors = data.customSelectors || [];
    if (!customSelectors.includes(selector)) {
      customSelectors.push(selector);
      chrome.storage.local.set({ customSelectors });
      injectCosmeticStyles([...ACTIVE_SELECTORS, selector]);
    }
  });

  try {
    clickedEl.style.setProperty("display", "none", "important");
  } catch (err) {}

  stopPicker();
}

function onPickerKeydown(e) {
  if (e.key === "Escape") stopPicker();
}

function stopPicker() {
  pickerActive = false;

  if (pickerTarget) {
    pickerTarget.style.outline = "";
    pickerTarget.style.outlineOffset = "";
    pickerTarget = null;
  }

  if (pickerOverlay) {
    pickerOverlay.remove();
    pickerOverlay = null;
  }

  document.removeEventListener("keydown", onPickerKeydown);
}

function generateSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;

  if (el.className && typeof el.className === "string") {
    const classes = el.className.split(/\s+/).filter((c) => c.trim());
    if (classes.length > 0) {
      const selector = "." + classes.map((c) => CSS.escape(c)).join(".");
      try {
        if (document.querySelector(selector)) return selector;
      } catch (e) {}
    }
  }

  const path = [];
  let current = el;
  while (current && current !== document.body && current.parentElement) {
    let sel = current.tagName.toLowerCase();
    const siblings = Array.from(current.parentElement.children);
    const index = siblings.indexOf(current) + 1;
    sel += `:nth-child(${index})`;
    path.unshift(sel);
    current = current.parentElement;
  }
  return path.join(" > ");
}

const countedElements = new WeakSet();
let cosmeticReportPending = 0;
let cosmeticReportTimer = null;

function flushCosmeticReport() {
  if (cosmeticReportPending < 1) return;
  const count = cosmeticReportPending;
  cosmeticReportPending = 0;
  chrome.runtime.sendMessage({
    type: "REPORT_COSMETIC_BLOCKS",
    count,
    hostname: window.location.hostname,
  });
}

function reportCosmeticBlocks(delta) {
  if (delta < 1) return;
  cosmeticReportPending += delta;
  clearTimeout(cosmeticReportTimer);
  cosmeticReportTimer = setTimeout(flushCosmeticReport, 250);
}

function countBlockedOnPage() {
  const seen = new Set();
  let hidden = 0;
  for (const selector of ACTIVE_SELECTORS) {
    try {
      document.querySelectorAll(selector).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        const style = getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          el.offsetHeight === 0
        ) {
          hidden++;
        }
      });
    } catch (e) {}
  }
  return hidden;
}

function countNewSelectorMatches(selectors) {
  let n = 0;
  for (const selector of selectors) {
    try {
      document.querySelectorAll(selector).forEach((el) => {
        if (countedElements.has(el)) return;
        countedElements.add(el);
        n++;
      });
    } catch (e) {}
  }
  return n;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.type === "START_PICKER") {
    startPicker();
  } else if (msg.type === "RELOAD_COSMETIC") {
    location.reload();
  } else if (msg.type === "GET_PAGE_BLOCK_COUNT") {
    sendResponse({ hiddenOnPage: countBlockedOnPage() });
    return true;
  }
});

// ========== COSMETIC FILTERING (performance-safe) ==========

const STYLE_ID = "chupads-cosmetic-style";
const DEBOUNCE_MS = 400;
const MAX_SELECTORS_PER_STYLE = 400;

const FALLBACK_SELECTORS = [
  "ins.adsbygoogle",
  ".tp-modal",
  ".tp-backdrop",
  "iframe[src*='doubleclick']",
  "iframe[src*='googlesyndication']",
  "[id^='div-gpt-ad-']",
];

let ACTIVE_SELECTORS = [...FALLBACK_SELECTORS];
let domObserver = null;
let debounceTimer = null;
let mutationBurst = 0;

function isValidSelector(selector) {
  try {
    document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

function hideElement(el) {
  const isNew = !countedElements.has(el);
  if (isNew) countedElements.add(el);
  try {
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("visibility", "hidden", "important");
  } catch (e) {}
  if (isNew) reportCosmeticBlocks(1);
}

function injectCosmeticStyles(selectors) {
  const valid = [...new Set(selectors)].filter(isValidSelector);
  ACTIVE_SELECTORS = valid;

  document.querySelectorAll(`[id^="${STYLE_ID}"]`).forEach((el) => el.remove());

  for (let i = 0; i < valid.length; i += MAX_SELECTORS_PER_STYLE) {
    const chunk = valid.slice(i, i + MAX_SELECTORS_PER_STYLE);
    const style = document.createElement("style");
    style.id = i === 0 ? STYLE_ID : `${STYLE_ID}-${i}`;
    style.textContent = chunk
      .map((s) => `${s}{display:none!important;visibility:hidden!important;height:0!important}`)
      .join("\n");
    (document.head || document.documentElement).appendChild(style);
  }

  applyFallbackToIframes();

  const newBlocks = countNewSelectorMatches(valid);
  if (newBlocks > 0) reportCosmeticBlocks(newBlocks);
}

function applyFallbackToIframes() {
  for (const selector of FALLBACK_SELECTORS) {
    try {
      document.querySelectorAll(selector).forEach(hideElement);
    } catch (e) {}
  }
}

function hideMatchingInRoot(root, selectors) {
  if (!root || root.nodeType !== 1) return;

  for (const selector of selectors) {
    try {
      if (root.matches && root.matches(selector)) hideElement(root);
      root.querySelectorAll(selector).forEach(hideElement);
    } catch (e) {}
  }
}

function onDomMutation(mutations) {
  mutationBurst += mutations.length;
  if (mutationBurst > 80) {
    domObserver?.disconnect();
    setTimeout(() => {
      if (domObserver) {
        domObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      }
      mutationBurst = 0;
    }, 2000);
    return;
  }

  const fastList = ACTIVE_SELECTORS;
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      hideMatchingInRoot(node, fastList);
    }
  }
}

function scheduleFallbackPass() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    applyFallbackToIframes();
    unlockPageScroll();
  }, DEBOUNCE_MS);
}

function unlockPageScroll() {
  if (document.body) {
    document.body.style.overflow = "";
    document.body.style.position = "";
  }
  if (document.documentElement) {
    document.documentElement.style.overflow = "";
  }
}

function loadAndApply() {
  chrome.storage.local.get(
    ["cosmeticGeneric", "cosmeticSiteSpecific", "customSelectors"],
    (data) => {
      const generic = data.cosmeticGeneric || [];
      const siteSpecific = data.cosmeticSiteSpecific || {};
      const custom = data.customSelectors || [];

      const hostname = window.location.hostname;
      const site = [
        ...(siteSpecific[hostname] || []),
        ...(siteSpecific[hostname.replace(/^www\./, "")] || []),
      ];

      const selectors = [
        ...FALLBACK_SELECTORS,
        ...site,
        ...custom,
        ...generic,
      ];

      injectCosmeticStyles(selectors);
      scheduleFallbackPass();
      unlockPageScroll();

      setTimeout(() => {
        const extra = countNewSelectorMatches(selectors);
        if (extra > 0) reportCosmeticBlocks(extra);
      }, 600);
    },
  );
}

function startCosmeticBlocking() {
  if (domObserver) return;
  loadAndApply();
  domObserver = new MutationObserver(onDomMutation);
  domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function stopCosmeticBlocking() {
  domObserver?.disconnect();
  domObserver = null;
  clearTimeout(debounceTimer);
  debounceTimer = null;
  mutationBurst = 0;
  document.getElementById(STYLE_ID)?.remove();
  document.querySelectorAll(`[id^="${STYLE_ID}"]`).forEach((el) => el.remove());
}

function applyEnabledState(enabled) {
  if (enabled === false) {
    stopCosmeticBlocking();
    return;
  }
  startCosmeticBlocking();
}

chrome.storage.local.get("enabled", ({ enabled }) => {
  applyEnabledState(enabled);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.enabled) return;
  applyEnabledState(changes.enabled.newValue);
});
