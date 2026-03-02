# Privacy Policy — ForgeField

**Last updated:** February 2025

ForgeField ("the extension") is a browser extension that connects your SKPORT session with Google Apps Script and Discord for automation and notifications. This policy describes what data the extension uses and where it is stored.

## Data we collect and use

- **Google account:** When you connect Google, we use OAuth to obtain access tokens. We request only the scopes needed for the extension: creating and updating Apps Script projects and deployments, allowing the deployed script to make outbound requests (e.g. to SKPORT and Discord), and reading/writing Drive files for the script project. We do not request or use `script.processes` (viewing or managing running script executions). We do not access your email, calendar, or other Google data beyond the scopes you approve.
- **Discord account:** When you connect Discord, we use OAuth to obtain an access token and to fetch your Discord user id and username (and optionally avatar) for display in the extension. We do not access your servers, messages, or other Discord data beyond the "identify" scope.
- **SKPORT:** The extension reads your game session from the SKPORT website (via cookies and in-page storage) when you have the site open, so it can show connection status and optionally trigger automation. We do not send this data to any server we control.
- **Webhook URL and preferences:** If you optionally set a Discord webhook URL or nickname, these are stored locally in your browser and used only to send notifications you configure (e.g. claim reminders). We do not collect or store these on our own servers.

## Where data is stored

All data used by the extension is stored **locally in your browser** using the browser’s built-in storage (e.g. `chrome.storage.local`). We do not operate servers that collect or store your personal data. Tokens and preferences never leave your device except:

- When making requests to Google, Discord, or SKPORT APIs as part of the extension’s features.
- When you use the optional webhook feature, the webhook URL is used only to send messages to a Discord channel you specify.

## Data we do not sell or share

We do not sell, rent, or share your personal data with third parties for advertising or marketing. We do not use your data for any purpose other than providing the extension’s functionality (Google Apps Script deployment, Discord identity display, SKPORT connection status, and optional notifications).

## Permissions

The extension requests permissions (e.g. identity, storage, cookies, access to specific sites) only to implement the features described above. For a short justification of each permission, see [PERMISSIONS.md](PERMISSIONS.md).

## Changes

We may update this privacy policy from time to time. The "Last updated" date at the top will be revised when we do. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Contact

If you have questions about this privacy policy or the extension’s data practices, please open an issue in the extension’s repository or contact the developer via the support channel listed in the store listing.
