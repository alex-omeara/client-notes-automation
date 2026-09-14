# Client Report Connector

A Vite React app that records a Tella video and saves the transcript as a temporary JSON file under `temp/`.

## Prerequisites

- Node.js 22 or newer
- A Tella workspace with access to the Public API
- A Tella API key from Settings > API Keys

## Setup

1. Create a local environment file:

	```sh
	cp .env.example .env
	```

2. Set `TELLA_API_KEY` to your Tella bearer token. Keep it server-side.
3. Optionally set `TELLA_API_BASE_URL` if you need a custom host or staging value.
4. Install dependencies:

	```sh
	npm install
	```

## Commands

Start the Vite frontend and local API together:

```sh
npm run dev
```

Open `http://localhost:5173`. Enter the Tella video ID in the UI, then request the transcript export. The server calls `GET https://api.tella.com/v1/videos/{id}` with the bearer token and writes the transcript payload to `temp/`.

## Checks and production build

```sh
npm run lint
npm run typecheck
npm test
npm run build
NODE_ENV=production npm start
```

The production server serves the compiled frontend and handles `POST /api/transcripts`. Transcript files are intentionally temporary and ignored by Git.

## Transcript API boundary

The server uses Tella's public API with bearer-token auth. It reads the transcript from the video detail response and stores the full transcript payload as JSON under `temp/` without exposing the secret in the browser bundle.
