async function fetchStats() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { tabCount: 0, siteCount: 0, totalBlocked: 0, hostname: "", restricted: true };
  }

  if (
    !tab.url ||
    tab.url.startsWith("chrome://") ||
    tab.url.startsWith("chrome-extension://") ||
    tab.url.startsWith("edge://") ||
    tab.url.startsWith("about:")
  ) {
    return { tabCount: 0, siteCount: 0, totalBlocked: 0, hostname: "", restricted: true };
  }

  try {
    return await chrome.runtime.sendMessage({
      type: "GET_STATS",
      tabId: tab.id,
    });
  } catch {
    return { tabCount: 0, siteCount: 0, totalBlocked: 0, hostname: "", restricted: false };
  }
}

async function loadStats() {
  const { lastUpdated, customSelectors, enabled } = await chrome.storage.local.get([
    "lastUpdated",
    "customSelectors",
    "enabled",
  ]);

  const isOn = enabled !== false;
  const stats = await fetchStats();

  const totalEl = document.getElementById("total-blocked");
  const siteEl = document.getElementById("site-blocked");
  const hostEl = document.getElementById("site-hostname");

  if (stats.restricted) {
    totalEl.textContent = "—";
    hostEl.textContent = "This page can't be counted";
    siteEl.textContent = "N/A";
  } else if (!isOn) {
    totalEl.textContent = "0";
    hostEl.textContent = stats.hostname || "—";
    siteEl.textContent = "Blocking off";
  } else {
    totalEl.textContent = stats.tabCount.toLocaleString();
    hostEl.textContent = stats.hostname || "—";
    siteEl.textContent = `${stats.siteCount.toLocaleString()} blocked`;
  }

  const totalLabel = document.getElementById("hero-sub-label");
  if (totalLabel) {
    if (!isOn) {
      totalLabel.textContent = "blocking is disabled";
    } else if (stats.restricted) {
      totalLabel.textContent = "";
    } else {
      const network = stats.network ?? 0;
      const cosmetic = stats.cosmetic ?? 0;
      const onPage = stats.onPageNow ?? 0;
      totalLabel.textContent = `${cosmetic} hidden · ${network} network · ${onPage} on page`;
    }
  }

  if (lastUpdated) {
    const diff = Date.now() - lastUpdated;
    const hours = Math.floor(diff / 3600000);
    document.getElementById("last-updated").textContent =
      hours < 1 ? "Just now" : `${hours}h ago`;
  }

  const customSels = customSelectors || [];
  if (customSels.length > 0) {
    document.getElementById("pickedCount").textContent =
      `${customSels.length} custom element${customSels.length > 1 ? "s" : ""} blocked`;
    document.getElementById("clearPickedBtn").style.display = "flex";
  } else {
    document.getElementById("pickedCount").textContent = "";
    document.getElementById("clearPickedBtn").style.display = "none";
  }
}

async function updatePinBanner() {
  const banner = document.getElementById("pin-banner");
  if (!banner) return;

  const { showPinReminder } = await chrome.storage.local.get("showPinReminder");
  if (showPinReminder === false) {
    banner.style.display = "none";
    return;
  }

  try {
    const { isOnToolbar } = await chrome.action.getUserSettings();
    banner.style.display = isOnToolbar ? "none" : "block";
    if (isOnToolbar) {
      await chrome.storage.local.set({ showPinReminder: false });
    }
  } catch {
    banner.style.display = showPinReminder !== false ? "block" : "none";
  }
}

async function init() {
  const toggle = document.getElementById("toggle");
  const dot = document.getElementById("statusDot");

  const { enabled } = await chrome.storage.local.get("enabled");
  const isOn = enabled !== false;
  toggle.className = `toggle ${isOn ? "on" : "off"}`;
  dot.className = `status-dot ${isOn ? "" : "off"}`;

  toggle.addEventListener("click", async () => {
    const { enabled } = await chrome.storage.local.get("enabled");
    const isOn = enabled !== false;
    const newState = !isOn;

    await chrome.storage.local.set({ enabled: newState });
    toggle.className = `toggle ${newState ? "on" : "off"}`;
    dot.className = `status-dot ${newState ? "" : "off"}`;

    await chrome.runtime.sendMessage({
      type: "SET_ENABLED",
      enabled: newState,
    });

    await loadStats();

    setTimeout(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) chrome.tabs.reload(tab.id, { bypassCache: true });
    }, 300);
  });

  document.getElementById("pickerBtn").addEventListener("click", async () => {
    await sendToActiveTab({ type: "START_PICKER" });
    window.close();
  });

  document
    .getElementById("clearPickedBtn")
    .addEventListener("click", async () => {
      if (confirm("Clear all your custom picked elements?")) {
        await chrome.storage.local.set({ customSelectors: [] });
        await sendToActiveTab({ type: "RELOAD_COSMETIC" });
        window.close();
      }
    });

  document.getElementById("refreshStatsBtn")?.addEventListener("click", loadStats);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === "session" &&
      (changes.tabBlocked ||
        changes.tabCosmetic ||
        changes.tabNetwork ||
        changes.totalBlocked)
    ) {
      loadStats();
    }
  });

  document.getElementById("openOptions")?.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  document.getElementById("pinHelpBtn")?.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome/welcome.html") });
  });

  document.getElementById("pinDismissBtn")?.addEventListener("click", async () => {
    await chrome.storage.local.set({ showPinReminder: false });
    document.getElementById("pin-banner").style.display = "none";
  });

  await updatePinBanner();
  await loadStats();
  setInterval(loadStats, 1500);
  setInterval(updatePinBanner, 3000);
}

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // Restricted pages have no content script
  }
}

init();
