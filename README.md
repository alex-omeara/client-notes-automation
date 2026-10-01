# Client Notes Automation

A Vite React app that accepts a Tella video ID, saves its transcript, and uses Claude to generate action points as temporary files under `temp/`.

## Prerequisites

- Node.js 22 or newer
- A Tella workspace with access to the Public API
- A Tella API key from Settings > API Keys
- A Claude Pro, Max, Team, or Enterprise subscription with a `CLAUDE_CODE_OAUTH_TOKEN`

## Setup

1. Create a local environment file:

	```sh
	cp .env.example .env
	```

2. Set `TELLA_API_KEY` to your Tella bearer token. Keep it server-side.
3. Generate a Claude Code OAuth token with `npx @anthropic-ai/claude-code setup-token` and set `CLAUDE_CODE_OAUTH_TOKEN`. This uses the CLI temporarily through `npx`; no standalone Claude installation is required. Keep the token server-side. The token is subject to your subscription usage limits.
4. Create a Google Cloud OAuth 2.0 Client ID for a web app associated with your personal Google account. Add the local redirect URI for your app (for example `http://localhost:5173`) and keep the client ID + client secret server-side.
5. Generate a refresh token for the Google account and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN`. Set both `GOOGLE_MONDAY_CLIENT_NOTES_SPREADSHEET_ID` and `GOOGLE_SUNDAY_CLIENT_NOTES_SPREADSHEET_ID` to their distinct spreadsheet IDs. Both are required; a missing or duplicate ID is an error. The app offers configured names in a dropdown, then loads worksheet tabs for the selected spreadsheet. IDs remain server-side.
6. Optionally set `TELLA_API_BASE_URL` if you need a custom host or staging value.
7. Install dependencies:

	```sh
	npm install
	```

## Commands

Start the Vite frontend and local API together:

```sh
npm run dev
```

Open `http://localhost:5173`. Enter the Tella video ID in the UI, then choose `Generate action points from video transcript`. The server calls `GET https://api.tella.com/v1/videos/{id}`, writes the transcript payload to `temp/`, sends its text to Claude with a generic action-point prompt, and writes the complete Claude response as Markdown and JSON files.

The browser does not receive or require the Tella API key or spreadsheet IDs. Tella, Claude, Google OAuth credentials, and spreadsheet IDs are read by the server from the environment when needed.

## Application logging

The server uses Pino for operational logs. Local development prints human-readable, single-line events to stdout/stderr; production writes structured JSON for deployment-managed collection. Set `LOG_LEVEL` to `fatal`, `error`, `warn`, `info` (default), `debug`, `trace`, or `silent`. Deployments should collect and retain stdout logs through their process or platform logging service.

Each HTTP request receives an opaque request ID in the `X-Request-Id` response header. Server errors also include that ID in the response body so an operator can correlate a report with request and workflow-stage events. Events include the event name, service/environment, request ID when applicable, stage, status, duration, safe error class/code, and safe counts. Claude result failures also include the SDK result subtype and numeric API status when available. Provider messages, error stacks, and response bodies are not logged.

Request bodies, transcript text, generated action points, credentials, authorization headers, provider response bodies and messages, error messages and stacks, client recording identifiers, filenames, and local filesystem paths are intentionally excluded from application logs. Error metadata is allowlisted to error class, numeric status, and conservative scalar error codes. Do not add excluded values to future log fields. Browser-side telemetry is not enabled.

## Checks and production build

```sh
npm run lint
npm run typecheck
npm test
npm run build
NODE_ENV=production npm start
```

The production server serves the compiled frontend and handles `POST /api/transcripts`. Transcript and action-point files are intentionally temporary and ignored by Git.

## Transcript API boundary

The server uses Tella's public API with bearer-token auth. It reads the transcript from the video detail response and stores the full transcript payload as JSON under `temp/` without exposing the secret in the browser bundle. It then uses the Claude Agent SDK with `CLAUDE_CODE_OAUTH_TOKEN` to generate action points, stores both the final response text and SDK result metadata under `temp/`, and appends the resulting list entries to a Google Sheet using the configured OAuth client ID credentials.
