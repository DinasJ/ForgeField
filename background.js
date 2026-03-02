const DEBUG = false; // set true for development / support
// ==========================================
// 1. SINGLE MESSAGE LISTENER (The Controller)
// ==========================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // Handling Google Authorization
  if (message.action === "AUTH_GOOGLE") {
    startGoogleAuth()
      .then(token => sendResponse({ status: "success", token }))
      .catch(err => sendResponse({ status: "error", message: err.message }));
    return true; 
  }

  // Handling Discord Authorization
  if (message.action === "AUTH_DISCORD") {
    startDiscordAuth()
      .then(result => sendResponse({ status: "success", token: result.token }))
      .catch(err => sendResponse({ status: "error", message: err.message }));
    return true;
  }

  // Refresh Discord profile (avatar/username) using stored token
  if (message.action === "REFRESH_DISCORD_PROFILE") {
    chrome.storage.local.get(["discordToken"], (data) => {
      if (!data.discordToken) {
        sendResponse({ status: "error", message: "No Discord token" });
        return;
      }
      fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${data.discordToken}` }
      })
        .then(res => {
          if (!res.ok) throw new Error("Profile fetch " + res.status);
          return res.json();
        })
        .then(user => {
          const uid = String(user.id || "");
          const hash = user.avatar;
          const avatarUrl = hash
            ? `https://cdn.discordapp.com/avatars/${uid}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=64`
            : `https://cdn.discordapp.com/embed/avatars/${(user.discriminator && user.discriminator !== "0" ? parseInt(user.discriminator, 10) % 5 : 0)}.png`;
          chrome.storage.local.set({
            discordId: uid,
            discordUsername: user.username || user.global_name || "",
            discordAvatarUrl: avatarUrl
          }, () => sendResponse({ status: "success" }));
        })
        .catch(err => sendResponse({ status: "error", message: err.message }));
    });
    return true;
  }

  // UPDATED: Handling Reactive SKPort Session Check
  if (message.action === "CHECK_SKPORT_SESSION") {
    chrome.cookies.getAll({ domain: "skport.com" }, (cookies) => {
      const hasCred = cookies.some(c => c.name === "SK_OAUTH_CRED_KEY");
      const hasRole = cookies.some(c => c.name === "APP_CURRENT_ROLE_GAME_ROLE:endfield");
      sendResponse({ live: hasCred && hasRole });
    });
    return true;
  }

  // Open Google Access tab; keep authorization flag controlled by popup (no auto-true on close)
  if (message.action === "OPEN_GOOGLE_ACCESS_TAB") {
    const url = message.webAppUrl;
    if (!url) {
      sendResponse({ status: "error", message: "No webAppUrl" });
      return false;
    }
    chrome.tabs.create({ url }, (tab) => {
      if (tab && tab.id) {
        sendResponse({ status: "ok", tabId: tab.id });
      } else {
        sendResponse({ status: "error", message: "Failed to open tab" });
      }
    });
    return true;
  }
});
// ==========================================
// 2. GOOGLE AUTH LOGIC
// ==========================================
async function startGoogleAuth() {
  const GOOGLE_CLIENT_ID = "117203639682-hb4fbbae75d5tbr92bivniste0b7t5g4.apps.googleusercontent.com";
  const isFirefox = typeof InstallTrigger !== 'undefined';
  const redirectUri = isFirefox 
    ? "https://c7d16418b67b3dd3a2fe46022f79fa8f1acfc9b4.extensions.allizom.org/" 
    : chrome.identity.getRedirectURL();

  const scopes = [
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.scripts"
  ];

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${GOOGLE_CLIENT_ID}&` + 
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=token&` +
    `scope=${encodeURIComponent(scopes.join(" "))}&` +
    `prompt=consent`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        return reject(new Error(chrome.runtime.lastError?.message || "Auth Canceled"));
      }
      try {
        const urlObj = new URL(redirectUrl);
        const hash = urlObj.hash.substring(1);
        const params = new URLSearchParams(hash);
        const token = params.get("access_token");

        if (token) {
          chrome.storage.local.set({ googleToken: token }, () => resolve(token));
        } else {
          reject(new Error("Access token not found."));
        }
      } catch (e) {
        reject(new Error("Parsing error: " + e.message));
      }
    });
  });
}

// ==========================================
// 3. DISCORD AUTH LOGIC
// ==========================================
function finishDiscordAuth(token, resolve, reject) {
  if (!token) {
    reject(new Error("Discord token missing"));
    return;
  }
  fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(res => {
      if (!res.ok) throw new Error("Discord profile fetch " + res.status);
      return res.json();
    })
    .then(user => {
      const uid = String(user.id || "");
      const hash = user.avatar;
      const avatarUrl = hash
        ? `https://cdn.discordapp.com/avatars/${uid}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${(user.discriminator && user.discriminator !== "0" ? parseInt(user.discriminator, 10) % 5 : 0)}.png`;
      chrome.storage.local.set({
        discordToken: token,
        discordId: uid,
        discordUsername: user.username || user.global_name || "",
        discordAvatarUrl: avatarUrl
      }, () => resolve({ token, user }));
    })
    .catch(err => reject(new Error("Failed to fetch Discord profile: " + err.message)));
}

/** Fallback for Edge (and others) where launchWebAuthFlow often fails or returns undefined */
function startDiscordAuthViaTab(authUrl, redirectUri, resolve, reject) {
  let tabId = null;
  let windowId = null;
  let done = false;

  const cleanup = (closeWindow = true) => {
    if (tabId != null) chrome.tabs.onUpdated.removeListener(onTabUpdated);
    chrome.windows.onRemoved.removeListener(onWindowRemoved);
    if (closeWindow && windowId != null) chrome.windows.remove(windowId, () => {});
  };

  const tryParseTokenFromUrl = (url) => {
    if (!url) return null;
    const redirectBase = redirectUri.split("#")[0].replace(/\/?$/, "");
    if (!url.startsWith(redirectBase) && !url.startsWith(redirectUri)) return null;
    try {
      const urlObj = new URL(url);
      const hash = urlObj.hash.substring(1);
      const params = new URLSearchParams(hash);
      return params.get("access_token");
    } catch (e) {
      return null;
    }
  };

  const onTabUpdated = (updatedTabId, changeInfo, tab) => {
    if (done || updatedTabId !== tabId) return;
    const status = changeInfo.status;
    if (status !== "loading" && status !== "complete") return;
    // Prefer changeInfo.url (can include hash); fall back to tab.url (Edge sometimes omits hash in tab until "complete")
    const urlToCheck = changeInfo.url || tab.url;
    let token = tryParseTokenFromUrl(urlToCheck);
    if (!token && status === "complete") {
      // Edge: hash may only be in tab after "complete"; re-fetch tab to get final URL
      chrome.tabs.get(tabId, (t) => {
        if (done) return;
        const again = tryParseTokenFromUrl(t && t.url);
        if (again) {
          done = true;
          cleanup(true);
          finishDiscordAuth(again, resolve, reject);
        }
      });
      return;
    }
    if (!token) return;
    done = true;
    cleanup(true);
    finishDiscordAuth(token, resolve, reject);
  };

  const onWindowRemoved = (closedWindowId) => {
    if (closedWindowId === windowId && !done) {
      done = true;
      cleanup(false);
      reject(new Error("Discord Auth Canceled"));
    }
  };

  chrome.windows.create({ url: authUrl, type: "popup", width: 500, height: 600 }, (win) => {
    if (chrome.runtime.lastError || !win || !win.tabs || !win.tabs[0]) {
      reject(new Error(chrome.runtime.lastError?.message || "Could not open auth window"));
      return;
    }
    windowId = win.id;
    tabId = win.tabs[0].id;
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    chrome.windows.onRemoved.addListener(onWindowRemoved);
  });
}

async function startDiscordAuth() {
  const DISCORD_CLIENT_ID = "1476280881604984922";
  const redirectUri = chrome.identity.getRedirectURL();
  if (!redirectUri) {
    return Promise.reject(new Error("Could not get redirect URI. Check identity permission."));
  }

  const authUrl = `https://discord.com/api/oauth2/authorize?` +
    `client_id=${DISCORD_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=token&` +
    `scope=identify`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrl) => {
      if (redirectUrl) {
        try {
          const hash = new URL(redirectUrl).hash.substring(1);
          const params = new URLSearchParams(hash);
          const token = params.get("access_token");
          finishDiscordAuth(token, resolve, reject);
        } catch (e) {
          reject(new Error("Discord parsing error: " + e.message));
        }
        return;
      }
      // redirectUrl is undefined on Edge (and sometimes others) — use tab-based flow so Discord auth works everywhere
      const errMsg = (chrome.runtime.lastError && chrome.runtime.lastError.message) || "";
      const canceled = /cancel|closed|denied|user/i.test(errMsg);
      if (canceled) {
        reject(new Error(errMsg || "Discord Auth Canceled"));
      } else {
        startDiscordAuthViaTab(authUrl, redirectUri, resolve, reject);
      }
    });
  });
}
// ==========================================
// 4. AUTOMATIC DISCONNECT (Cookie Watcher)
// ==========================================
chrome.cookies.onChanged.addListener((changeInfo) => {
  // Check for the domain (including subdomains) and the removal event
  const isSKPort = changeInfo.cookie.domain.includes("skport.com");
  const isTargetCookie = changeInfo.cookie.name === "SK_OAUTH_CRED_KEY";

  if (isSKPort && isTargetCookie && changeInfo.removed) {
    if (DEBUG) console.log("Cleanup Triggered: SKPort session ended.");

    // Wipe all session-related keys
    chrome.storage.local.remove(["cred", "skGameRole"], () => {
      // Force the popup UI to reset if it's open
      chrome.runtime.sendMessage({ action: "SESSION_CLEARED" }).catch(() => {});
    });
  }
});