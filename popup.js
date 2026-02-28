// --- 1. CONFIGURATION ---
const GOOGLE_CLIENT_ID =
  "117203639682-hb4fbbae75d5tbr92bivniste0b7t5g4.apps.googleusercontent.com";
const DISCORD_CLIENT_ID = "1476280881604984922";
if (typeof chrome === "undefined" || !chrome.extension) {
  window.chrome = window.browser;
}
// --- 2. GLOBAL STATE ---
let page2SubStep = "ID";
let isCapturing = false;
let isDirty = false;

// --- 3. LIFECYCLE DEFINITION (Fixes ReferenceError) ---
// --- 3. UPDATED LIFECYCLE DEFINITION ---
const lifecycle = {
  p1: () => {
    console.log("LIFECYCLE: Step 1 Initializing...");
    syncGameSession(); // Force the UI to check connection status immediately
  },

  // Page 2: Google Account Linking (pGoogle)
  pGoogle: () => {
    console.log("LIFECYCLE: Entering Step 2 (Google)");
    if (typeof checkGoogleStatus === "function") {
      checkGoogleStatus();
    }
  },

  // Page 3: Discord Linking (Wait for summary/status)
  p3: () => {
    console.log("LIFECYCLE: Entering Step 3 (Discord)");
    // Ensure the Discord status and any summary boxes are updated immediately
    if (typeof checkDiscordStatus === "function") {
      checkDiscordStatus();
    }
    if (typeof updateSummaryBox === "function") {
      updateSummaryBox();
    }
  },

  // Page 4: Final Sub-view / Confirmation
  p2: () => {
    console.log("LIFECYCLE: Entering Final Setup");
    if (typeof updatePage2SubView === "function") {
      updatePage2SubView();
    }
  },

  // Dashboard: Main App View
  pDashboard: () => {
    console.log("LIFECYCLE: Entering Dashboard");
    chrome.storage.local.get(
      ["lastSyncTime", "googleToken", "discordId"],
      (data) => {
        // Update the dashboard time and any user-specific stats
        if (typeof updateDashboardTime === "function") {
          updateDashboardTime(data.lastSyncTime);
        }
        // You can add logic here to refresh stats from the server
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

const showPage = (id) => {
  const targetId = UI_PAGES[id] || id;
  const targetElement = document.getElementById(targetId);
  if (!targetElement) return;

  // 1. Progress Bar Logic
  const progressContainer = document.querySelector(".progress-container");
  const progressFill = document.getElementById("progress-fill");
  const progressPercent = document.getElementById("progress-percent");
  const progressLabel = document.getElementById("progress-label");

  const isDashboard = targetId === "page-dashboard";

  if (progressContainer) {
    progressContainer.style.display = isDashboard ? "none" : "block";

    // Mapping IDs to percentage/labels
    const progressMap = {
      p1: { pct: "25%", text: "STEP 1: SKPORT" },
      pGoogle: { pct: "50%", text: "STEP 2: GOOGLE" },
      p2: { pct: "75%", text: "STEP 3: DISCORD" },
      p3: { pct: "100%", text: "FINAL: DEPLOY" },
    };

    if (progressMap[id]) {
      progressFill.style.width = progressMap[id].pct;
      progressPercent.innerText = progressMap[id].pct;
      progressLabel.innerText = progressMap[id].text;
    }
  }

  // 2. Navigation Persistence
  document.querySelectorAll(".setup-page, .page").forEach((p) => {
    p.style.display = "none";
  });

  targetElement.style.display = "flex";

  // Force a UI sync whenever we switch pages to re-apply the "dimmed" state
  syncGameSession();

  if (lifecycle[id]) lifecycle[id]();
  chrome.storage.local.set({ lastPage: id });
};

// --- 5. INITIALIZATION ---

document.addEventListener("DOMContentLoaded", () => {
// 1. Get the last saved page from storage
  chrome.storage.local.get(["lastPage", "setupComplete"], (data) => {
    // Default to 'p1' if nothing is saved or if setup isn't finished
    const pageToLoad = data.lastPage || (data.setupComplete ? "pDashboard" : "p1");
    
    console.log("Restoring session to:", pageToLoad);
    showPage(pageToLoad);
  });

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
      console.log("Navigating to Setup/Redeploy (p1)");
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
    btnDone.onclick = () => showPage("pDashboard");
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
      enableAutoBtn.disabled = true;
      statusEl.innerText = "Connecting to Google...";

      try {
        const data = await chrome.storage.local.get([
          "webAppUrl",
          "cred",
          "skGameRole",
          "webhookUrl",
          "accountNickname",
        ]);
        if (!data.webAppUrl) throw new Error("No Web App URL");

        const selectedHour = parseInt(timeInput.split(":")[0]);
        const payload = {
          action: "SCHEDULE",
          scheduledHour: selectedHour,
          profiles: [
            {
              cred: data.cred,
              skGameRole: data.skGameRole,
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
        statusEl.innerText = `✅ Scheduled for ${timeInput} daily.`;
        statusEl.style.color = "#4CAF50";
      } catch (err) {
        statusEl.innerText = "❌ Failed to schedule.";
        statusEl.style.color = "#ff4444";
      } finally {
        // Re-enable is handled by health check polling, but safe to flip here too
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
        page2SubStep = "WEBHOOK";
        if (typeof updatePage2SubView === "function") updatePage2SubView();
      } else {
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

document.getElementById("btn-run-test").addEventListener("click", async () => {
  const testBtn = document.getElementById("btn-run-test");
  console.log("DEBUG: 1. Button clicked (Web App Flow)");
  testBtn.innerText = "Testing...";
  testBtn.disabled = true;

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
      throw new Error("No Web App URL. Please click 'SYNC TO DRIVE' first.");
    }

    const payload = {
      profiles: [
        {
          cred: data.cred,
          skGameRole: data.skGameRole,
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

    // Note: mode 'no-cors' is used because Google Script redirects (302)
    // are often blocked by CORS in extension popups.
    await fetch(data.webAppUrl, {
      method: "POST",
      mode: "no-cors", // Prevents Edge from blocking the redirect
      cache: "no-cache", // Forces a fresh handshake
      credentials: "omit", // Tells Edge NOT to send local Windows/Edge profile cookies
      headers: {
        "Content-Type": "text/plain", // Avoids the "Preflight" check that Edge hates
      },
      body: JSON.stringify(payload),
    });

    console.log("DEBUG: 4. Success! Signal sent to Google.");
    testBtn.innerText = "Success! ✅";
  } catch (err) {
    console.error("DEBUG: CRITICAL ERROR:", err.message);
    alert(err.message);
    testBtn.innerText = "Failed ❌";
  } finally {
    setTimeout(() => {
      testBtn.innerText = "Auto-claim Once";
      testBtn.disabled = false;
    }, 3000);
  }
});

// ==========================================
// 1. AUTHENTICATION & SIGN OUT
// ==========================================

const handleGoogleSignOut = () => {
  // We don't use removeCachedAuthToken in Firefox/Universal flow
  // as we manage the token manually in storage.
  const keysToRemove = ["googleToken", "savedScriptId", "lastSyncTime"];

  chrome.storage.local.remove(keysToRemove, () => {
    console.log("DEBUG: Signed out from Google.");

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

const toggleDashboardControls = (isDriveValid, isSkportValid) => {
  const claimOnceBtn = document.getElementById("btn-run-test"); // Your "Auto-Claim Once" ID
  const enableAutoBtn = document.getElementById("btn-save-automation"); // Your "Enable" ID

  const canOperate = isDriveValid && isSkportValid;

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
  const dot = document.getElementById("token-status-dot");
  const text = document.getElementById("token-status-text");
  if (dot && text) {
    dot.className = isValid ? "status-dot online" : "status-dot offline";
    text.innerText = isValid ? "Cloud Active" : "Token Expired / Missing";
    text.style.color = isValid ? "#4caf50" : "#ffa500";
  }
};

// `updateSKPORTLinkUI` moved to popup.skport.js

const checkTokenHealth = async () => {
  chrome.storage.local.get(
    ["googleToken", "savedScriptId", "cred", "skGameRole"],
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
            console.warn("Token is invalid or expired. Cleaning up...");
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
          console.error("Health check network error:", err);
          // On network error, assume previous state or false to be safe
        }
      }

      // 2. Check SKPORT Health
      const isSkportValid = !!(data.cred && data.skGameRole);

      // 3. Update Dashboard Button States (The Missing Part)
      // Both must be valid for the automation to work
      const canOperate = isDriveValid && isSkportValid;

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
    },
  );
};

const checkGoogleStatus = () => {
  chrome.storage.local.get(["googleToken"], (data) => {
    const btn = document.getElementById("google-auth-btn");
    const next = document.getElementById("google-next-btn");
    const statusContainer = document.getElementById("google-auth-status");

    if (data.googleToken) {
      if (btn) {
        // keep any existing SVG icon in place while updating the text
        const svg = btn.querySelector('svg');
        btn.disabled = true;
        btn.classList.add("btn-google");
        btn.classList.remove("btn-active");
        // clear previous text then reinsert icon + new label
        btn.textContent = "";
        if (svg) btn.appendChild(svg);
        btn.append(" \u2713 Account Linked"); // check mark
      }
      if (next) {
        next.disabled = false;
        next.classList.add("btn-action");
        next.classList.remove("btn-secondary");
      }
      if (statusContainer) statusContainer.style.display = "block";

      // Ensure these exist before calling
      if (typeof checkTokenHealth === "function") checkTokenHealth();
    } else {
      if (btn) {
        const svg = btn.querySelector('svg');
        btn.disabled = false;
        btn.classList.add("btn-google");
        btn.classList.remove("btn-active");
        btn.textContent = "";
        if (svg) btn.appendChild(svg);
        btn.append("Sign in with Google");
      }
      if (next) {
        next.disabled = true;
        next.classList.add("btn-secondary");
        next.classList.remove("btn-action");
      }
      if (statusContainer) statusContainer.style.display = "none";
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

function setViewMode(mode) {
  const deployControls = document.getElementById("deploy-controls");
  const dashboardView = document.getElementById("success-message");
  const deployBtn = document.getElementById("deploy-btn");

  if (mode === "settings") {
    if (deployControls) deployControls.style.display = "block";
    if (dashboardView) dashboardView.style.display = "none";
    if (deployBtn) deployBtn.innerText = "Update Settings";
  } else {
    if (deployControls) deployControls.style.display = "none";
    if (dashboardView) dashboardView.style.display = "block";
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

const updateSummaryBox = (manualId = null) => {
  chrome.storage.local.get(
    [
      "skGameRole",
      "cred",
      "discordUsername",
      "discordId",
      "notifyEnabled",
      "accountNickname",
      "savedScriptId",
    ],
    (data) => {
      const skEl = document.getElementById("stat-skport-name");
      const dsEl = document.getElementById("stat-discord-id");
      const niEl = document.getElementById("stat-nickname");
      const deployBtn = document.getElementById("deploy-btn");

      // 1. Connection Status
      if (skEl) {
        const isReady = data.skGameRole && data.cred && data.cred !== "PENDING";
        skEl.innerText = isReady ? "Connected" : "Disconnected";
        skEl.style.color = isReady ? "#4caf50" : "#ffa500";
      }

      // 2. Discord Status
      if (dsEl) {
        if (data.notifyEnabled === false) {
          dsEl.innerText = "Disabled";
          dsEl.style.color = "#888";
        } else {
          const currentId = manualId !== null ? manualId : data.discordId || "";
          const hasId = currentId.length > 5 || data.discordUsername;
          dsEl.innerText = hasId ? "Enabled" : "Not Set";
          dsEl.style.color = hasId ? "#fffa00" : "#ffa500";
        }
      }

      // 3. Nickname Display
      if (niEl) {
        niEl.innerText = data.accountNickname
          ? data.accountNickname
          : "Not Set";
        niEl.style.color = data.accountNickname ? "#eee" : "#888";
      }

      // 4. Button Logic (Deployment vs Update)
      if (deployBtn) {
        // We use savedScriptId as the source of truth for "Setup Complete"
        if (data.savedScriptId) {
          deployBtn.innerText = "CONFIRM";
          deployBtn.className = "btn-secondary"; // Use a neutral style for existing users
          deployBtn.style.background = "#333";
          deployBtn.style.color = "#eee";
        } else {
          deployBtn.innerText = "CONFIRM DEPLOYMENT";
          deployBtn.className = "btn-action";
          deployBtn.style.background = "#fffa00";
          deployBtn.style.color = "#000";
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
  console.log("DEBUG: Telling background to handle auth...");

  chrome.runtime.sendMessage({ action: "AUTH_GOOGLE" }, (response) => {
    // Check for extension system errors (like the background script being asleep)
    if (chrome.runtime.lastError) {
      console.error(
        "DEBUG: Connection Error:",
        chrome.runtime.lastError.message,
      );
      return;
    }

    if (response?.status === "success") {
      console.log("DEBUG: Auth succeeded!");
      checkGoogleStatus();
    } else {
      // This catches the 'redirect_uri_mismatch' or other logic errors
      console.error("DEBUG: Auth failed:", response?.message);
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
  console.log("DEBUG: Telling background to handle Discord auth...");

  chrome.runtime.sendMessage({ action: "AUTH_DISCORD" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(
        "DEBUG: Discord Connection Error:",
        chrome.runtime.lastError.message,
      );
      return;
    }

    if (response?.status === "success") {
      console.log("DEBUG: Discord Auth succeeded!");
      checkDiscordStatus();
    } else {
      console.error("DEBUG: Discord Auth failed:", response?.message);
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
                cred: data.cred, // Verify this is NOT null via console before clicking
                skGameRole: data.skGameRole,
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
        console.error("Test Error:", error);
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
        skGameRole: data.skGameRole,
        accountNickname: data.accountNickname || "Endmin",
        notifyEnabled: !!data.notifyEnabled,
        webhookUrl: data.webhookUrl || "",
        discordId: data.discordId || "",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        savedScriptId: data.savedScriptId || null, // If exists, performGoogleDeployment should update instead of create
      };

      console.log("DEBUG: Initiating Google Deployment...", deploymentData);

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
        };

        chrome.storage.local.set(updatePackage, () => {
          console.log("DEBUG: Deployment Success. Script ID:", result.scriptId);
          isDirty = false; // Reset the dirty flag

          // Show the dashboard
          if (typeof showPage === "function") {
            showPage("pDashboard");
          } else {
            // Fallback if showPage isn't available
            location.reload();
          }
        });
      } else {
        throw new Error(
          "Deployment failed: No Script ID returned from Google.",
        );
      }
    } catch (error) {
      console.error("DEPLOYMENT ERROR:", error);

      // Reset Button UI
      deployBtn.disabled = false;
      deployBtn.innerText = "RETRY DEPLOYMENT";

      // Inform User
      alert("Deployment Error: " + error.message);
    }
  });
}

// Ensure the button is actually wired up if it exists in the DOM
const deployBtnEl = document.getElementById("deploy-btn");
if (deployBtnEl) {
  deployBtnEl.onclick = handleDeploymentFlow;
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
      "name = 'Endfield Forge Assistant' and trashed = false",
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
          body: JSON.stringify({ title: "Endfield Forge Assistant" }),
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

  const scriptCode = `
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
      return { name: accountNickname, success: false, status: "Auth Failed", rewards: e.message };
    }
    const sign = generateSign('/web/v1/game/endfield/attendance', '', timestamp, token, platform, vName);
    const header = { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*', 'Content-Type': 'application/json', 'sk-game-role': skGameRole, 'cred': cred, 'platform': platform, 'vName': vName, 'timestamp': timestamp, 'sign': sign };
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
    const timeZone = config.USER_TIMEZONE || "${userTimeZone}";
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
    const res = UrlFetchApp.fetch('https://zonai.skport.com/web/v1/auth/refresh', { headers: { cred, platform, vName } });
    const json = JSON.parse(res.getContentText());
    if (json.code === 0 && json.data) return json.data.token;
    throw new Error(json.message || "Auth Error");
}

function generateSign(path, body, timestamp, token, platform, vName) {
    const str = path + body + timestamp + '{"platform":"' + platform + '","timestamp":"' + timestamp + '","dId":"","vName":"' + vName + '"}';
    const hmac = Utilities.computeHmacSha256Signature(str, token || '').map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
    return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, hmac).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
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
  const savedConfig = PropertiesService.getScriptProperties().getProperty('lastConfig');
  if (savedConfig) main(JSON.parse(savedConfig));
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
      console.log("DEBUG: Attempting to update saved deployment:", savedId);
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
        console.warn(
          "DEBUG: Saved deployment no longer modifiable:",
          dData.error.message,
        );
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
    console.log("DEBUG: Creating a fresh versioned deployment.");
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
          description: "Endfield Forge Versioned Deployment",
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

  console.log("DEBUG: Final URL retrieved:", webAppUrl);
  return { scriptId, webAppUrl };
}
// Listen for real-time changes to the connection status
chrome.storage.onChanged.addListener((changes) => {
  if (changes.skportConnected) {
    if (typeof syncGameSession === "function") syncGameSession();
  }
});