# Hearing Intelligence Integration Plan

Generated: May 15, 2026

## Repo Audit Summary

The existing app is a local-first Electron desktop app. It does not have a server, production auth, organizations, roles, durable background workers, notification infrastructure, or formal database migrations. The Hearing Intelligence MVP therefore integrates as a local Electron module and records the production gaps explicitly.

## Reused Modules

- Client context: `electron/services/client-store.ts` and `frontend/src/hooks/useClients.ts`.
- Settings/secrets: `electron/services/settings-store.ts` and `electron/services/config.ts`.
- Local persistence: `better-sqlite3` pattern from `electron/services/session-store.ts`.
- IPC boundaries: `electron/ipc-channels.ts`, `electron/ipc-handlers.ts`, `electron/preload.ts`, `frontend/src/global.d.ts`, and `frontend/src/lib/api.ts`.
- AI provider pattern: Anthropic structured tool-use from `electron/services/mapper.ts`.
- Export/download flow: main-process bytes returned over IPC and downloaded by the renderer.
- Styling/state: React hooks plus Tailwind/shadcn-style primitives used by the existing workflow and client pages.

## New Modules

- `electron/services/hearing-models.ts`: Zod schemas for hearing jobs, transcript segments, watch items, hits, outputs, claims, comments, workspace payloads, and exports.
- `electron/services/hearing-store.ts`: SQLite tables for `hearing_jobs`, `hearing_transcript_segments`, `hearing_watch_items`, `hearing_watch_hits`, `hearing_outputs`, `hearing_claims`, `hearing_comments`, audit events, and congressional-context cache.
- `electron/services/hearing-source-resolver.ts`: URL resolver for official House/Senate pages, Congress.gov, GovInfo, official committee YouTube links, and fallback public archives with reliability tiers.
- `electron/services/hearing-live-capture.ts`: Local livestream capture coordinator using `yt-dlp`/`ffmpeg` for audio chunking, plus incremental watchlist refresh.
- `electron/services/hearing-live-transcription.ts`: Managed OpenAI transcription adapter for live audio chunks.
- `electron/services/congressional-context.ts`: Congress.gov and GovInfo API wrappers with local cache and bill-reference normalization.
- `electron/services/hearing-transcript.ts`: Transcript normalization utilities for manual recovery imports and generated live ASR segments.
- `electron/services/hearing-watchlist.ts`: Exact, alias, acronym, normalized bill, and lightweight semantic matching with pre/post hit windows.
- `electron/services/hearing-ai.ts`: Full memo, targeted recap, transcript/mention output, and pre-hearing brief generation with claim schemas and verification flags.
- `electron/services/hearing-export.ts`: Markdown, HTML/email, CSV, JSON, transcript text, DOCX, and PDF export.
- `electron/services/hearing-intelligence.ts`: Module orchestration.
- `frontend/src/components/HearingIntelligencePage.tsx`: Analyst workspace for live stream resolution, capture, watchlist, review, comments, and exports.
- `frontend/src/hooks/useHearingJobs.ts`: Renderer-side job/workspace actions.

## Technical Decisions

### Live Stream Transcription

Hearings now default to live committee video ingestion. Analysts create a job from the committee page URL, resolve the embedded official stream or committee YouTube stream, start capture, and stop capture when the hearing ends. The app chunks audio locally with `yt-dlp`/`ffmpeg`, sends closed chunks to OpenAI speech-to-text, stores `live_asr` transcript segments with time offsets, and refreshes watchlist hits while capture is running. Final memo generation happens after capture stops.

### AI Provider

The app reuses the existing Anthropic setup and model config. AI output uses a required tool schema, grounded claims, supporting segment IDs, external official sources, confidence, and verification status. If no Anthropic key is configured, the module still produces deterministic draft packages from transcript/watchlist/context so review and export workflows remain testable.

### Congressional Data Sources

Official context wrappers target:

- Congress.gov API for bills, summaries, committees, and related metadata.
- GovInfo API for official congressional documents and hearing records.
- House Committee Repository and Senate hearing pages through source resolution.

API responses are cached in `hearing_congressional_cache`. `CONGRESS_GOV_API_KEY`, `GOVINFO_API_KEY`, `CURRENT_CONGRESS`, `OPENAI_API_KEY`, `HEARING_TRANSCRIPTION_MODEL`, and `HEARING_LIVE_CHUNK_SECONDS` can be configured through environment variables; OpenAI can also be configured in Settings.

### Retention

`HEARING_RETENTION_DAYS` controls local purging of hearing jobs, transcript segments, watchlist hits, outputs, comments, and claims. `0` preserves data until the user clears local data from Settings.

### Persistence and Migrations

The module follows the existing app’s local SQLite pattern and creates tables with `CREATE TABLE IF NOT EXISTS`. This is appropriate for the current desktop alpha. Production should replace this with versioned migrations, tenant-aware database design, encrypted secrets, role checks, and retention policies.

## Production Gaps

- No production authentication, organizations, RBAC, or matter permissions exist in the repo.
- Client isolation is local-process scoping, not server-enforced multi-tenancy.
- API keys remain plaintext alpha settings unless the app is hardened.
- Live capture is local-process state; capture sessions do not survive app restarts.
- Email, Slack, and in-app notifications are not available beyond local UI state.
- Human review is supported in UI, but enforcement before export is policy-level for now.

## Implementation Boundary

The MVP delivers a coherent local module: create a hearing job from URL and client, resolve the committee livestream, capture/transcribe live audio chunks, configure watchlists, detect hits, generate cited outputs after capture stops, review/edit/verify/comment, and export memo packages. Production hardening requires the listed platform capabilities.
