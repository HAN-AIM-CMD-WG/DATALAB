# End-to-end tests

`run.js` drives the real app with Playwright through onboarding and all four wizard steps,
with a Markdown dossier, a Word intake form and a PDF letter. On the way it installs PDF
support from the notice in step 1, confirming the licence, and imports and removes an
organisation profile. Then it checks what landed on disk:

- no personal data left in the anonymised Markdown (against `docs/examples`), including the
  birth dates and the link to a person, which are masked by default,
- no personal data left in the Word text or its document properties, nor in the PDF,
- the run directory is `0700` and every file in it `0600` (skipped on Windows, where the
  user profile's ACLs apply),
- the audit log holds file names, not full paths, and reports no replacement that failed
  to land,
- restoring the run gives back the original Markdown and Word text,
- no errors in the renderer console.

The engine's settings and the downloaded PDF support go to `e2e/.tmp`, not to
`~/.anonimiseer`, so a run neither depends on nor changes your own settings. PDF support is
downloaded from PyPI on every run (~24 MB).

`crashtest.sh` kills a packaged app with `SIGKILL` and checks that the engine goes down with
it and that the app starts again afterwards.

All fixtures are invented. Never use real documents here.

## Running

```bash
cd apps/electron-anonimiseer
../../packages/pii-engine/.venv/bin/python e2e/make_fixture.py   # once; Word and PDF fixtures

# against the dev build: start the engine yourself first (pii-engine), then
npm run build && npm run e2e

# against a packaged build: the app starts its own engine
E2E_EXECUTABLE=release/mac-arm64/Anonimiseer.app/Contents/MacOS/Anonimiseer npm run e2e
bash e2e/crashtest.sh release/mac-arm64/Anonimiseer.app/Contents/MacOS/Anonimiseer
```

Screenshots of every step end up in `e2e/.tmp/shots/`. A check that fails prints what leaked;
the exit code is non-zero.
