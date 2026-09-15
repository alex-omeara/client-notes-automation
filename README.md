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
4. Optionally set `TELLA_API_BASE_URL` if you need a custom host or staging value.
5. Install dependencies:

	```sh
	npm install
	```

## Commands

Start the Vite frontend and local API together:

```sh
npm run dev
```

Open `http://localhost:5173`. Enter the Tella video ID in the UI, then choose `Generate action points from video transcript`. The server calls `GET https://api.tella.com/v1/videos/{id}`, writes the transcript payload to `temp/`, sends its text to Claude with a generic action-point prompt, and writes the complete Claude response as Markdown and JSON files.

The browser does not receive or require the Tella API key. Tella and Claude credentials are read by the server from the environment when the transcript request is submitted.

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

The server uses Tella's public API with bearer-token auth. It reads the transcript from the video detail response and stores the full transcript payload as JSON under `temp/` without exposing the secret in the browser bundle. It then uses the Claude Agent SDK with `CLAUDE_CODE_OAUTH_TOKEN` to generate action points and stores both the final response text and SDK result metadata under `temp/`.
