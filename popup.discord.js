// Discord-specific UI and validation helpers
// This file is intentionally small and depends on globals in `popup.js` (e.g. `page2SubStep`).

const validateDiscordId = (manualVal = null) => {
  const nextBtn2 = document.getElementById("next-from-2");
  const idField = document.getElementById("discordId");
  const authBtn = document.getElementById("discord-auth-btn");
  const btnText = document.getElementById("discord-auth-btn-text");
  const switchWrapper = document.getElementById("discord-switch-wrapper");

  const id = manualVal !== null ? manualVal : idField ? idField.value.trim() : "";

  if (manualVal !== null && idField && idField.value !== manualVal) {
    idField.value = manualVal;
    // Add pulse animation when autofilled
    idField.classList.add("pulse-once");
    setTimeout(() => idField.classList.remove("pulse-once"), 600);
  }

  const isValid = /^\d{17,20}$/.test(id);

  if (nextBtn2) {
    nextBtn2.disabled = !isValid;
    nextBtn2.className = isValid ? "btn-action" : "btn-secondary";
  }

  // Dim the Discord button if ID is already filled
  if (authBtn) {
    if (isValid) {
      authBtn.disabled = true;
      authBtn.classList.add("dimmed-button");
      // Get the username if available
      chrome.storage.local.get(["discordUsername"], (data) => {
        if (btnText) {
          btnText.innerText = data.discordUsername ? `Connected: ${data.discordUsername}` : "Connected";
        }
        if (switchWrapper) switchWrapper.style.display = "block";
      });
    } else {
      authBtn.disabled = false;
      authBtn.classList.remove("dimmed-button");
      if (btnText) btnText.innerText = "Connect with Discord";
      if (switchWrapper) switchWrapper.style.display = "none";
    }
  }
};

const validateWebhook = (manualVal = null) => {
  const nextBtn2 = document.getElementById("next-from-2");
  const webhookField = document.getElementById("webhook");

  const url = manualVal !== null ? manualVal : webhookField ? webhookField.value.trim() : "";
  const isValid = url.startsWith("https://discord.com/api/webhooks/") && url.length > 40;

  if (nextBtn2) {
    nextBtn2.disabled = !isValid;
    nextBtn2.className = isValid ? "btn-action" : "btn-secondary";
  }
};

const handleDiscordSignOut = (e) => {
  if (e) e.preventDefault();
  chrome.storage.local.remove(["discordId", "discordUsername", "discordToken"], () => {
    const idField = document.getElementById("discordId");
    if (idField) idField.value = "";
    const btnText = document.getElementById("discord-auth-btn-text");
    if (btnText) btnText.innerText = "Connect with Discord";
    if (typeof updatePage2SubView === "function") updatePage2SubView();
    if (typeof validateDiscordId === "function") validateDiscordId("");
  });
};

const handleDiscordSwitch = (e) => {
  if (e) e.preventDefault();
  chrome.storage.local.remove(["discordId", "discordUsername", "discordToken"], () => {
    const idField = document.getElementById("discordId");
    if (idField) {
      idField.value = "";
      idField.focus();
    }
    const btnText = document.getElementById("discord-auth-btn-text");
    if (btnText) btnText.innerText = "Connect with Discord";
    if (typeof updatePage2SubView === "function") updatePage2SubView();
    if (typeof validateDiscordId === "function") validateDiscordId("");
  });
};

const updatePage2SubView = () => {
  const toggleEl = document.getElementById("discord-toggle");
  const isNotifyEnabled = toggleEl ? toggleEl.checked : false;
  const nextBtn2 = document.getElementById("next-from-2");
  const partId = document.getElementById("discord-part-id");
  const partWebhook = document.getElementById("discord-part-webhook");

  chrome.storage.local.get(["discordId", "webhookUrl", "accountNickname", "discordUsername"], (data) => {
    if (!isNotifyEnabled) {
      if (partId) partId.style.display = "none";
      if (partWebhook) partWebhook.style.display = "none";
      if (nextBtn2) {
        nextBtn2.disabled = false;
        nextBtn2.className = "btn-action";
        nextBtn2.innerText = "NEXT";
      }
      return;
    }

    if (page2SubStep === "ID") {
      if (partId) partId.style.display = "block";
      if (partWebhook) partWebhook.style.display = "none";
      
      // Auto-fill and Disable logic
      const idInput = document.getElementById("discordId");
      if (idInput) {
        if (data.discordUsername) {
          // If connected, show the ID and disable the field
          idInput.value = data.discordId || "";
          idInput.disabled = true;
          idInput.style.opacity = "0.5";
          idInput.style.cursor = "not-allowed";
        } else {
          // If not connected, clear the field and enable it
          idInput.value = "";
          idInput.disabled = false;
          idInput.style.opacity = "1";
          idInput.style.cursor = "text";
        }
      }

      validateDiscordId(data.discordId || "");
      if (nextBtn2) nextBtn2.innerText = "NEXT";
    } else {
      if (partId) partId.style.display = "none";
      if (partWebhook) partWebhook.style.display = "block";
      validateWebhook(data.webhookUrl || "");
      const nicknameField = document.getElementById("accountNickname");
      if (nicknameField) nicknameField.value = data.accountNickname || "";
      if (nextBtn2) nextBtn2.innerText = "NEXT";
    }
  });
};

// Wire UI actions specific to the Discord subflow
document.addEventListener("DOMContentLoaded", () => {
  const saveWebhookBtn = document.getElementById("save-webhook-btn");
  if (saveWebhookBtn) {
    saveWebhookBtn.onclick = () => {
      const webhookField = document.getElementById("webhook");
      const val = webhookField ? webhookField.value.trim() : "";
      if (!val) {
        alert("Please enter a webhook URL.");
        return;
      }
      const nicknameField = document.getElementById("accountNickname");
      const nickname = nicknameField ? nicknameField.value.trim() : "";
      
      chrome.storage.local.set({ 
        webhookUrl: val, 
        notifyEnabled: true,
        accountNickname: nickname || undefined
      }, () => {
        validateWebhook(val);
        if (typeof updatePage2SubView === "function") updatePage2SubView();
        if (typeof updateSummaryBox === "function") updateSummaryBox();
        updateProgressBar(null, val);
        alert("Webhook saved.");
      });
    };
  }

  const discordSignout = document.getElementById("discord-signout-link");
  if (discordSignout) {
    discordSignout.addEventListener("click", (e) => {
      e.preventDefault();
      handleDiscordSignOut(e);
    });
  }

  const discordSwitch = document.getElementById("discord-switch-btn");
  if (discordSwitch) {
    discordSwitch.addEventListener("click", (e) => {
      e.preventDefault();
      handleDiscordSwitch(e);
    });
  }
});
