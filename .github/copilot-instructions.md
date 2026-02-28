# Copilot Instructions — Endfield Forge

This file gives focused, actionable guidance for AI coding agents working on the Endfield Forge browser extension.

Overview
- Project type: Browser extension (Manifest V3) supporting Chrome/Edge and Firefox.
- Main components: `background.js` (service worker / controller), `popup.html` + `popup.js` (UI), `style.css`, fonts in `fonts/`, icons in `icons/`.

Key architectural facts
- `manifest.json` declares a module-style background (`background.js`) and a popup (`popup.html`). OAuth flows use `chrome.identity.launchWebAuthFlow`.
- `background.js` is the single message controller: it listens on `chrome.runtime.onMessage` for actions like `AUTH_GOOGLE`, `AUTH_DISCORD`, `CHECK_SKPORT_SESSION` and returns async responses (it returns true to allow async sendResponse).
- Popup UI lifecycle is driven by the `lifecycle` object in `popup.js` and page ids mapped by `UI_PAGES` — use `showPage("pX")` to navigate programmatically.
- Persistent data is stored in `chrome.storage.local`. Important keys: `cred`, `skGameRole`, `googleToken`, `discordToken`, `webAppUrl`, `webhookUrl`, `accountNickname`, `lastPage`, `setupComplete`.
- SKPort integration: the extension looks for cookie `SK_OAUTH_CRED_KEY` and localStorage key `APP_CURRENT_ROLE_GAME_ROLE:endfield` in an open `*.skport.com` tab; it uses `chrome.scripting.executeScript` to read that page's localStorage and `chrome.cookies` to read cookies.

Developer workflows & debugging
- No build step: the extension is runnable as-is. To test locally, load the extension via "Load unpacked" in `chrome://extensions` (Developer mode) or the equivalent in Firefox (about:debugging).
- Inspect the popup console by opening the popup and using "Inspect" on its view in `chrome://extensions`. Inspect the background/service worker via the extension's service worker inspect view.
- OAuth testing: ensure browser profile has networking to `accounts.google.com` and `discord.com`; `chrome.identity.getRedirectURL()` is used for redirect URIs (Firefox has a fallback hard-coded origin in `background.js`).

Patterns and conventions to preserve
- Messaging: calls to the background use small action objects, e.g. `chrome.runtime.sendMessage({ action: "AUTH_GOOGLE" })` and expect `{ status: "success", token }` or `{ status: "error", message }`.
- Async sendResponse: `background.js` returns `true` from the listener when using asynchronous flows — do not remove this or responses will be lost.
- UI state sync: `syncGameSession()` is the canonical method to refresh UI state from storage, cookies, or an open SKPort tab — call it after changing stored session data.
- Button styling/state: classes `btn-active` and `dimmed` are used to reflect availability; many buttons are disabled via `button.disabled` and CSS `button:disabled` is relied on.

Integration points & external dependencies
- Host permissions in `manifest.json` include Google APIs, Discord, and `*.skport.com` — any network interaction should respect these scopes.
- The extension posts to `webAppUrl` for automation; that URL is read from `chrome.storage.local` (key `webAppUrl`). Treat calls to that endpoint as external side-effects when editing logic.

Editing guidance for AI agents
- Preserve storage key names and message action strings exactly (they are used across contexts). Example: do not rename `SK_OAUTH_CRED_KEY` or `skGameRole`.
- When modifying auth flows, keep the `chrome.identity.launchWebAuthFlow` semantics and the `redirect_uri` construction intact to avoid invalid redirect behavior.
- When changing UI IDs or classes, update both `popup.html` and `popup.js` together (IDs like `page-1`, `page-google`, `progress-fill`, `btn-save-automation` are referenced in code).
- Avoid introducing build steps or transpilation — the repo is designed as a simple unpacked extension.

Examples (use these for reference)
- Message example: `chrome.runtime.sendMessage({ action: "CHECK_SKPORT_SESSION" }, (resp) => { console.log(resp.live) })`.
- Storage example: `chrome.storage.local.set({ cred: token })` and `chrome.storage.local.get(["cred"], cb)`.
- Scripting example (reading role from open tab): `chrome.scripting.executeScript({ target: { tabId }, func: () => localStorage.getItem("APP_CURRENT_ROLE_GAME_ROLE:endfield") }, callback)`

If anything here is unclear or you need additional examples (unit tests, repeatable repro steps, or authorization test tokens), tell me which section to expand and I will iterate.
