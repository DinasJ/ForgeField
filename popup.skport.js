// SKPORT integration: session capture, cookie/tab scripting, and UI sync
// Exports global functions used by popup.js: syncGameSession, updateSKPORTLinkUI, checkCredentials

const syncGameSession = async () => {
  const loginBtn = document.getElementById("btn-skport-login");
  const nextBtn = document.getElementById("skport-next-btn");
  const statusText = document.getElementById("status-text");

  chrome.storage.local.get(["cred", "skGameRole", "googleToken"], async (stored) => {
    let cred = stored.cred;
    let skGameRole = stored.skGameRole;
    const isDriveValid = !!stored.googleToken;

    if (!cred || !skGameRole) {
      const [tab] = await chrome.tabs.query({ url: "*://*.skport.com/*" });
      if (tab) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => localStorage.getItem("APP_CURRENT_ROLE_GAME_ROLE:endfield"),
        }, (results) => {
          const rawRole = results?.[0]?.result;
          // Game may store e.g. "3::6210208872::3"; API expects "3_6210208872_3"
          let cleanedRole = rawRole ? rawRole.replace(/::/g, "_") : null;
          if (cleanedRole && typeof normalizeSkGameRole === "function") cleanedRole = normalizeSkGameRole(cleanedRole);

          chrome.cookies.get({ url: tab.url, name: "SK_OAUTH_CRED_KEY" }, (cookie) => {
            const foundCred = cookie ? cookie.value : null;
            chrome.storage.local.set({
              cred: foundCred || cred,
              skGameRole: cleanedRole || skGameRole,
            }, () => {
              updateSyncUI(!!(foundCred && cleanedRole), isDriveValid);
            });
          });
        });
        return;
      }
    }

    updateSyncUI(!!(cred && skGameRole), isDriveValid);
  });

  function updateSyncUI(isLive, isDriveValid) {
    if (typeof toggleDashboardControls === "function") {
      chrome.storage.local.get(["webAppUrl", "googleWebAppAuthorized"], (webData) => {
        toggleDashboardControls(isDriveValid, isLive, !!webData.webAppUrl, !!webData.googleWebAppAuthorized);
      });
    }

    const statusLabel = isLive ? "Connected" : "Disconnected";
    const statusColor = isLive ? "#22c55e" : "#ffa500";

    if (statusText) { statusText.innerText = statusLabel; statusText.style.color = statusColor; }
    if (loginBtn) {
      const textEl = loginBtn.querySelector(".skport-btn-text");
      if (textEl) textEl.textContent = isLive ? "✓ SKPORT Connected" : "Open SKPORT Sign-in";
      loginBtn.disabled = !!isLive;
      loginBtn.classList.toggle("dimmed-button", isLive);
      loginBtn.classList.toggle("skport-connected", isLive);
    }
    if (nextBtn) {
      nextBtn.disabled = !isLive;
      nextBtn.style.opacity = isLive ? "1" : "0.3";
      nextBtn.classList.toggle("btn-active", isLive);
    }

    // Page 1: SKPORT status pill
    const page1Stat = document.getElementById("page1-stat-skport-name");
    if (page1Stat) {
      page1Stat.innerText = statusLabel;
      page1Stat.setAttribute("data-state", isLive ? "success" : "warning");
    }

    // Summary page (Page 3): same stat so it stays in sync (status-pill)
    const summaryStat = document.getElementById("stat-skport-name");
    if (summaryStat) {
      summaryStat.innerText = statusLabel;
      summaryStat.setAttribute("data-state", isLive ? "success" : "warning");
    }

    // Dashboard: SKPORT pill badge
    const dashStat = document.getElementById("dashboard-stat-skport-name");
    if (dashStat) {
      dashStat.innerText = statusLabel;
      dashStat.setAttribute("data-state", isLive ? "success" : "warning");
    }
  }
};

const updateSKPortLinkUI = () => {
  chrome.storage.local.get(["cred", "skGameRole"], (data) => {
    const isLive = !!data.cred && data.cred !== "PENDING" && !!(data.skGameRole && data.skGameRole.length > 5);
    const statusLabel = isLive ? "Connected" : "Disconnected";
    const statusColor = isLive ? "#22c55e" : "#ffa500";

    const skportLoginBtn = document.getElementById("btn-skport-login");
    if (skportLoginBtn) {
      const textEl = skportLoginBtn.querySelector(".skport-btn-text");
      if (textEl) textEl.textContent = isLive ? "✓ SKPORT Connected" : "Open SKPORT Sign-in";
      skportLoginBtn.disabled = !!isLive;
      skportLoginBtn.classList.toggle("dimmed-button", isLive);
      skportLoginBtn.classList.toggle("skport-connected", isLive);
    }

    const page1Stat = document.getElementById("page1-stat-skport-name");
    if (page1Stat) {
      page1Stat.innerText = statusLabel;
      page1Stat.setAttribute("data-state", isLive ? "success" : "warning");
    }

    const summaryStat = document.getElementById("stat-skport-name");
    if (summaryStat) {
      summaryStat.innerText = statusLabel;
      summaryStat.setAttribute("data-state", isLive ? "success" : "warning");
    }

    const dashStat = document.getElementById("dashboard-stat-skport-name");
    if (dashStat) {
      dashStat.innerText = statusLabel;
      dashStat.setAttribute("data-state", isLive ? "success" : "warning");
    }
  });
};

const checkCredentials = () => {
  chrome.storage.local.get(["cred", "skGameRole"], (data) => {
    const hasRole = data.skGameRole && data.skGameRole.length > 5;
    const hasCred = data.cred && data.cred !== "PENDING" && data.cred !== null;

    const statusEl = document.getElementById("status-text");
    const nextBtn = document.getElementById("skport-next-btn");

    if (hasRole && hasCred) {
      if (statusEl) {
        statusEl.innerText = "Connected";
        statusEl.style.color = "#4CAF50";
      }
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.className = "btn-action";
      }
      isCapturing = false;
    } else {
      if (statusEl) {
        statusEl.innerText = "Disconnected";
        statusEl.style.color = "#ffa500";
      }
      if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.className = "btn-secondary";
      }
      if (!isCapturing) {
        isCapturing = true;
        syncGameSession();
      }
    }
  });
};

// Periodic re-check of SKPORT connection (tab + cookie) and UI refresh on page 1 + summary
setInterval(syncGameSession, 4000);
// Also refresh button state from storage every 2s when popup is open
setInterval(updateSKPortLinkUI, 2000);
