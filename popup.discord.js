// Discord-specific UI and validation helpers
// This file is intentionally small and depends on globals in `popup.js` (e.g. `page2SubStep`).

const validateDiscordId = (manualVal = null) => {
  const nextBtn2 = document.getElementById("next-from-2");
  const idField = document.getElementById("discordId");
  const authBtn = document.getElementById("discord-auth-btn");
  const btnText = document.getElementById("discord-auth-btn-text");
  const signedInUsername = document.getElementById("discord-signed-in-username");

  const id = manualVal !== null ? manualVal : idField ? idField.value.trim() : "";

  if (manualVal !== null && idField && idField.value !== manualVal) {
    idField.value = manualVal;
    idField.classList.add("pulse-once");
    setTimeout(() => idField.classList.remove("pulse-once"), 600);
  }

  const isValid = /^\d{17,20}$/.test(id);

  if (nextBtn2) {
    nextBtn2.disabled = !isValid;
    nextBtn2.className = isValid ? "btn-dashboard-primary setup-footer-primary" : "btn-dashboard-secondary";
  }

  chrome.storage.local.get(["discordUsername", "discordAvatarUrl", "discordToken"], (data) => {
    const isSignedIn = !!data.discordUsername;
    const connectedBlock = document.getElementById("discord-connected-block");
    const connectWrap = document.getElementById("discord-connect-wrap");
    const editLink = document.getElementById("edit-manually-link");
    const avatarEl = document.getElementById("discord-avatar");
    if (connectedBlock) connectedBlock.classList.toggle("hidden", !isSignedIn);
    if (connectWrap) connectWrap.classList.toggle("hidden", isSignedIn);
    if (editLink) editLink.classList.toggle("hidden", isSignedIn);
    if (signedInUsername) signedInUsername.textContent = data.discordUsername || "";
    if (avatarEl) {
      const defaultAvatar = "https://cdn.discordapp.com/embed/avatars/0.png";
      avatarEl.src = isSignedIn ? (data.discordAvatarUrl || defaultAvatar) : "";
      avatarEl.alt = data.discordUsername ? `${data.discordUsername} avatar` : "";
    }
    if (btnText) btnText.textContent = "Connect with Discord";
    // If connected but avatar URL missing, fetch profile so we get the real avatar
    if (isSignedIn && !data.discordAvatarUrl && data.discordToken) {
      chrome.runtime.sendMessage({ action: "REFRESH_DISCORD_PROFILE" }, () => {});
    }
  });
};

const validateWebhook = (manualVal = null) => {
  const nextBtn2 = document.getElementById("next-from-2");
  const webhookField = document.getElementById("webhook");

  const url = manualVal !== null ? manualVal : webhookField ? webhookField.value.trim() : "";
  const isValid = url.startsWith("https://discord.com/api/webhooks/") && url.length > 40;

  if (nextBtn2) {
    nextBtn2.disabled = !isValid;
    nextBtn2.className = isValid ? "btn-dashboard-primary setup-footer-primary" : "btn-dashboard-secondary";
  }
};

const handleDiscordSignOut = (e) => {
  if (e) e.preventDefault();
  chrome.storage.local.remove(["discordId", "discordUsername", "discordToken", "discordAvatarUrl"], () => {
    const idField = document.getElementById("discordId");
    if (idField) idField.value = "";
    const manualWrap = document.getElementById("discord-manual-wrap");
    const editLink = document.getElementById("edit-manually-link");
    const hideLink = document.getElementById("hide-manual-link");
    if (manualWrap) manualWrap.classList.add("hidden");
    if (editLink) { editLink.classList.remove("hidden"); editLink.textContent = "Use User ID instead"; }
    if (hideLink) hideLink.classList.add("hidden");
    if (typeof updatePage2SubView === "function") updatePage2SubView();
    if (typeof validateDiscordId === "function") validateDiscordId("");
  });
};

const updatePage2SubView = () => {
  const toggleEl = document.getElementById("discord-toggle");
  const isNotifyEnabled = toggleEl ? toggleEl.checked : false;
  const nextBtn2 = document.getElementById("next-from-2");
  const idStepContent = document.getElementById("discord-id-step-content");
  const partWebhook = document.getElementById("discord-part-webhook");
  const idInput = document.getElementById("discordId");

  chrome.storage.local.get(["discordId", "webhookUrl", "accountNickname", "discordUsername"], (data) => {
    if (!isNotifyEnabled) {
      if (idStepContent) idStepContent.style.display = "";
      if (partWebhook) partWebhook.style.display = "none";
      if (nextBtn2) {
        nextBtn2.disabled = false;
        nextBtn2.className = "btn-dashboard-primary setup-footer-primary";
        nextBtn2.innerText = "Continue to Activation";
      }
      return;
    }

    if (page2SubStep === "ID") {
      if (idStepContent) idStepContent.style.display = "";
      if (partWebhook) partWebhook.style.display = "none";
      if (idInput) {
        if (data.discordId) idInput.value = data.discordId;
        idInput.disabled = !!data.discordUsername;
        idInput.style.opacity = data.discordUsername ? "0.6" : "1";
        idInput.style.cursor = data.discordUsername ? "not-allowed" : "text";
      }
      validateDiscordId();
      if (nextBtn2) nextBtn2.innerText = "Continue";
    } else {
      if (idStepContent) idStepContent.style.display = "none";
      if (partWebhook) partWebhook.style.display = "block";
      validateWebhook();
      const nicknameField = document.getElementById("accountNickname");
      if (nicknameField) nicknameField.value = data.accountNickname || "";
      if (nextBtn2) nextBtn2.innerText = "Continue to Activation";
    }
  });
};

// Wire UI actions specific to the Discord subflow
document.addEventListener("DOMContentLoaded", () => {
  const disconnectBtn = document.getElementById("discord-disconnect-btn");
  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (confirm("Sign out from Discord?")) handleDiscordSignOut(e);
    });
  }

  const editManuallyLink = document.getElementById("edit-manually-link");
  const hideManualLink = document.getElementById("hide-manual-link");
  const manualWrap = document.getElementById("discord-manual-wrap");
  const setManualWrapVisible = (visible) => {
    if (!manualWrap) return;
    manualWrap.classList.toggle("hidden", !visible);
    if (editManuallyLink) editManuallyLink.classList.toggle("hidden", visible);
    if (hideManualLink) hideManualLink.classList.toggle("hidden", !visible);
  };
  if (editManuallyLink && manualWrap) {
    editManuallyLink.addEventListener("click", (e) => {
      e.preventDefault();
      setManualWrapVisible(true);
    });
  }
  if (hideManualLink && manualWrap) {
    hideManualLink.addEventListener("click", (e) => {
      e.preventDefault();
      setManualWrapVisible(false);
    });
  }

  const discordIdField = document.getElementById("discordId");
  if (discordIdField) {
    discordIdField.addEventListener("input", () => {
      validateDiscordId();
      const val = discordIdField.value.trim();
      if (/^\d{17,20}$/.test(val)) chrome.storage.local.set({ discordId: val });
    });
  }

  const webhookField = document.getElementById("webhook");
  if (webhookField) {
    webhookField.addEventListener("input", () => validateWebhook());
    webhookField.addEventListener("paste", () => setTimeout(() => validateWebhook(), 0));
  }
});
