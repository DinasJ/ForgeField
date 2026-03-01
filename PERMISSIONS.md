# Permission justifications — ForgeField

Use these one-line explanations when filling out the Chrome Web Store, Edge Add-ons, or Firefox AMO permission justification fields.

## Permissions

| Permission   | Justification |
|-------------|----------------|
| **identity** | Required to run Google and Discord OAuth sign-in flows and obtain tokens for linking accounts. |
| **storage**   | Used to save your linked accounts, preferences, and deployment state locally so the extension works across popup opens. |
| **cookies**   | Used to read your SKPort session cookie so the extension can show Endfield connection status and sync with the game. |
| **scripting** | Used to read the game role from the SKPort page when you have it open, so the extension can display connection status. |
| **tabs**      | Used to open the SKPort sign-in page, the Google Apps Script editor, and the Google access-grant page when you click the extension’s buttons. |
| **activeTab** | Used when reading the current tab’s URL or content only after you interact with the extension (e.g. sync from open SKPort tab). |

## Host permissions

| Host / pattern | Justification |
|----------------|----------------|
| **https://discord.com/api/\*** | Required to authenticate with Discord OAuth and fetch your Discord username/avatar after you connect. |
| **https://accounts.google.com/\*** | Required for Google OAuth sign-in when you link your Google account. |
| **https://oauth2.googleapis.com/\*** | Used to obtain and refresh Google OAuth tokens. |
| **https://script.google.com/\*** | Used to open the Apps Script editor and manage your deployed script. |
| **https://script.googleapis.com/\*** | Used to create/update Apps Script projects and deployments via the Google APIs. |
| **https://script.googleusercontent.com/\*** | Used when the extension or your deployed web app makes requests to the deployed script’s URL. |
| **\*://\*.skport.com/\*** | Required to read your Endfield/SKPort session (cookies and in-page data) so the extension can show connection status and sync. |
| **https://\*.allizom.org/\*** | Used for Firefox OAuth redirect when linking your Google account in Firefox. |
| **https://\*.chromiumapp.org/\*** | Used for Chrome/Edge OAuth redirect URLs when linking Google or Discord. |

## OAuth2 scopes (Google)

These appear in the manifest for Google sign-in. You may need to describe them in the Google Cloud Console or store listing:

- **script.projects / deployments / processes / external_request** — To create and update your Apps Script project and deployment.
- **drive.metadata.readonly / drive.file / drive.scripts** — To create the script in Drive and deploy it as a web app the extension can call.
