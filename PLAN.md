# Plan: Tella Transcript Recorder

Keep the Vite React + Node API architecture, but replace the Loom-specific integration with Tella's public API. The browser UI collects a video ID, and the server fetches that video's transcript from the Tella API using a server-side bearer token; the result is saved as a temporary JSON artifact in `temp/`.

## Steps

1. Remove Loom SDK dependencies and browser-only recorder assumptions. Keep the app shell and dev workflow around Vite + React + Node server.
2. Add a Tella transcript adapter at `src/tella-transcript.ts` that reads `TELLA_API_KEY` and optionally `TELLA_API_BASE_URL`, calls `GET /v1/videos/{id}`, validates that a transcript exists, and writes the transcript payload to a unique JSON file under `temp/`.
3. Update the server `POST /api/transcripts` route to validate a Tella `videoId` and return only safe metadata such as the file name and ID.
4. Update the React app to use a Tella-friendly flow: start a recording in Tella, paste the resulting video ID, then fetch the transcript. The app should gracefully report missing configuration and request errors without crashing.
5. Update `.env.example`, `README.md`, and this plan to use Tella environment names and API usage.
6. Keep the validation pipeline focused on transcript storage and server behavior with a mocked Tella response.

## Relevant Files

- `package.json` - keep React/Vite/server scripts and remove Loom-specific dependencies.
- `src/App.tsx` - Tella workflow state and browser UI.
- `src/server.ts` - transcript API endpoint and static server.
- `src/tella-transcript.ts` - Tella API adapter.
- `test/transcript.test.ts` - mocked Tella transcript contract.
- `.env.example` - `TELLA_API_KEY` and `TELLA_API_BASE_URL`.
- `README.md` - Tella setup and usage instructions.

## Verification

1. Run `npm test` and confirm the mocked Tella response writes a JSON file to `temp/`.
2. Run `npm run lint` and `npm run typecheck` to confirm the provider swap did not leave invalid TS or ESLint issues.
3. Start the app with `npm run dev` and confirm the UI shows the setup-check state when environment values are missing.
4. With a valid Tella API key configured, verify the server can fetch a video transcript and save it to `temp/`.
5. Run the production build and ensure the app still serves the frontend.

## Decisions

- Use Tella's public API rather than a browser SDK because Tella exposes API keys and server-side transcript access without requiring a browser embed.
- Keep the implementation server-side for secrets and file writing, as the browser cannot write to the project `temp/` directory safely.
- Treat the transcript shape as the `video.transcript` object returned by `GET /v1/videos/{id}` and persist that payload as JSON.
- Keep the workflow minimal and deterministic: real recording happens in Tella, and the connector handles transcript retrieval and local artifact creation.
- Scope excludes production deployment and database persistence; the current project is a local connector tool for transcript extraction.
