# Detection benchmark

Compares our engine with other PII models on the same Dutch text, scored the same way.

- `heldout.py` builds an independent test set from **invented** text with a complete
  answer key, so precision can be measured as well as recall.
- `run.py` runs the selected systems and stores their detections in `data/hits/`.
- `score.py` prints recall, precision, F1, traps hit and time per system, plus our engine
  combined with each model.

The second document is our own gold set in `docs/examples/`. Our recognizers were tuned
on it, so treat it as a home game: the independent set is the fairer comparison.

**Never add real documents or fragments of them to this directory.** Test sets with real
documents stay with the partner who owns them; only aggregated scores are shared.

## Running it

The models need a newer `transformers` than the engine, so use a separate environment:

```bash
cd packages/pii-engine
python3.11 -m venv bench/.venv && source bench/.venv/bin/activate
pip install -r bench/requirements.txt
```

Our engine is measured over HTTP, so start it in another terminal first
(`pii-engine`, see the main README). Then:

```bash
python bench/run.py anonimiseer bardsai-v3 gliner2-pii   # openai-pf is optional and slow
python bench/score.py
```

`anonimiseer-pii` measures our engine with its PII model layer switched on: start the
engine with `PII_ENGINE_ENABLE_PII_MODEL=true` (and `PII_ENGINE_ENABLE_SONAR=true`, as the
app does). Both `anonimiseer` systems refuse to run when the engine's configuration does not
match.

Models are downloaded from HuggingFace on first use (bardsai-v3 ~1.2 GB, gliner2-pii
~1.2 GB, openai-pf ~2.8 GB). Results of a run are recorded in `docs/benchmarks.md`.
