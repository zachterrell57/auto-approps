# form-filler (AutoApprops)

Desktop Electron app for mapping `.docx` content to web form fields (Google, Microsoft, and generic forms), with editable answer sheets and local session history.

## Alpha Scope

- Delivery target: Electron desktop app only.
- No always-on FastAPI backend is required for alpha use.
- Session auto-name generation via backend endpoint is disabled for alpha.

## Prerequisites

- Node.js 20+
- npm 10+
- macOS, Linux, or Windows with Electron support

## Setup

1. Install dependencies:
```bash
npm install
npm install --prefix frontend
```
2. Start the app in development:
```bash
npm start
```

## Release Gates (Local CI Equivalent)

Run all gates:
```bash
npm run check
```

Run individually:
```bash
npm run check:frontend-lint
npm run check:frontend-build
npm run check:electron-ts
```

## Storage and Privacy Notes (Alpha)

- API key, sessions, clients, and profile are stored locally on disk.
- Storage is currently plaintext for alpha.
- In-app `Settings -> Clear Local Data` removes local settings, sessions, clients, and profile.
- Keychain/encrypted storage is planned for post-alpha hardening.

## Known Limitations

- Login-gated forms (Google/Microsoft requiring authentication) are not supported.
- Microsoft branch-heavy forms are crawled along one deterministic path and may be partially captured.
- Mapping quality depends on model output and source quality; manual review is required before submission.
- Network timeouts or anti-bot controls on target forms can block scraping.

## Troubleshooting

- `Invalid form URL`:
  - Ensure URL is a full `http://` or `https://` URL.
- `Only .docx files are supported`:
  - Upload a `.docx` document only.
- `Set an Anthropic API key in Settings before processing`:
  - Add key in the Settings page and retry.
- `This form requires login`:
  - Use a publicly accessible form link.
- Missing or weak mappings:
  - Improve source document quality, add client context, then re-map.

## Smoke Test Checklist

See:
- [docs/alpha-smoke-tests.md](docs/alpha-smoke-tests.md)
