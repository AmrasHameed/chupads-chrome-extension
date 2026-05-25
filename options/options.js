async function setStatus(text) {
  document.getElementById("status").textContent = text;
}

async function load() {
  const { enabled, autoUpdateFilters, lastUpdated } =
    await chrome.storage.local.get([
      "enabled",
      "autoUpdateFilters",
      "lastUpdated",
    ]);

  document.getElementById("enabled").checked = enabled !== false;
  document.getElementById("autoUpdate").checked = autoUpdateFilters !== false;

  if (lastUpdated) {
    const hours = Math.floor((Date.now() - lastUpdated) / 3600000);
    setStatus(
      hours < 1
        ? "Filters updated recently."
        : `Last update: ${hours} hour(s) ago.`,
    );
  } else {
    setStatus("Using bundled filters.");
  }
}

document.getElementById("enabled").addEventListener("change", async (e) => {
  const enabled = e.target.checked;
  await chrome.storage.local.set({ enabled });
  await chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled });
  setStatus(enabled ? "Blocking enabled." : "Blocking disabled.");
});

document.getElementById("autoUpdate").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ autoUpdateFilters: e.target.checked });
  setStatus(
    e.target.checked
      ? "Automatic updates enabled."
      : "Automatic updates disabled. Bundled rules still apply.",
  );
});

document.getElementById("showPinGuide")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("welcome/welcome.html") });
});

document.getElementById("updateNow").addEventListener("click", async () => {
  setStatus("Updating filters…");
  try {
    await chrome.runtime.sendMessage({ type: "FORCE_UPDATE_RULES" });
    setStatus("Filter update started. Check again in a minute.");
    setTimeout(load, 2000);
  } catch {
    setStatus("Update failed. Reload the extension and try again.");
  }
});

load();
