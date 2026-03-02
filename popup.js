// --- 1. CONFIGURATION ---
const GOOGLE_CLIENT_ID =
  "117203639682-hb4fbbae75d5tbr92bivniste0b7t5g4.apps.googleusercontent.com";
const DISCORD_CLIENT_ID = "1476280881604984922";
if (typeof chrome === "undefined" || !chrome.extension) {
  window.chrome = window.browser;
}
const DEBUG = false; // set true for development / support
// --- 2. GLOBAL STATE ---
let page2SubStep = "ID";
let isCapturing = false;
let isDirty = false;

// --- 3. LIFECYCLE DEFINITION (Fixes ReferenceError) ---
// --- 3. UPDATED LIFECYCLE DEFINITION ---
const lifecycle = {
  p1: () => {
    if (DEBUG) console.log("LIFECYCLE: Step 1 Initializing...");
    syncGameSession(); // Force the UI to check connection status immediately
  },

  // Page 2: Google Account Linking (pGoogle)
  pGoogle: () => {
    if (DEBUG) console.log("LIFECYCLE: Entering Step 2 (Google)");
    if (typeof checkGoogleStatus === "function") {
      checkGoogleStatus();
    }
  },

  // Page 3: Setup summary (and redirect reason from boot/preflight)
  p3: () => {
    if (DEBUG) console.log("LIFECYCLE: Entering Step 3 (Discord)");
    if (typeof checkDiscordStatus === "function") checkDiscordStatus();
    if (typeof updateSummaryBox === "function") updateSummaryBox();
    // Show redirect reason from boot or preflight invalidation, then clear; when script missing, ensure deploy button is "Create Script"
    chrome.storage.local.get(["dashboardRedirectReason"], (data) => {
      const banner = document.getElementById("dashboard-redirect-reason");
      const reason = data.dashboardRedirectReason;
      if (banner) {
        if (reason) {
          banner.textContent = reason === "Authorization Required" ? "Authorization Required" : reason === "Automation Script Missing" ? "Automation Script Missing" : "Connection problem. Check your connection.";
          banner.classList.remove("hidden-success");
        } else {
          banner.textContent = "";
          banner.classList.add("hidden-success");
        }
      }
      if (reason === "Automation Script Missing" || reason === "Authorization Required") {
        const deployBtn = document.getElementById("deploy-btn");
        if (deployBtn) {
          deployBtn.innerText = "Create Script & Open Google Tab";
          deployBtn.dataset.action = "sync";
        }
      }
      chrome.storage.local.remove("dashboardRedirectReason");
    });
    // Restore Finish-in-Google panel if auth is still pending
    chrome.storage.local.get(["googleAuthPending", "savedScriptId"], (data) => {
      if (data.googleAuthPending) {
        const panel = document.getElementById("finish-in-google-panel");
        if (panel) panel.classList.remove("hidden-success");
        const scriptLink = document.getElementById("finish-open-script-drive");
        if (scriptLink && data.savedScriptId) {
          scriptLink.href = `https://script.google.com/home/projects/${data.savedScriptId}/edit`;
          scriptLink.classList.remove("hidden-success");
        }
      }
    });
  },

  // Page 4: Final Sub-view / Confirmation
  p2: () => {
    if (DEBUG) console.log("LIFECYCLE: Entering Final Setup");
    if (typeof updatePage2SubView === "function") {
      updatePage2SubView();
    }
  },

  // Dashboard: Main App View
  pDashboard: () => {
    if (DEBUG) console.log("LIFECYCLE: Entering Dashboard");
    if (typeof updateSKPortLinkUI === "function") updateSKPortLinkUI();
    if (typeof checkTokenHealth === "function") checkTokenHealth();
    chrome.storage.local.get(
      ["lastSyncTime", "googleToken", "discordId", "savedClaimTime"],
      (data) => {
        if (typeof updateDashboardTime === "function") {
          updateDashboardTime(data.lastSyncTime);
        }
        if (typeof updateDashboardAutomationUI === "function") {
          updateDashboardAutomationUI(data.savedClaimTime);
        }
      },
    );
  },
};

// --- 4. CORE UTILITIES ---

const handleExit = () => {
  if (isDirty) {
    const webhookVal = document.getElementById("webhook")?.value.trim();
    const nicknameVal = document
      .getElementById("account-nickname")
      ?.value.trim();

    const newData = {};
    if (webhookVal !== undefined) newData.webhookUrl = webhookVal;
    if (nicknameVal !== undefined) newData.accountNickname = nicknameVal;

    chrome.storage.local.set(newData, () => {
      // ... silent sync logic
    });

    isDirty = false;
  }
  showPage("pDashboard");
};
let lastKnownStatus = null; // Track the previous state globally

// Helper to keep code clean
const updateStatus = (textEl, btnEl, msg, color, disabled) => {
  if (textEl) {
    textEl.innerText = msg;
    textEl.style.color = color;
  }
  if (btnEl) {
    btnEl.disabled = disabled;
    btnEl.style.opacity = disabled ? "0.3" : "1";
    if (disabled) btnEl.classList.remove("btn-active");
    else btnEl.classList.add("btn-active");
  }
};

const UI_PAGES = {
  p1: "page-1",
  pGoogle: "page-google",
  p2: "page-2",
  p3: "page-3",
  pDashboard: "page-dashboard",
};

// Derive whether automation is fully active (script + web app + authorization)
const deriveAutomationState = (data) => {
  const hasWebApp = !!data.webAppUrl;
  const hasScript = !!data.savedScriptId;
  const authorized = data.googleWebAppAuthorized === true;
  return { automationActive: hasWebApp && hasScript && authorized };
};

// Short-lived preflight cache so "Open Dashboard" and in-popup navigation don't re-fetch every time
const PREFLIGHT_CACHE_MS = 45 * 1000; // 45 seconds
let lastPreflightOk = { url: null, at: 0 };

// Preflight: GET webAppUrl to verify script exists and (optionally) auth state
const preflightWebApp = async (webAppUrl) => {
  if (!webAppUrl) return { ok: false, error: "network" };
  if (lastPreflightOk.url === webAppUrl && (Date.now() - lastPreflightOk.at) < PREFLIGHT_CACHE_MS) {
    return { ok: true };
  }
  try {
    const res = await fetch(webAppUrl, { method: "GET", credentials: "omit" });
    if (res.status === 200) {
      lastPreflightOk = { url: webAppUrl, at: Date.now() };
      return { ok: true };
    }
    return { ok: false, status: res.status };
  } catch (e) {
    if (DEBUG) console.warn("preflightWebApp error:", e);
    return { ok: false, error: "network" };
  }
};

// Handle preflight result: on 404/410 clear script state; on 401/403 optionally allow (e.g. open auth tab)
const handlePreflightResult = (result, onSuccess, opts = {}) => {
  const allowAuthTab = !!opts.allowAuthTab;
  if (result.ok) {
    onSuccess();
    return;
  }
  lastPreflightOk = { url: null, at: 0 }; // invalidate cache on any failure
  if (result.status === 404 || result.status === 410) {
    chrome.storage.local.remove(["webAppUrl", "savedScriptId", "lastSyncedSnapshot"], () => {
      chrome.storage.local.set({ dashboardRedirectReason: "Automation Script Missing" }, () => {
        showPage("p3");
      });
    });
    return;
  }
  if (result.status === 401 || result.status === 403) {
    if (allowAuthTab) {
      onSuccess();
      return;
    }
    chrome.storage.local.set({ googleWebAppAuthorized: false, dashboardRedirectReason: "Authorization Required" }, () => {
      showPage("p3");
    });
    return;
  }
  // network or other error — non-destructive warning, route to Setup
  chrome.storage.local.set({ dashboardRedirectReason: "Connection problem" }, () => {
    showPage("p3");
  });
  alert("Can't verify the automation script right now. Check your connection and try again.");
};

// Internal: apply page display (progress, hide/show, lifecycle, persist). Used by showPage.
const applyPageDisplay = (id) => {
  const targetId = UI_PAGES[id] || id;
  const targetElement = document.getElementById(targetId);
  if (!targetElement) return;

  const progressContainer = document.querySelector(".progress-container");
  const progressFill = document.getElementById("progress-fill");
  const progressPercent = document.getElementById("progress-percent");
  const progressLabel = document.getElementById("progress-label");
  const isDashboard = targetId === "page-dashboard";

  if (progressContainer) {
    progressContainer.style.display = isDashboard ? "none" : "block";
    const progressMap = {
      p1: { pct: "25%", text: "Step 1 of 4 • SKPORT" },
      pGoogle: { pct: "50%", text: "Step 2 of 4 • Google" },
      p2: { pct: "75%", text: "Step 3 of 4 • Connect Discord" },
      p3: { pct: "100%", text: "Setup Complete" },
    };
    if (progressMap[id]) {
      progressFill.style.width = progressMap[id].pct;
      progressPercent.innerText = progressMap[id].pct;
      progressLabel.innerText = progressMap[id].text;
    }
    progressContainer.classList.toggle("progress-complete", id === "p3");
  }

  document.querySelectorAll(".setup-page, .page").forEach((p) => {
    p.style.display = "none";
  });
  targetElement.style.display = "flex";
  syncGameSession();
  if (lifecycle[id]) lifecycle[id]();
  chrome.storage.local.set({ lastPage: id });
};

const showPage = (id) => {
  if (id === "pDashboard") {
    chrome.storage.local.get(["webAppUrl", "savedScriptId", "googleWebAppAuthorized"], async (data) => {
      if (!deriveAutomationState(data).automationActive) {
        showPage("p3");
        return;
      }
      const result = await preflightWebApp(data.webAppUrl);
      handlePreflightResult(result, () => applyPageDisplay("pDashboard"), {});
    });
    return;
  }
  applyPageDisplay(id);
};

// Helper: go to dashboard only when automation is active; otherwise send user to Setup (p3)
const goToDashboardIfActive = () => {
  chrome.storage.local.get(["webAppUrl", "savedScriptId", "googleWebAppAuthorized"], (data) => {
    const { automationActive } = deriveAutomationState(data);
    if (automationActive) {
      showPage("pDashboard");
    } else {
      showPage("p3");
    }
  });
};

// --- 5. INITIALIZATION ---

document.addEventListener("DOMContentLoaded", () => {
  // Deterministic boot: do NOT render lastPage immediately. Loading shell is shown via .boot-state in CSS.
  const container = document.querySelector(".container");
  const progressContainer = document.querySelector(".progress-container");

  const reveal = (pageId) => {
    if (container) container.classList.remove("boot-state");
    if (progressContainer) progressContainer.style.display = pageId === "pDashboard" ? "none" : "block";
  };

  chrome.storage.local.get(
    ["lastPage", "setupComplete", "webAppUrl", "savedScriptId", "googleWebAppAuthorized"],
    (data) => {
      const { automationActive } = deriveAutomationState(data);

      if (automationActive) {
        // Optimistic: show dashboard immediately; verify in background and redirect only if preflight fails
        applyPageDisplay("pDashboard");
        reveal("pDashboard");
        preflightWebApp(data.webAppUrl).then((result) => {
          if (!result.ok) {
            handlePreflightResult(result, () => {}, {});
            reveal("p3");
          }
        });
        return;
      }

      const pageToLoad = data.lastPage || (data.setupComplete ? "pDashboard" : "p1");
      const safePage = pageToLoad === "pDashboard" ? "p3" : pageToLoad;
      if (DEBUG) console.log("Restoring session to:", safePage);
      showPage(safePage);
      reveal(safePage);
    },
  );

  // 1. Initial UI References
  const discordIdInput = document.getElementById("discordId");
  const webhookInput = document.getElementById("webhook");
  const nickInput = document.getElementById("account-nickname");
  const toggle = document.getElementById("discord-toggle");
  const btnDone = document.getElementById("btn-done");
  const claimOnceBtn = document.getElementById("btn-run-test");
  const enableAutoBtn = document.getElementById("btn-save-automation");

  // 2. Initial UI Setup & State Recovery
  chrome.storage.local.get(
    [
      "savedScriptId",
      "lastPage",
      "discordId",
      "webhookUrl",
      "accountNickname",
      "notifyEnabled",
      "googleToken",
    ],
    (data) => {
      // Populate fields from storage
      if (data.discordId && discordIdInput)
        discordIdInput.value = data.discordId;
      if (data.webhookUrl && webhookInput) webhookInput.value = data.webhookUrl;
      if (data.accountNickname && nickInput)
        nickInput.value = data.accountNickname;

      if (toggle) {
        toggle.checked = data.notifyEnabled !== false;
        toggle.onchange = () => {
          chrome.storage.local.set({ notifyEnabled: toggle.checked });
          if (typeof updatePage2SubView === "function") updatePage2SubView();
        };
      }

      // Rename buttons to "Confirm" immediately on load
      document
        .querySelectorAll(".btn-exit-settings, #btn-done")
        .forEach((btn) => {
          btn.innerText = "Confirm";
        });

      // Trigger initial health and session checks
      if (typeof syncGameSession === "function") syncGameSession();
      if (typeof checkTokenHealth === "function") checkTokenHealth();
      if (typeof updatePage2SubView === "function") updatePage2SubView();
    },
  );

  // 3. Global Input Change Logic (Rename & Unlock)
  document.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("input", () => {
      isDirty = true;
      document
        .querySelectorAll(".btn-exit-settings, #btn-done")
        .forEach((btn) => {
          btn.innerText = "Confirm";
          btn.removeAttribute("disabled");
          btn.disabled = false;
          btn.style.opacity = "1";
          btn.classList.add("btn-active");
        });
    });
  });

  // 4. Navigation Listeners
  const btnRedeploy = document.getElementById("btn-redeploy");
  if (btnRedeploy) {
    btnRedeploy.onclick = () => {
      // Switch to the first setup page to "re-do" the process
      showPage("p1"); 
      // Log it so we can verify in the console
      if (DEBUG) console.log("Navigating to Setup/Redeploy (p1)");
    };
  }

  const skportNext = document.getElementById("skport-next-btn");
  if (skportNext) {
    skportNext.onclick = () => {
      if (!skportNext.disabled) showPage("pGoogle");
    };
  }
  

  const googleNext = document.getElementById("google-next-btn");
  if (googleNext) {
    googleNext.onclick = () => showPage("p2");
  }

  const backTo1 = document.getElementById("back-to-1-from-google");
  if (backTo1) {
    backTo1.onclick = () => showPage("p1");
  }

  if (btnDone) {
    btnDone.onclick = () => goToDashboardIfActive();
  }
// --- NEW: Navigation for Page 4 (Final Deploy) back to Page 3 ---
const backToDiscord = document.getElementById("back-from-3");
if (backToDiscord) {
  backToDiscord.onclick = () => showPage("p2");
}

  // 5. Action Handlers (Google, Discord, Automation)
  const googleAuth = document.getElementById("google-auth-btn");
  if (googleAuth) {
    googleAuth.onclick = () => {
      if (typeof handleGoogleAuth === "function") handleGoogleAuth();
    };
  }

  const discordBtn = document.getElementById("discord-auth-btn");
  if (discordBtn) {
    discordBtn.onclick = () => {
      if (typeof handleDiscordAuth === "function") handleDiscordAuth();
    };
  }

  if (enableAutoBtn) {
    enableAutoBtn.addEventListener("click", async () => {
      const timeInput = document.getElementById("claim-time").value;
      const statusEl = document.getElementById("automation-status");
      const scheduleEl = document.getElementById("automation-schedule-text");
      enableAutoBtn.disabled = true;
      if (statusEl) statusEl.innerText = "Connecting to Google...";

      try {
        const data = await chrome.storage.local.get([
          "webAppUrl",
          "cred",
          "skGameRole",
          "webhookUrl",
          "accountNickname",
        ]);
        if (!data.webAppUrl) {
          if (statusEl) { statusEl.innerText = "No Web App URL"; statusEl.style.color = "#e57373"; }
          return;
        }

        const result = await preflightWebApp(data.webAppUrl);
        handlePreflightResult(
          result,
          async () => {
            const selectedHour = parseInt(timeInput.split(":")[0]);
            const payload = {
              action: "SCHEDULE",
              scheduledHour: selectedHour,
              profiles: [
                {
                  cred: data.cred,
                  skGameRole: normalizeSkGameRole(data.skGameRole),
                  accountNickname: data.accountNickname || "Endmin",
                  platform: "3",
                },
              ],
              discordWebhook: data.webhookUrl,
              discord_notify: true,
            };
            await fetch(data.webAppUrl, {
              method: "POST",
              mode: "no-cors",
              headers: { "Content-Type": "text/plain" },
              body: JSON.stringify(payload),
            });
            await chrome.storage.local.set({ savedClaimTime: timeInput });
            if (scheduleEl) scheduleEl.textContent = `Runs daily at ${timeInput}`;
            if (statusEl) { statusEl.innerText = ""; statusEl.style.color = ""; }
            enableAutoBtn.textContent = "Enabled";
            enableAutoBtn.classList.add("is-enabled");
          },
          {},
        );
      } catch (err) {
        if (statusEl) {
          statusEl.innerText = "Failed to schedule.";
          statusEl.style.color = "#e57373";
        }
      } finally {
        enableAutoBtn.disabled = false;
      }
    });
  }

  // 6. Page 2 Navigation (Sub-step logic)
  const nextFrom2 = document.getElementById("next-from-2");
  if (nextFrom2) {
    nextFrom2.onclick = () => {
      const isNotifyEnabled = toggle ? toggle.checked : false;
      if (isNotifyEnabled && page2SubStep === "ID") {
        const idField = document.getElementById("discordId");
        const manualId = idField ? idField.value.trim() : "";
        if (/^\d{17,20}$/.test(manualId)) chrome.storage.local.set({ discordId: manualId });
        page2SubStep = "WEBHOOK";
        if (typeof updatePage2SubView === "function") updatePage2SubView();
      } else {
        if (page2SubStep === "WEBHOOK") {
          const webhookField = document.getElementById("webhook");
          const nicknameField = document.getElementById("accountNickname");
          const webhookVal = webhookField ? webhookField.value.trim() : "";
          const nicknameVal = nicknameField ? nicknameField.value.trim() : "";
          if (webhookVal) chrome.storage.local.set({ webhookUrl: webhookVal, notifyEnabled: true, accountNickname: nicknameVal || undefined });
        }
        showPage("p3");
      }
    };
  }

  const backFrom2 = document.getElementById("back-from-2");
  if (backFrom2) {
    backFrom2.onclick = () => {
      if (page2SubStep === "WEBHOOK" && toggle && toggle.checked) {
        page2SubStep = "ID";
        if (typeof updatePage2SubView === "function") updatePage2SubView();
      } else {
        showPage("pGoogle");
      }
    };
  }

  // Wire Google sign-out link
  const googleSignoutLink = document.getElementById("google-signout-link");
  if (googleSignoutLink) {
    googleSignoutLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof handleGoogleSignOut === "function") handleGoogleSignOut();
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "SESSION_CLEARED") {
      // Refresh the UI to show disconnected
      syncGameSession(); 
    }
  });
});

// ==========================================
// 1. ACTION HANDLERS
// ==========================================

document.getElementById("btn-skport-login").addEventListener("click", () => {
  const btn = document.getElementById("btn-skport-login");
  if (!btn.disabled) {
    chrome.tabs.create({ url: "https://game.skport.com/endfield/sign-in" });
}});

const btnOpenScript = document.getElementById("btn-open-script");
if (btnOpenScript) {
  btnOpenScript.addEventListener("click", () => {
    chrome.storage.local.get(["webAppUrl", "savedScriptId"], async (data) => {
      const scriptId = data.savedScriptId;
      if (!scriptId) {
        alert("Sync to Google Drive first to create the script. Use the setup flow to deploy.");
        return;
      }
      const result = await preflightWebApp(data.webAppUrl);
      handlePreflightResult(result, () => {
        const url = `https://script.google.com/home/projects/${scriptId}/edit`;
        chrome.tabs.create({ url });
      }, {});
    });
  });
}

// Listener kept for backwards compatibility; background no longer auto-sets auth on close
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "GOOGLE_ACCESS_GRANTED" && typeof checkTokenHealth === "function") {
    checkTokenHealth();
  }
});

document.getElementById("btn-run-test").addEventListener("click", async () => {
  const testBtn = document.getElementById("btn-run-test");
  if (DEBUG) console.log("DEBUG: Auto-claim Once (POST to web app)");
  testBtn.innerText = "Testing...";
  testBtn.disabled = true;

  const resetBtn = () => {
    setTimeout(() => {
      testBtn.innerText = "Auto-claim Once";
      testBtn.disabled = false;
    }, 3000);
  };

  try {
    const data = await new Promise((resolve) => {
      chrome.storage.local.get(
        [
          "webAppUrl",
          "cred",
          "skGameRole",
          "webhookUrl",
          "notifyEnabled",
          "discordId",
          "accountNickname",
        ],
        resolve,
      );
    });

    if (!data.webAppUrl) {
      throw new Error("No Web App URL. Please sync to Google Drive first.");
    }

    const result = await preflightWebApp(data.webAppUrl);
    handlePreflightResult(
      result,
      async () => {
        const payload = {
          profiles: [
            {
              cred: data.cred,
              skGameRole: normalizeSkGameRole(data.skGameRole),
              platform: "3",
              vName: "1.0.0",
              accountNickname: data.accountNickname || "Endmin",
            },
          ],
          discord_notify: data.notifyEnabled,
          discordWebhook: data.webhookUrl,
          myDiscordID: data.discordId,
          USER_LOCALE: "en-US",
          USER_TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone,
          PREFER_24H: true,
        };
        await fetch(data.webAppUrl, {
          method: "POST",
          mode: "no-cors",
          cache: "no-cache",
          credentials: "omit",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify(payload),
        });
        testBtn.innerText = "Success! ✅";
      },
      {},
    );
  } catch (err) {
    if (DEBUG) console.error("DEBUG: CRITICAL ERROR:", err.message);
    chrome.storage.local.remove("googleWebAppAuthorized", () => {
      if (typeof checkTokenHealth === "function") checkTokenHealth();
    });
    alert(err.message);
    testBtn.innerText = "Failed ❌";
  } finally {
    resetBtn();
  }
});

// Finish-in-Google panel handlers (gated by preflight)
const finishTakeMe = document.getElementById("finish-take-me-to-google");
const finishIveCompleted = document.getElementById("finish-ive-completed");
if (finishTakeMe) {
  finishTakeMe.onclick = () => {
    chrome.storage.local.get(["pendingAuthUrl"], async (data) => {
      const url = data.pendingAuthUrl;
      if (!url) return;
      const result = await preflightWebApp(url);
      handlePreflightResult(result, () => chrome.tabs.create({ url }), { allowAuthTab: true });
    });
  };
}
if (finishIveCompleted) {
  finishIveCompleted.onclick = () => {
    chrome.storage.local.get(["webAppUrl", "pendingAuthUrl"], async (data) => {
      const url = data.pendingAuthUrl || data.webAppUrl;
      if (!url) return;
      const result = await preflightWebApp(url);
      handlePreflightResult(result, () => {
        chrome.storage.local.set(
          { googleWebAppAuthorized: true, googleAuthPending: false },
          () => goToDashboardIfActive(),
        );
      }, {});
    });
  };
}

// ==========================================
// 1. AUTHENTICATION & SIGN OUT
// ==========================================

const handleGoogleSignOut = () => {
  // We don't use removeCachedAuthToken in Firefox/Universal flow
  // as we manage the token manually in storage.
  const keysToRemove = ["googleToken", "savedScriptId", "lastSyncTime", "googleWebAppAuthorized"];

  chrome.storage.local.remove(keysToRemove, () => {
    if (DEBUG) console.log("DEBUG: Signed out from Google.");

    // Update all UI components immediately
    checkGoogleStatus();
    updateStatusUI(false);

    // Optional: Only reload if you need to reset the entire popup state
    // location.reload();

    alert("Signed out successfully.");
  });
};

// ==========================================
// 2. STATUS UI HELPERS
// ==========================================

const toggleDashboardControls = (isDriveValid, isSkportValid, hasWebApp, hasAuthorizedWebApp) => {
  const claimOnceBtn = document.getElementById("btn-run-test"); // Your "Auto-Claim Once" ID
  const enableAutoBtn = document.getElementById("btn-save-automation"); // Your "Enable" ID

  // Auto-claim and Daily require Google Access to be granted first (flag set when user closes the permission tab)
  const canOperate = isDriveValid && isSkportValid && !!hasWebApp && !!hasAuthorizedWebApp;

  [claimOnceBtn, enableAutoBtn].forEach((btn) => {
    if (btn) {
      btn.disabled = !canOperate;
      btn.style.opacity = canOperate ? "1" : "0.3";
      btn.style.cursor = canOperate ? "pointer" : "not-allowed";

      // If disabled, remove the bright yellow styling
      if (!canOperate) {
        btn.classList.remove("btn-active");
      } else {
        btn.classList.add("btn-active");
      }
    }
  });
};

const updateStatusUI = (isValid) => {
  const text = document.getElementById("token-status-text");
  if (text) {
    text.innerText = isValid ? "Cloud Active" : "Token Expired / Missing";
    text.setAttribute("data-state", isValid ? "success" : "warning");
  }
};

// `updateSKPORTLinkUI` moved to popup.skport.js

const checkTokenHealth = async () => {
  chrome.storage.local.get(
    ["googleToken", "savedScriptId", "cred", "skGameRole", "webAppUrl", "googleWebAppAuthorized"],
    async (data) => {
      let isDriveValid = false;

      // 1. Check Google Drive Health
      if (!data.googleToken) {
        updateStatusUI(false);
        isDriveValid = false;
      } else {
        try {
          const resp = await fetch(
            `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${data.googleToken}`,
          );
          if (resp.status === 400) {
            if (DEBUG) console.warn("Token is invalid or expired. Cleaning up...");
            chrome.storage.local.remove("googleToken", () => {
              if (typeof checkGoogleStatus === "function") checkGoogleStatus();
            });
            updateStatusUI(false);
            isDriveValid = false;
          } else {
            isDriveValid = resp.ok;
            updateStatusUI(resp.ok);
          }
        } catch (err) {
          if (DEBUG) console.error("Health check network error:", err);
          // On network error, assume previous state or false to be safe
        }
      }

      // 2. Check SKPORT Health
      const isSkportValid = !!(data.cred && data.skGameRole);

      // 3. Web app URL + user has completed Google Access
      const hasWebApp = !!data.webAppUrl;
      const hasAuthorizedWebApp = !!data.googleWebAppAuthorized;
      const { automationActive } = deriveAutomationState(data);

      // If dashboard is visible but automation is no longer active, send user back to Setup
      const dashboardEl = document.getElementById("page-dashboard");
      if (dashboardEl && dashboardEl.style.display !== "none" && !automationActive) {
        showPage("p3");
        return;
      }

      // 4. Update Dashboard Button States — all required; Auto-claim and Daily stay disabled until access is granted
      const canOperate = isDriveValid && isSkportValid && hasWebApp && hasAuthorizedWebApp;

      const claimOnceBtn = document.getElementById("btn-run-test");
      const enableAutoBtn = document.getElementById("btn-save-automation");

      [claimOnceBtn, enableAutoBtn].forEach((btn) => {
        if (btn) {
          btn.disabled = !canOperate;
          btn.style.opacity = canOperate ? "1" : "0.3";
          btn.style.cursor = canOperate ? "pointer" : "not-allowed";

          if (canOperate) {
            btn.classList.add("btn-active");
          } else {
            btn.classList.remove("btn-active");
          }
        }
      });

      const viewScriptBtn = document.getElementById("btn-open-script");
      if (viewScriptBtn) {
        const hasScript = !!data.savedScriptId;
        viewScriptBtn.disabled = !hasScript;
        viewScriptBtn.style.opacity = hasScript ? "1" : "0.3";
        viewScriptBtn.style.cursor = hasScript ? "pointer" : "not-allowed";
      }
    },
  );
};

const checkGoogleStatus = () => {
  chrome.storage.local.get(["googleToken"], (data) => {
    const connectedBlock = document.getElementById("google-connected-block");
    const connectWrap = document.getElementById("google-connect-wrap");
    const next = document.getElementById("google-next-btn");
    const pill = document.getElementById("page-google-stat");

    if (data.googleToken) {
      if (connectedBlock) connectedBlock.classList.remove("hidden");
      if (connectWrap) connectWrap.classList.add("hidden");
      if (next) {
        next.disabled = false;
        next.classList.add("btn-action");
        next.classList.remove("btn-secondary");
      }
      if (pill) {
        pill.textContent = "Connected";
        pill.setAttribute("data-state", "success");
      }
      if (typeof checkTokenHealth === "function") checkTokenHealth();
    } else {
      if (connectedBlock) connectedBlock.classList.add("hidden");
      if (connectWrap) connectWrap.classList.remove("hidden");
      if (next) {
        next.disabled = true;
        next.classList.add("btn-secondary");
        next.classList.remove("btn-action");
      }
      if (pill) {
        pill.textContent = "Not connected";
        pill.setAttribute("data-state", "warning");
      }
      if (typeof updateStatusUI === "function") updateStatusUI(false);
    }
  });
};
// ==========================================
// 3. UTILITY FUNCTIONS
// ==========================================

const formatTimeSince = (timestamp) => {
  if (!timestamp) return "Never";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
};

const updateDashboardTime = (timestamp) => {
  const timeEl = document.getElementById("last-sync-time");
  if (timeEl) timeEl.innerText = formatTimeSince(timestamp);
};

const updateDashboardAutomationUI = (savedClaimTime) => {
  const scheduleEl = document.getElementById("automation-schedule-text");
  const btn = document.getElementById("btn-save-automation");
  const timeInput = document.getElementById("claim-time");
  const time = savedClaimTime || (timeInput ? timeInput.value : "18:00");
  if (scheduleEl) scheduleEl.textContent = `Runs daily at ${time}`;
  if (btn) {
    if (savedClaimTime) {
      btn.textContent = "Enabled";
      btn.classList.add("is-enabled");
    } else {
      btn.textContent = "Enable";
      btn.classList.remove("is-enabled");
    }
  }
};

function setViewMode(mode) {
  const deployControls = document.getElementById("deploy-controls");
  const successMessage = document.getElementById("success-message");
  const deployBtn = document.getElementById("deploy-btn");

  if (mode === "settings") {
    if (deployControls) deployControls.style.display = "flex";
    if (successMessage) successMessage.classList.add("hidden-success");
    if (deployBtn) {
      deployBtn.innerText = "Update";
      deployBtn.className = "btn-dashboard-primary setup-footer-primary";
      deployBtn.dataset.action = "sync";
    }
  } else {
    if (deployControls) deployControls.style.display = "flex";
    if (successMessage) successMessage.classList.remove("hidden-success");
    if (deployBtn) {
      deployBtn.innerText = "Open Dashboard";
      deployBtn.className = "btn-dashboard-primary setup-footer-primary";
      deployBtn.dataset.action = "dashboard";
    }
  }
}

// ==========================================
// 4. INTERVAL REFRESHERS
// ==========================================

setInterval(checkTokenHealth, 30000);
const updateProgressBar = (manualId = null, manualWebhook = null) => {
  chrome.storage.local.get(
    ["skGameRole", "googleToken", "notifyEnabled", "discordId", "webhookUrl"],
    (data) => {
      let progress = 0;
      // Priority: Manual Input > Storage > Empty String
      const currentId = manualId !== null ? manualId : data.discordId || "";
      const currentWebhook =
        manualWebhook !== null ? manualWebhook : data.webhookUrl || "";

      // 1. Session & Google (50%)
      if (data.skGameRole) progress += 25;
      if (data.googleToken) progress += 25;

      // 2. Discord Configuration (50%)
      if (data.notifyEnabled === false) {
        // If notifications are off, they get full progress for this section
        progress += 50;
      } else {
        const hasValidId = /^\d{17,20}$/.test(currentId);
        const hasValidWebhook = currentWebhook.startsWith(
          "https://discord.com/api/webhooks/",
        );

        if (hasValidId) progress += 25;
        if (hasValidWebhook) progress += 25;
      }

      // --- Update DOM ---
      const fill = document.getElementById("progress-fill");
      const perc = document.getElementById("progress-percent");
      const label = document.getElementById("progress-label");

      if (fill) fill.style.width = progress + "%";
      if (perc) perc.innerText = progress + "%";
      if (label) {
        if (progress === 100) label.innerText = "Ready to Deploy";
        else if (progress > 0) label.innerText = "Configuring...";
        else label.innerText = "Initializing";
      }
    },
  );
};

const SUMMARY_SNAPSHOT_KEYS = ["webhookUrl", "accountNickname", "notifyEnabled", "discordId", "cred", "skGameRole"];

/** Ensure skGameRole is in API format 3_######_3 (fix old stored value or bare number). */
const normalizeSkGameRole = (val) => {
  if (!val || typeof val !== "string") return val;
  const s = val.trim();
  if (/^3_\d+_3$/.test(s)) return s;
  if (/^\d+$/.test(s)) {
    if (s.length >= 2 && s[0] === "3" && s[s.length - 1] === "3") return "3_" + s.slice(1, -1) + "_3";
    return "3_" + s + "_3";
  }
  return s;
};

const getSummarySnapshot = (data) => {
  const s = {};
  SUMMARY_SNAPSHOT_KEYS.forEach((k) => {
    let v = data[k];
    if (k === "accountNickname") v = v || "";
    if (k === "notifyEnabled") v = !!v;
    if (k === "webhookUrl" || k === "discordId" || k === "cred" || k === "skGameRole") v = v || "";
    s[k] = v;
  });
  return JSON.stringify(s);
};

const updateSummaryBox = (manualId = null) => {
  chrome.storage.local.get(
    [
      "skGameRole",
      "cred",
      "googleToken",
      "discordUsername",
      "discordId",
      "notifyEnabled",
      "accountNickname",
      "webhookUrl",
      "webAppUrl",
      "savedScriptId",
      "lastSyncedSnapshot",
      "googleWebAppAuthorized",
    ],
    (data) => {
      const skEl = document.getElementById("stat-skport-name");
      const googleEl = document.getElementById("stat-google-name");
      const dsEl = document.getElementById("stat-discord-id");
      const niEl = document.getElementById("stat-nickname");
      const deployBtn = document.getElementById("deploy-btn");

      const isSkportReady = data.skGameRole && data.cred && data.cred !== "PENDING";
      const isGoogleReady = !!data.googleToken;
      const discordDisabled = data.notifyEnabled === false;
      const currentId = manualId !== null ? manualId : data.discordId || "";
      const hasDiscordId = currentId.length > 5 || data.discordUsername;

      // 1. SKPORT Connection (status-pill)
      if (skEl) {
        skEl.innerText = isSkportReady ? "Connected" : "Disconnected";
        skEl.setAttribute("data-state", isSkportReady ? "success" : "warning");
      }

      // 2. Google Drive (status-pill): "Connected" for consistency with SKPORT
      if (googleEl) {
        googleEl.innerText = isGoogleReady ? "Connected" : "Disconnected";
        googleEl.setAttribute("data-state", isGoogleReady ? "success" : "warning");
      }

      // 3. Discord Notifications (status-pill)
      if (dsEl) {
        if (discordDisabled) {
          dsEl.innerText = "Disabled";
          dsEl.setAttribute("data-state", "loading");
        } else {
          dsEl.innerText = hasDiscordId ? "Enabled" : "Not set";
          dsEl.setAttribute("data-state", hasDiscordId ? "success" : "warning");
        }
      }

      // 4. In-game username (muted text)
      if (niEl) {
        niEl.innerText = data.accountNickname || "—";
      }

      // 5. Deploy button: show "Create Script & Open Google Tab" when script missing, or when not authorized (so user can re-authorize); else "Open Dashboard" when unchanged
      if (deployBtn) {
        deployBtn.disabled = false;
        deployBtn.style.background = "";
        deployBtn.style.color = "";
        const scriptMissing = !data.savedScriptId || !data.webAppUrl;
        const needsAuthOrCreate = scriptMissing || data.googleWebAppAuthorized !== true;
        if (needsAuthOrCreate) {
          deployBtn.innerText = "Create Script & Open Google Tab";
          deployBtn.className = "btn-dashboard-primary setup-footer-primary";
          deployBtn.dataset.action = "sync";
        } else {
          const currentSnapshot = getSummarySnapshot(data);
          const unchanged = data.lastSyncedSnapshot && data.lastSyncedSnapshot === currentSnapshot;
          if (unchanged) {
            deployBtn.innerText = "Open Dashboard";
            deployBtn.className = "btn-dashboard-primary setup-footer-primary";
            deployBtn.dataset.action = "dashboard";
          } else {
            deployBtn.innerText = "Update";
            deployBtn.className = "btn-dashboard-primary setup-footer-primary";
            deployBtn.dataset.action = "sync";
          }
        }
      }
    },
  );
};

// `checkCredentials` moved to popup.skport.js

// --- Input Event Listeners ---
document.querySelectorAll("input").forEach((input) => {
  input.addEventListener("input", () => {
    // Using 'input' instead of 'change' for real-time feedback
    isDirty = true;
    const exitBtn = document.getElementById("btn-exit-settings");
    if (exitBtn) exitBtn.innerText = "CONFIRM";
  });
});

// --- 7. AUTH & DEPLOYMENT HANDLERS ---

const handleGoogleAuth = () => {
  if (DEBUG) console.log("DEBUG: Telling background to handle auth...");

  chrome.runtime.sendMessage({ action: "AUTH_GOOGLE" }, (response) => {
    // Check for extension system errors (like the background script being asleep)
    if (chrome.runtime.lastError) {
      if (DEBUG) console.error("DEBUG: Connection Error:", chrome.runtime.lastError.message);
      return;
    }

    if (response?.status === "success") {
      if (DEBUG) console.log("DEBUG: Auth succeeded!");
      checkGoogleStatus();
    } else {
      if (DEBUG) console.error("DEBUG: Auth failed:", response?.message);
    }
  });
};
function checkDiscordStatus() {
  chrome.storage.local.get(["discordId", "discordUsername"], (data) => {
    if (typeof updatePage2SubView === "function") updatePage2SubView();
    if (data.discordId && typeof validateDiscordId === "function") validateDiscordId(data.discordId);
  });
}

const handleDiscordAuth = () => {
  if (DEBUG) console.log("DEBUG: Telling background to handle Discord auth...");

  chrome.runtime.sendMessage({ action: "AUTH_DISCORD" }, (response) => {
    if (chrome.runtime.lastError) {
      if (DEBUG) console.error("DEBUG: Discord Connection Error:", chrome.runtime.lastError.message);
      return;
    }

    if (response?.status === "success") {
      if (DEBUG) console.log("DEBUG: Discord Auth succeeded!");
      checkDiscordStatus();
    } else {
      if (DEBUG) console.error("DEBUG: Discord Auth failed:", response?.message);
    }
  });
};
const enableConfirmButton = () => {
  const confirmBtn =
    document.getElementById("btn-done") ||
    document.querySelector(".btn-exit-settings");

  chrome.storage.local.get(["cred", "skGameRole"], (data) => {
    if (data.cred && data.skGameRole && confirmBtn) {
      confirmBtn.removeAttribute("disabled");
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = "1";
      confirmBtn.style.cursor = "pointer";
      confirmBtn.classList.add("btn-active"); // Makes it yellow/highlighted
    }
  });
};

// Call this at the end of your DOMContentLoaded
enableConfirmButton();


async function runTestScript() {
  const testBtn = document.getElementById("btn-run-test");
  if (testBtn) {
    testBtn.disabled = true;
    testBtn.innerText = "TESTING...";
  }

  chrome.storage.local.get(
    [
      "webAppUrl",
      "cred",
      "skGameRole",
      "webhookUrl",
      "notifyEnabled",
      "discordId",
      "accountNickname",
    ],
    async (data) => {
      if (!data.webAppUrl) {
        alert("Please click 'SYNC TO DRIVE' first.");
        if (testBtn) testBtn.disabled = false;
        return;
      }

      try {
        // IMPORTANT: mode: "no-cors" is mandatory for Google Script redirects in Extensions
        await fetch(data.webAppUrl, {
          method: "POST",
          // Try removing mode: "no-cors" to allow the JSON header
          headers: {
            "Content-Type": "text/plain;charset=utf-8", // Google Scripts often prefer this
          },
          body: JSON.stringify({
            action: "TEST",
            profiles: [
              {
                cred: data.cred,
                skGameRole: normalizeSkGameRole(data.skGameRole),
                platform: "3",
                vName: "1.0.0",
                accountNickname: data.accountNickname || "Endmin",
              },
            ],
            discord_notify: data.notifyEnabled,
            discordWebhook: data.webhookUrl,
            myDiscordID: data.discordId,
          }),
        });

        alert(
          "Test signal sent! If nothing appears in Discord, check your Webhook URL.",
        );
      } catch (error) {
        if (DEBUG) console.error("Test Error:", error);
        alert("Failed to connect to Google Script.");
      } finally {
        if (testBtn) {
          testBtn.disabled = false;
          testBtn.innerText = "SEND TEST DATA";
        }
      }
    },
  );
}
// Helper function to fetch the Script ID from storage
async function getSavedScriptId() {
  return new Promise((resolve, reject) => {
    // We use 'savedScriptId' here to match your deployment code
    chrome.storage.local.get(["savedScriptId"], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (!result.savedScriptId) {
        reject(new Error("Script ID not found in storage."));
      } else {
        resolve(result.savedScriptId);
      }
    });
  });
}

// Discord helpers moved to popup.discord.js

async function handleDeploymentFlow() {
  const deployBtn = document.getElementById("deploy-btn");
  if (!deployBtn) return;

  // 1. Initial UI Feedback
  const originalText = deployBtn.innerText;
  deployBtn.disabled = true;
  deployBtn.innerHTML = '<span class="spinner"></span> <span>SYNCING...</span>';

  chrome.storage.local.get(null, async (data) => {
    try {
      // 2. Validation: Ensure we have the basics before bothering Google
      if (!data.cred || data.cred === "PENDING" || !data.skGameRole) {
        throw new Error(
          "Game session not found. Please go back to Step 1 and log in.",
        );
      }

      if (data.notifyEnabled !== false && !data.webhookUrl) {
        throw new Error(
          "Discord Notifications are enabled but no Webhook URL was provided.",
        );
      }

      // 3. Prepare the Payload
      const deploymentData = {
        cred: data.cred,
        skGameRole: normalizeSkGameRole(data.skGameRole),
        accountNickname: data.accountNickname || "Endmin",
        notifyEnabled: !!data.notifyEnabled,
        webhookUrl: data.webhookUrl || "",
        discordId: data.discordId || "",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        savedScriptId: data.savedScriptId || null, // If exists, performGoogleDeployment should update instead of create
      };

      if (DEBUG) console.log("DEBUG: Initiating Google Deployment...", deploymentData);

      // 4. Execute the Deployment (The heavy lifting)
      // Note: performGoogleDeployment must be defined in your auth logic file
      const result = await performGoogleDeployment(
        data.googleToken,
        deploymentData,
      );

      // 5. Success Handling
      if (result && result.scriptId) {
        const updatePackage = {
          savedScriptId: result.scriptId,
          webAppUrl: result.webAppUrl, // The URL needed for the "Test" button and scheduling
          lastSyncTime: Date.now(),
          setupComplete: true, // Flag to show we've successfully finished at least once
          lastSyncedSnapshot: getSummarySnapshot(data), // So summary can show "Open Dashboard" when unchanged
        };

        chrome.storage.local.set(updatePackage, () => {
          if (DEBUG) console.log("DEBUG: Deployment Success. Script ID:", result.scriptId);
          isDirty = false; // Reset the dirty flag

          chrome.storage.local.get(["googleWebAppAuthorized"], (d) => {
            const state = deriveAutomationState({ webAppUrl: result.webAppUrl, savedScriptId: result.scriptId, googleWebAppAuthorized: d.googleWebAppAuthorized });
            if (state.automationActive) {
              goToDashboardIfActive();
              return;
            }

            // Gate opening auth tab: preflight with allowAuthTab so 401/403 still open tab
            preflightWebApp(result.webAppUrl).then((preflightResult) => {
              handlePreflightResult(
                preflightResult,
                () => {
                  chrome.storage.local.set(
                    { pendingAuthUrl: result.webAppUrl, googleAuthPending: true },
                    () => {
                      chrome.runtime.sendMessage(
                        { action: "OPEN_GOOGLE_ACCESS_TAB", webAppUrl: result.webAppUrl },
                        () => {},
                      );
                    },
                  );
                },
                { allowAuthTab: true },
              );
            });

            // Show the Finish-in-Google panel and success message
            const finishPanel = document.getElementById("finish-in-google-panel");
            if (finishPanel) finishPanel.classList.remove("hidden-success");
            const scriptLink = document.getElementById("finish-open-script-drive");
            if (scriptLink) {
              scriptLink.href = `https://script.google.com/home/projects/${result.scriptId}/edit`;
              scriptLink.classList.remove("hidden-success");
            }
            const successMsg = document.getElementById("success-message");
            if (successMsg) successMsg.classList.remove("hidden-success");

            // Restore button UI
            deployBtn.disabled = false;
            deployBtn.className = "btn-dashboard-primary setup-footer-primary";
            deployBtn.innerText = "Create Script & Open Google Tab";
            deployBtn.dataset.action = "sync";
          });
        });
      } else {
        throw new Error(
          "Deployment failed: No Script ID returned from Google.",
        );
      }
    } catch (error) {
      if (DEBUG) console.error("DEPLOYMENT ERROR:", error);

      // Reset Button UI
      deployBtn.disabled = false;
      deployBtn.className = "btn-dashboard-primary setup-footer-primary";
      deployBtn.innerText = "Try again";

      // Inform User
      alert("Deployment Error: " + error.message);
    }
  });
}

// Deploy button: create/update script & open Google tab, or go back to dashboard when active
const deployBtnEl = document.getElementById("deploy-btn");
if (deployBtnEl) {
  deployBtnEl.onclick = () => {
    if (deployBtnEl.dataset.action === "dashboard") {
      goToDashboardIfActive();
    } else {
      handleDeploymentFlow();
    }
  };
}
async function performGoogleDeployment(token, data) {
  const statusEl = document.getElementById("deploy-status");
  let scriptId = data.savedScriptId;

  const updateUI = async (text) => {
    if (statusEl) {
      statusEl.innerText = text;
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  /** 1. VERIFY ID **/
  if (scriptId) {
    try {
      const check = await fetch(
        `https://script.googleapis.com/v1/projects/${scriptId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (check.status === 404) {
        scriptId = null;
        await chrome.storage.local.remove("savedScriptId");
      }
    } catch (e) {
      scriptId = null;
    }
  }

  /** 2. SEARCH OR CREATE **/
  if (!scriptId) {
    await updateUI("Searching Google Drive...");
    const query = encodeURIComponent(
      "name = 'ForgeField' and trashed = false",
    );
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id, name, mimeType)`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const searchData = await searchRes.json();
    const existingScript = searchData.files?.find(
      (f) => f.mimeType === "application/vnd.google-apps.script",
    );

    if (existingScript) {
      scriptId = existingScript.id;
    } else {
      await updateUI("Creating fresh project...");
      const createRes = await fetch(
        "https://script.googleapis.com/v1/projects",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: "ForgeField" }),
        },
      );
      const project = await createRes.json();
      scriptId = project.scriptId;
    }
  }

  /** 3. UPDATE CONTENT **/
  await updateUI("Updating source code...");
  const userTimeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const appsscriptJson = {
    timeZone: userTimeZone,
    runtimeVersion: "V8",
    webapp: { access: "ANYONE_ANONYMOUS", executeAs: "USER_DEPLOYING" },
    oauthScopes: [
      "https://www.googleapis.com/auth/script.external_request",
      "https://www.googleapis.com/auth/script.scriptapp",
      "https://www.googleapis.com/auth/drive.scripts",
    ],
  };

  const syncedProfiles = [{ cred: data.cred, skGameRole: normalizeSkGameRole(data.skGameRole), platform: "3", vName: "1.0.0", accountNickname: data.accountNickname || "Endmin" }];
  const scriptCode = `
/** Synced from extension when this script was generated. Run runFromEditor() to claim using these values without the extension. */
var SYNCED_PROFILES = ${JSON.stringify(syncedProfiles)};
var SYNCED_DISCORD_WEBHOOK = ${JSON.stringify(data.webhookUrl || "")};
var SYNCED_MY_DISCORD_ID = ${JSON.stringify(data.discordId || "")};
var SYNCED_USER_TIMEZONE = ${JSON.stringify(userTimeZone)};

function getDefaultConfig() {
  return {
    profiles: SYNCED_PROFILES,
    discord_notify: !!SYNCED_DISCORD_WEBHOOK,
    discordWebhook: SYNCED_DISCORD_WEBHOOK,
    myDiscordID: SYNCED_MY_DISCORD_ID,
    USER_TIMEZONE: SYNCED_USER_TIMEZONE
  };
}

/** Run this from the Apps Script editor (Run -> runFromEditor) to perform check-in without the extension. */
function runFromEditor() {
  var config = getDefaultConfig();
  var results = main(config);
  console.log(JSON.stringify(results, null, 2));
  return results;
}

function doGet(e) {
  var result = { status: "error", message: "No data" };
  try {
    var dataParam = e.parameter.data;
    if (dataParam) {
      var config = JSON.parse(Utilities.newBlob(Utilities.base64Decode(dataParam)).getDataAsString());
      if (config.action === "SCHEDULE") {
        var msg = setupDailyTrigger(config);
        result = { status: "success", message: msg };
      } else {
        var results = main(config);
        result = { status: "success", data: results };
      }
    } else {
      result = { status: "authorized", message: "You can close this tab and use Auto-claim Once from the extension." };
    }
  } catch (err) {
    result = { status: "error", message: err.toString() };
  }
  var html = "<!DOCTYPE html><html><head><meta charset=\\"UTF-8\\"><title>ForgeField</title></head><body style=\\"font-family:sans-serif;padding:20px;background:#1a1a1a;color:#eee;\\"><h2>ForgeField Claim</h2><pre>" + JSON.stringify(result, null, 2) + "</pre></body></html>";
  return HtmlService.createHtmlOutput(html);
}

function doPost(e) {
  try {
    const config = JSON.parse(e.postData.contents);
    if (config.action === "SCHEDULE") {
      const msg = setupDailyTrigger(config);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: msg })).setMimeType(ContentService.MimeType.JSON);
    }
    const results = main(config);
    return ContentService.createTextOutput(JSON.stringify({ status: "success", data: results })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function main(config) {
  if (!config || !config.profiles || config.profiles.length === 0) {
    config = getDefaultConfig();
  }
  const profiles = config.profiles || [];
  const results = profiles.map(autoClaimFunction);
  if (config.discord_notify && config.discordWebhook) {
    postWebhook(results, config);
  }
  return results;
}

function autoClaimFunction({ cred, skGameRole, platform, vName, accountNickname }) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const attendanceUrl = 'https://zonai.skport.com/web/v1/game/endfield/attendance';
    let token = "";
    try { token = refreshToken(cred, platform, vName); } catch (e) {
      token = "";
    }
    const sign = generateSign('/web/v1/game/endfield/attendance', '', timestamp, token, platform, vName);
    const header = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Referer': 'https://game.skport.com/',
      'Content-Type': 'application/json',
      'sk-language': 'en',
      'sk-game-role': skGameRole,
      'cred': cred,
      'platform': platform,
      'vName': vName,
      'timestamp': timestamp,
      'sign': sign,
      'Origin': 'https://game.skport.com',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site'
    };
    try {
        const res = UrlFetchApp.fetch(attendanceUrl, { method: 'POST', headers: header, muteHttpExceptions: true });
        const json = JSON.parse(res.getContentText());
        let result = { name: accountNickname, success: false, status: "", rewards: "" };
        if (json.code === 0) {
            result.success = true; result.status = "✅ Success";
            if (json.data && json.data.awardIds) {
                result.rewards = json.data.awardIds.map(award => {
                    const resInfo = json.data.resourceInfoMap ? json.data.resourceInfoMap[award.id] : null;
                    return resInfo ? resInfo.name + " x" + resInfo.count : "Unknown Item";
                }).join('\\n');
            }
        } else if (json.code === 10001) {
            result.success = true; result.status = "👌 Already Claimed"; result.rewards = "Checked in today!";
        } else {
            result.status = "❌ Failed"; result.rewards = json.message || "Unknown error";
        }
        return result;
    } catch (e) { return { name: accountNickname, success: false, status: "💥 Error", rewards: e.message }; }
}

function postWebhook(results, config) {
    const allSuccess = results.every(r => r.success);
    const now = new Date();
    const timeZone = config.USER_TIMEZONE || SYNCED_USER_TIMEZONE || "UTC";
    const timeString = now.toLocaleString("en-US", { timeZone: timeZone });
    const payload = {
        username: "Perlica",
        avatar_url: "https://pbs.twimg.com/profile_images/2027435678036860928/0x2dRYwO_400x400.png",
        embeds: [{
            title: "📡 Endfield Daily Check-in Report",
            color: allSuccess ? 5763719 : 15548997,
            fields: results.map(r => ({ name: "👤 " + r.name, value: "**Status:** " + r.status + "\\n**Rewards:**\\n" + (r.rewards || "None"), inline: true })),
            footer: { text: "Processed at: " + timeString }
        }]
    };
    if (!allSuccess && config.myDiscordID) { payload.content = "<@" + config.myDiscordID + "> Check-in issues!"; }
    UrlFetchApp.fetch(config.discordWebhook, { method: 'POST', contentType: 'application/json', payload: JSON.stringify(payload) });
}

function refreshToken(cred, platform, vName) {
    const refreshUrl = 'https://zonai.skport.com/web/v1/auth/refresh';
    const header = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'cred': cred,
      'platform': platform,
      'vName': vName,
      'Origin': 'https://game.skport.com',
      'Referer': 'https://game.skport.com/'
    };
    const res = UrlFetchApp.fetch(refreshUrl, { method: 'GET', headers: header, muteHttpExceptions: true });
    const json = JSON.parse(res.getContentText());
    if (json.code === 0 && json.data && json.data.token) return json.data.token;
    throw new Error(json.message || "Auth Error");
}

function generateSign(path, body, timestamp, token, platform, vName) {
    let str = path + body + timestamp;
    const headerJson = '{"platform":"' + platform + '","timestamp":"' + timestamp + '","dId":"","vName":"' + vName + '"}';
    str += headerJson;
    const hmacBytes = Utilities.computeHmacSha256Signature(str, token || '');
    const hmacHex = bytesToHex(hmacBytes);
    const md5Bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, hmacHex);
    return bytesToHex(md5Bytes);
}
function bytesToHex(bytes) {
    return bytes.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function setupDailyTrigger(config) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  const hour = parseInt(config.scheduledHour) || 2;
  ScriptApp.newTrigger('automatedMain').timeBased().everyDays(1).atHour(hour).nearMinute(0).create();
  PropertiesService.getScriptProperties().setProperty('lastConfig', JSON.stringify(config));
  return "Successfully scheduled for " + hour + ":00 daily.";
}

function automatedMain() {
  var savedConfig = PropertiesService.getScriptProperties().getProperty('lastConfig');
  if (savedConfig) {
    main(JSON.parse(savedConfig));
  } else {
    main(getDefaultConfig());
  }
}
`;

  const contentRes = await fetch(
    `https://script.googleapis.com/v1/projects/${scriptId}/content`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: [
          { name: "Code", type: "SERVER_JS", source: scriptCode },
          {
            name: "appsscript",
            type: "JSON",
            source: JSON.stringify(appsscriptJson),
          },
        ],
      }),
    },
  );
  if (!contentRes.ok) throw new Error("Failed to upload content to Google.");

  /** 4. VERSIONING **/
  await updateUI("Creating script version...");
  const vRes = await fetch(
    `https://script.googleapis.com/v1/projects/${scriptId}/versions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        description: "Extension Sync " + new Date().toISOString(),
      }),
    },
  );
  const vData = await vRes.json();
  if (!vData.versionNumber) throw new Error("Could not create version.");

  /** 5. SMART DEPLOYMENT (Using Saved Deployment ID) **/
  await updateUI("Finalizing Web App URL...");

  // 1. Fetch the saved deployment ID from storage
  const storage = await chrome.storage.local.get(["savedDeploymentId"]);
  let savedId = storage.savedDeploymentId;
  let dData;
  let webAppUrl = null;

  if (savedId) {
    try {
      if (DEBUG) console.log("DEBUG: Attempting to update saved deployment:", savedId);
      const updateRes = await fetch(
        `https://script.googleapis.com/v1/projects/${scriptId}/deployments/${savedId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            deploymentConfig: {
              versionNumber: vData.versionNumber,
              manifestFileName: "appsscript",
              description: "Updated via Extension",
            },
          }),
        },
      );
      dData = await updateRes.json();

      if (dData.error) {
        // If the saved one is now read-only or gone, we fall through to create a new one
        if (DEBUG) console.warn("DEBUG: Saved deployment no longer modifiable:", dData.error.message);
        savedId = null;
      } else {
        webAppUrl = dData.entryPoints?.[0]?.webApp?.url;
      }
    } catch (err) {
      savedId = null;
    }
  }

  // 2. Create a fresh one if we don't have a valid saved ID
  if (!webAppUrl) {
    if (DEBUG) console.log("DEBUG: Creating a fresh versioned deployment.");
    const createRes = await fetch(
      `https://script.googleapis.com/v1/projects/${scriptId}/deployments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          versionNumber: vData.versionNumber,
          description: "ForgeField Versioned Deployment",
        }),
      },
    );
    dData = await createRes.json();

    if (dData.deploymentId) {
      // SAVE this ID so we only update this specific one next time
      await chrome.storage.local.set({ savedDeploymentId: dData.deploymentId });
      webAppUrl = dData.entryPoints?.[0]?.webApp?.url;
    }
  }

  if (!webAppUrl) throw new Error("Deployment failed to return a Web App URL.");

  if (DEBUG) console.log("DEBUG: Final URL retrieved:", webAppUrl);
  return { scriptId, webAppUrl };
}
// Listen for real-time changes to the connection status
chrome.storage.onChanged.addListener((changes) => {
  if (changes.skportConnected) {
    if (typeof syncGameSession === "function") syncGameSession();
  }
  if (changes.discordAvatarUrl || changes.discordUsername) {
    if (typeof validateDiscordId === "function") validateDiscordId();
  }
});