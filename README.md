# Client Notes Automation

A local app that takes a Tella video ID, generates action points from its transcript with Claude, and writes them to one of two configured Google Sheets.

## Requirements

- Node.js 22 or newer
- Access to the Tella Public API
- A Claude Pro, Max, Team, or Enterprise account
- A Google Cloud project with the Google Sheets API enabled

## Configure

Copy the example environment file:

```sh
cp .env.example .env
```

Create the required credentials:

- **Tella API key:** In [Tella API Keys](https://www.tella.tv/settings/api-keys), choose **Create key**. See the [Tella API quickstart](https://www.tella.com/docs/quickstart).
- **Claude token:** Run `npx @anthropic-ai/claude-code setup-token` and follow the browser prompt. See [Claude Code token setup](https://code.claude.com/docs/en/iam#generate-a-long-lived-token).
- **Google Sheets API:** Enable the [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com) in your Google Cloud project.

### Configure Google service account access

1. In the Google Cloud project where you enabled the Sheets API, create a service account from [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts). This app only accesses the specific spreadsheets shared with that account; you do not need to grant it a project-wide IAM role.
2. Create and download a JSON key by following Google's [service account key instructions](https://cloud.google.com/iam/docs/keys-create-delete). Keep the key outside the repository in a private local folder, for example `~/.config/client-notes-automation/service-account.json`. Create the folder with `mkdir -p ~/.config/client-notes-automation`, move the downloaded key there, then restrict access with `chmod 700 ~/.config/client-notes-automation` and `chmod 600 ~/.config/client-notes-automation/service-account.json`. Anyone with this key can act as the service account.
3. Open the JSON key locally and copy its `client_email` value. Share each destination spreadsheet with that email address and give it **Editor** access. Sharing with your personal Google account alone does not grant access to the service account.
4. Set `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` to the absolute path of the downloaded JSON key file.

Set these values in `.env`:

```dotenv
TELLA_API_KEY=
CLAUDE_CODE_OAUTH_TOKEN=
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/absolute/path/to/service-account.json
GOOGLE_MONDAY_CLIENT_NOTES_SPREADSHEET_ID=
GOOGLE_SUNDAY_CLIENT_NOTES_SPREADSHEET_ID=
```

Get each spreadsheet ID from its URL. Both IDs are required and must be different. Keep the JSON key private and never commit it or paste it into chat, logs, or frontend code. The app uses the Google Sheets API scope with the `googleapis` 182.0.0 client and its `google-auth-library` 11.1.0 dependency; those libraries obtain and refresh short-lived access tokens using the service account key. No OAuth consent screen, redirect URL, or user refresh token is needed.

Optional settings: `TELLA_API_BASE_URL` defaults to `https://api.tella.com/v1`, `PORT` defaults to `3001`, and `LOG_LEVEL` defaults to `info`. Google Sheets upstream error messages are recorded at `DEBUG` level; use `LOG_LEVEL=debug` to see them. Provider response bodies and stacks are not logged.

## Run

```sh
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), enter a Tella video ID, and generate action points. Select a configured spreadsheet and worksheet tab to write the result. Transcript and action-point files are temporary and saved under `temp/`.

## Checks and production

```sh
npm run lint
npm run typecheck
npm test
npm run build
NODE_ENV=production npm start
```
