// SKPORT integration: session capture, cookie/tab scripting, and UI sync
// Exports global functions used by popup.js: syncGameSession, updateSKPORTLinkUI, checkCredentials

let skportInitialized = false;
let skportWasLive = null;

function handleSkportFlow(isLive) {
  if (!skportInitialized) {
    skportWasLive = isLive;
    skportInitialized = true;
    // Already connected on first run (e.g. reinstall with persisted storage): still advance from p1
    if (
      isLive &&
      typeof currentSetupPage !== "undefined" &&
      currentSetupPage === "p1" &&
      typeof showPage === "function"
    ) {
      setTimeout(() => {
        if (currentSetupPage === "p1") showPage("pGoogle");
      }, 700);
    }
    return;
  }

  const justConnected = !skportWasLive && isLive;
  const justDisconnected = skportWasLive && !isLive;
  skportWasLive = isLive;

  if (
    justConnected &&
    typeof currentSetupPage !== "undefined" &&
    currentSetupPage === "p1" &&
    typeof showPage === "function"
  ) {
    setTimeout(() => {
      if (currentSetupPage === "p1") showPage("pGoogle");
    }, 700);
  } else if (
    justDisconnected &&
    typeof currentSetupPage !== "undefined" &&
    currentSetupPage !== "p1" &&
    typeof showPage === "function"
  ) {
    showPage("p1");
  }
}

const syncGameSession = async () => {
  const loginBtn = document.getElementById("btn-skport-login");
  const continueBtn = document.getElementById("skport-continue-btn");
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
    const connectBlock = loginBtn ? loginBtn.closest(".setup-connect-block") : null;
    const connectedState = document.getElementById("skport-connected-state");
    if (connectBlock) connectBlock.classList.toggle("hidden", !!isLive);
    if (connectedState) connectedState.classList.toggle("hidden", !isLive);
    if (loginBtn) {
      const textEl = loginBtn.querySelector(".skport-btn-text");
      if (textEl) textEl.textContent = "Sign in to SKPORT";
      loginBtn.disabled = false;
      loginBtn.classList.remove("dimmed-button", "skport-connected");
    }
    if (continueBtn) {
      const showContinue = typeof hasAdvancedPastStep1 !== "undefined" && hasAdvancedPastStep1;
      continueBtn.style.display = showContinue ? "" : "none";
      continueBtn.disabled = !isLive;
      continueBtn.style.opacity = isLive ? "1" : "0.45";
      continueBtn.classList.toggle("btn-action", isLive);
      const footer = continueBtn.closest(".setup-page-footer");
      if (footer) footer.style.display = showContinue ? "" : "none";
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

    handleSkportFlow(isLive);
  }
};

const updateSKPortLinkUI = () => {
  chrome.storage.local.get(["cred", "skGameRole"], (data) => {
    const isLive = !!data.cred && data.cred !== "PENDING" && !!(data.skGameRole && data.skGameRole.length > 5);
    const statusLabel = isLive ? "Connected" : "Disconnected";
    const statusColor = isLive ? "#22c55e" : "#ffa500";

    const skportLoginBtn = document.getElementById("btn-skport-login");
    const dashConnectBlock = skportLoginBtn ? skportLoginBtn.closest(".setup-connect-block") : null;
    const dashConnectedState = document.getElementById("skport-connected-state");
    if (dashConnectBlock) dashConnectBlock.classList.toggle("hidden", !!isLive);
    if (dashConnectedState) dashConnectedState.classList.toggle("hidden", !isLive);
    if (skportLoginBtn) {
      const textEl = skportLoginBtn.querySelector(".skport-btn-text");
      if (textEl) textEl.textContent = "Sign in to SKPORT";
      skportLoginBtn.disabled = false;
      skportLoginBtn.classList.remove("dimmed-button", "skport-connected");
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

    handleSkportFlow(isLive);
  });
};

const checkCredentials = () => {
  chrome.storage.local.get(["cred", "skGameRole"], (data) => {
    const hasRole = data.skGameRole && data.skGameRole.length > 5;
    const hasCred = data.cred && data.cred !== "PENDING" && data.cred !== null;

    const statusEl = document.getElementById("status-text");
    const continueBtn = document.getElementById("skport-continue-btn");

    if (hasRole && hasCred) {
      if (statusEl) {
        statusEl.innerText = "Connected";
        statusEl.style.color = "#4CAF50";
      }
      if (continueBtn) {
        continueBtn.disabled = false;
        continueBtn.classList.add("btn-action");
        continueBtn.style.opacity = "1";
      }
      handleSkportFlow(true);
      isCapturing = false;
    } else {
      if (statusEl) {
        statusEl.innerText = "Disconnected";
        statusEl.style.color = "#ffa500";
      }
      if (continueBtn) {
        continueBtn.disabled = true;
        continueBtn.classList.remove("btn-action");
        continueBtn.style.opacity = "0.45";
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
