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

  // UPDATED: Handling Reactive SKPort Session Check
  if (message.action === "CHECK_SKPORT_SESSION") {
    chrome.cookies.getAll({ domain: "skport.com" }, (cookies) => {
      // Look for the ACTUAL website cookie names
      const hasCred = cookies.some(c => c.name === "SK_OAUTH_CRED_KEY");
      const hasRole = cookies.some(c => c.name === "APP_CURRENT_ROLE_GAME_ROLE:endfield");
      
      sendResponse({ live: hasCred && hasRole });
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
    ? "https://338bc39c3f7d71997a54f8c5c3d468e831d04f9a.extensions.allizom.org/" 
    : chrome.identity.getRedirectURL();

  const scopes = [
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/script.processes",
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
async function startDiscordAuth() {
  const DISCORD_CLIENT_ID = "1476280881604984922";
  const redirectUri = chrome.identity.getRedirectURL();

  const authUrl = `https://discord.com/api/oauth2/authorize?` +
    `client_id=${DISCORD_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=token&` +
    `scope=identify%20guilds`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        return reject(new Error(chrome.runtime.lastError?.message || "Discord Auth Canceled"));
      }
      try {
        const hash = new URL(redirectUrl).hash.substring(1);
        const params = new URLSearchParams(hash);
        const token = params.get("access_token");
        if (token) {
          // Fetch user profile to get ID and Username
          fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${token}` }
          })
          .then(res => res.json())
          .then(user => {
            chrome.storage.local.set({ discordToken: token, discordId: user.id, discordUsername: user.username }, () => {
              resolve({ token, user });
            });
          })
          .catch(err => reject(new Error("Failed to fetch Discord profile: " + err.message)));
        } else {
          reject(new Error("Discord token missing"));
        }
      } catch (e) {
        reject(new Error("Discord Parsing error: " + e.message));
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
    console.log("Cleanup Triggered: SKPort session ended.");

    // Wipe all session-related keys
    chrome.storage.local.remove(["cred", "skGameRole"], () => {
      // Force the popup UI to reset if it's open
      chrome.runtime.sendMessage({ action: "SESSION_CLEARED" }).catch(() => {});
    });
  }
});