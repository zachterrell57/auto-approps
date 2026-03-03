# Alpha Smoke Tests

Use this checklist before cutting an alpha build.

## Build Validation

- [ ] `npm run check:frontend-lint` passes
- [ ] `npm run check:frontend-build` passes
- [ ] `npm run check:electron-ts` passes

## Core User Journeys

### 1) Upload -> Scrape -> Map -> Save -> Reload

- [ ] Open app and set Anthropic API key in Settings.
- [ ] Upload a valid `.docx` file and provide a valid public form URL.
- [ ] Confirm scraper completes and answer sheet renders.
- [ ] Edit at least one mapping value.
- [ ] Confirm session appears in sidebar history.
- [ ] Select another page and return to the session.
- [ ] Reload historical session from sidebar and confirm:
  - [ ] document preview loads,
  - [ ] edited mappings persist.

### 2) Rename Session Persistence

- [ ] Rename a session from the sidebar.
- [ ] Restart the app.
- [ ] Confirm renamed display name persists.

### 3) Provider Routing

- [ ] Google Forms URL routes to Google scraper.
- [ ] Microsoft Forms URL routes to Microsoft scraper.
- [ ] Non-Google/Microsoft URL routes to generic scraper.

### 4) Checkbox Mapping Behavior

- [ ] Use a form with a checkbox field containing multiple valid options.
- [ ] Confirm mapped answer preserves multiple selections (normalized format).

### 5) Multi-Session In-Progress Persistence

- [ ] Start mapping in Session A and confirm sidebar shows `Mapping...`.
- [ ] Create Session B, start mapping, then switch back to Session A before either mapping completes.
- [ ] Confirm Session A still shows processing UI (not blank `Map Form` page) and sidebar status remains `Mapping...`.
- [ ] Keep Session B active until Session A finishes in background.
- [ ] Confirm app stays on Session B; Session A status updates to `Review`; selecting Session A opens the answer sheet.
- [ ] While a workflow is mapping, navigate to Settings, Profile, and Clients, then return.
- [ ] Confirm the workflow resumes prior in-progress/completed UI state with no reset.

## Failure Path Checks

- [ ] Invalid URL shows actionable error.
- [ ] Non-`.docx` upload is rejected.
- [ ] Missing API key prevents processing with clear guidance.
- [ ] Login-gated form reports unsupported-access error.
- [ ] Empty/low-confidence mapping output is visible for manual correction.
- [ ] Timeout/fetch failure shows actionable scraping error.

## Data Safety UX

- [ ] Settings page shows plaintext-storage disclosure.
- [ ] `Clear Local Data` removes sessions, clients, profile, and API key locally.
