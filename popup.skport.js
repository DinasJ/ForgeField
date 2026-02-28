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
          const cleanedRole = rawRole ? rawRole.replace(/::/g, '') : null;

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
      toggleDashboardControls(isDriveValid, isLive);
    }

    if (isLive) {
      if (statusText) { statusText.innerText = "Connected"; statusText.style.color = "#00ff00"; }
      if (loginBtn) {
        loginBtn.innerText = "✓ SKPORT Connected";
        loginBtn.disabled = true;
        loginBtn.classList.add("dimmed-button");
      }
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.style.opacity = "1";
        nextBtn.classList.add("btn-active");
      }
    } else {
      if (statusText) { statusText.innerText = "Disconnected"; statusText.style.color = "#ffa500"; }
      if (loginBtn) {
        loginBtn.innerText = "Open SKPort Sign-in";
        loginBtn.disabled = false;
        loginBtn.classList.remove("dimmed-button");
      }
      if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.style.opacity = "0.3";
        nextBtn.classList.remove("btn-active");
      }
    }
  }
};

const updateSKPortLinkUI = () => {
  chrome.storage.local.get(["cred"], (data) => {
    const skportLoginBtn = document.getElementById("btn-skport-login");
    const isLive = !!data.cred && data.cred !== "PENDING";

    if (skportLoginBtn) {
      if (isLive) {
        skportLoginBtn.innerText = "✓ SKPORT Connected";
        skportLoginBtn.disabled = true;
        skportLoginBtn.classList.add("dimmed-button");
      } else {
        skportLoginBtn.innerText = "Open SKPort Sign-in";
        skportLoginBtn.disabled = false;
        skportLoginBtn.classList.remove("dimmed-button");
      }
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

// Periodic UI refresh for SKPort link state
setInterval(updateSKPortLinkUI, 2000);
