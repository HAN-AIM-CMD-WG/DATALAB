# Benchmarks

How detection quality, robustness and output safety are measured, and the results per
milestone. Everything here can be reproduced with `packages/pii-engine/bench/` and
`apps/electron-anonimiseer/e2e/`. All test data is invented.

## Baseline — 30 October 2026 (before v0.2.0)

**Setup.** Engine 0.1.1 as shipped in the packaged app (PyInstaller bundle):
presidio-analyzer 2.2.362, spaCy `nl_core_news_lg` 3.8.0, SoNaR-BERT loaded, threshold
0.50 (the app default). Comparison models: `bardsai/eu-pii-anonimization-multilang-v3`
(revision `091984b5fbce`), `fastino/gliner2-privacy-filter-PII-multi` (`1cb4166094dc`,
threshold 0.3), `openai/privacy-filter` (`7ffa9a043d54`). Apple Silicon laptop, CPU only.

"+" rows are the plain union of both systems' detections, without any extra validation.

### Independent test set — 36 personal data items, 10 traps

| System | Recall | Precision | F1 | Traps hit | Time |
|---|---|---|---|---|---|
| Anonimiseer | 88.9% | 97.4% | 0.929 | 1/10 | 1.0 s |
| bardsai v3 | 100.0% | 95.2% | 0.976 | 1/10 | 1.7 s |
| GLiNER2-PII | 83.3% | 100.0% | 0.909 | 0/10 | 0.7 s |
| OpenAI Privacy Filter | 88.9% | 94.4% | 0.916 | 2/10 | 5.5 s |
| Anonimiseer + bardsai v3 | 100.0% | 96.2% | 0.981 | 2/10 | 2.7 s |
| Anonimiseer + GLiNER2-PII | 97.2% | 98.6% | 0.979 | 1/10 | 1.7 s |
| Anonimiseer + OpenAI Privacy Filter | 97.2% | 95.9% | 0.966 | 3/10 | 6.5 s |

### Own gold set (`docs/examples`) — 134 items in scope, 53 traps

Our recognizers were tuned on this document, so it is a home game. Its answer key is not
exhaustive, hence no precision.

| System | Recall | Traps hit | Time |
|---|---|---|---|
| Anonimiseer | 99.3% | 1/53 | 0.7 s |
| bardsai v3 | 94.8% | 1/53 | 2.6 s |
| GLiNER2-PII | 98.5% | 0/53 | 4.1 s |
| OpenAI Privacy Filter | 97.0% | 6/53 | 65.4 s |
| Anonimiseer + bardsai v3 | 100.0% | 2/53 | 3.3 s |
| Anonimiseer + GLiNER2-PII | 100.0% | 1/53 | 4.9 s |

### What our engine gets wrong

- **Missed:** a first name on its own ("Yusuf"), initials with a double surname
  ("C.J. Hoekstra-Visser"), one of two mentions of a full name in an e-mail header,
  a phone number with the area code in brackets ("(030) 765 43 21"), and on the own set one
  city in an address after SoNaR was loaded (overlap resolution).
- **False positives:** a number followed by two capitals read as a postcode
  ("2400 GB opslag", "1600 MB").
- The models fail elsewhere: bardsai v3 reads a nine-digit order number as a personal
  identifier (Elfproef would reject it) and misses a BSN and postcodes our rules always
  catch; GLiNER2-PII misses most first names on their own. The systems complement each other.

### End-to-end, packaged app (macOS arm64)

| Check | Result |
|---|---|
| Run directory only readable by the user (0700) | PASS |
| Every output file only readable by the user (0600) | **FAIL** — the anonymised `.docx` is 0644 |
| Markdown: no personal data left (default categories) | **FAIL** — one city in an address |
| Word: no personal data left in the text | **FAIL** — the contact person in a table cell |
| Word: no personal data left in the document properties | **FAIL** — author and title |
| No errors in the renderer console | PASS |

### Crash test, packaged app

Start, `SIGKILL` the app, check the engine stops, restart: all PASS.

### Custom concepts

Can a model find concepts it was not trained on (`bench/custom_labels.py`, five look-alike
reference numbers plus persons and an organisation)? `gliner2-privacy-filter-PII-multi`
and `gliner2-multi-v1` both found 9/9 with no wrong detections and kept the look-alikes
apart. A separate model for custom concepts is not needed.

## After phase 1 — 30 October 2026

**Setup.** As the baseline, with this branch's engine bundled and the app rebuilt (version
number still 0.1.1). The comparison models were not rerun; their rows above still apply.
Baseline values in brackets.

### Independent test set — 36 personal data items, 10 traps

| System | Recall | Precision | F1 | Traps hit | Time |
|---|---|---|---|---|---|
| Anonimiseer | 97.2% (88.9%) | 97.6% (97.4%) | 0.974 (0.929) | 0/10 (1/10) | 2.1 s |
| Anonimiseer + bardsai v3 | 100.0% | 96.4% | 0.982 | 1/10 | 3.8 s |
| Anonimiseer + GLiNER2-PII | 100.0% | 98.7% | 0.993 | 0/10 | 2.8 s |
| Anonimiseer + OpenAI Privacy Filter | 100.0% | 96.1% | 0.980 | 2/10 | 7.6 s |

### Own gold set (`docs/examples`) — 134 items in scope, 53 traps

| System | Recall | Traps hit | Time |
|---|---|---|---|
| Anonimiseer | 100.0% (99.3%) | 0/53 (1/53) | 0.8 s |
| Anonimiseer + bardsai v3 | 100.0% | 1/53 | 3.4 s |
| Anonimiseer + GLiNER2-PII | 100.0% | 0/53 | 5.0 s |

### What changed

- Now found: the first name on its own, the initials with a double surname, the second
  mention in the e-mail header, and the city in an address next to a postcode. The causes
  were detections running across a blank line (a paragraph or table cell) and detections
  dropped whole when they partly overlapped a postcode or e-mail address.
- "2400 GB" and "1600 MB" are no longer postcodes.
- Still missed: a phone number with the area code in brackets ("(030) 765 43 21").
- The one remaining false positive is a place in a letter's dateline ("Zwolle, 9 oktober
  2026"), which the answer key does not count as personal data.

### End-to-end, packaged app (macOS arm64)

| Check | Result |
|---|---|
| Run directory only readable by the user (0700) | PASS |
| Every output file only readable by the user (0600) | PASS |
| Markdown: no personal data left (default categories) | PASS |
| Markdown: birth dates and links to a person masked by default | PASS |
| Word: no personal data left in the text | PASS |
| Word: no personal data left in the document properties | PASS |
| Audit log holds file names, not full paths | PASS |
| Every accepted replacement was applied | PASS |
| No errors in the renderer console | PASS |

Crash test: all PASS.

## After phase 3 — 31 October 2026

**Setup.** As phase 1, with presidio-analyzer 2.2.366 and this branch's engine bundled.
New are two optional model layers, both off until the user downloads and enables them:
the PII model (`bardsai/eu-pii-anonimization-multilang-v3`, with our validation on top) and
an organisation profile's own terms (`fastino/gliner2-privacy-filter-PII-multi`).
"With PII model" is the engine with that layer on, not a plain union of two systems.

Presidio 2.2.362 → 2.2.366 gave identical detections on both sets.

### Independent test set — 36 personal data items, 10 traps

| System | Recall | Precision | F1 | Traps hit | Time |
|---|---|---|---|---|---|
| Anonimiseer | 97.2% | 97.6% | 0.974 | 0/10 | 0.7 s |
| Anonimiseer with PII model | 100.0% | 97.7% | 0.988 | 0/10 | 1.0 s |

### Own gold set (`docs/examples`) — 134 items in scope, 53 traps

| System | Recall | Traps hit | Time |
|---|---|---|---|
| Anonimiseer | 100.0% | 0/53 | 0.9 s |
| Anonimiseer with PII model | 100.0% | 0/53 | 3.8 s |

### What changed

- The PII model adds the phone number with the area code in brackets, the last item the
  engine missed on the independent set.
- Validation keeps the model's errors out: the plain union with bardsai v3 hit one trap on
  each set (nine digits read as an identifier, though they fail the Elfproef); with the PII
  model layer that is zero, because nine digits must pass the Elfproef. Phone numbers need 10–15 digits, IBANs
  must pass MOD-97, card numbers Luhn, and a model detection is widened to whole words.
- The remaining false positive is still the place in the letter's dateline.

### Own terms

The invented example profile (`docs/examples/profiel-voorbeeld.json`: a dossier number and a
project code) on both sets. Neither set contains such numbers, so every term detection would
be a false alarm.

- Independent set: none.
- Own set: none. Before a fix, seven codes were labelled as dossier numbers or project codes:
  a case and a patient number, two course codes, a CROHO code and two student numbers. Our
  rules already masked all seven; on the same span their label now wins over a term.
- Time with the PII model and own terms both on: 0.8–0.9 s on the independent set (1,677
  characters), 6.7–7.1 s on the own set (9,273 characters).

### Targets

Recall at least 99% on the own set and 97% on the independent set, precision at least 92%,
at most 10 s per document on a laptop CPU: met with and without the model layers. The times
are from an Apple Silicon laptop; a slower CPU will need more for a long document with both
layers on.

### End-to-end, packaged app (macOS arm64)

All 14 checks PASS, including restoring the run's Markdown and Word output; crash test all
PASS.

### Measuring notes

- Measure the engine as users get it. A dev engine started with `HF_HOME` pointing elsewhere
  silently runs without SoNaR; check the log for `SoNaR NER-model geladen`. SoNaR is also
  off unless `PII_ENGINE_ENABLE_SONAR=true` is set; the app sets it.
- Make sure no older engine is still listening on port 8765 before a run; a new one cannot
  bind the port and the benchmark then measures the old code.
- Start a measuring engine with `ANONIMISEER_RUNTIME_CONFIG` pointing at a temporary file.
  Switching the PII model or a profile on for a run is then not saved into the app's own
  settings.
- A personal data item counts as found when at least 80% of its characters are covered;
  precision counts a detection as correct when it overlaps any personal data item.
