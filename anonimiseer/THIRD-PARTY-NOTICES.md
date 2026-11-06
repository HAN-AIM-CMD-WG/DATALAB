# Onderdelen van derden

Anonimiseer bestaat voor een groot deel uit werk van anderen. Hieronder staat wat er
in de installer zit en wat de app pas op jouw verzoek downloadt, met de licentie.
Gegenereerd door `scripts/third_party_notices.py`; de volledige licentieteksten
zitten in de app, onder Hulp → Licenties.

## Modellen in de installer

| Model | Licentie | Bron |
|---|---|---|
| spaCy nl_core_news_lg 3.8.0 | CC BY-SA 4.0 | https://spacy.io/models/nl |
| bardsai/eu-pii-anonimization-multilang-v3 (091984b5) | Apache-2.0 | https://huggingface.co/bardsai/eu-pii-anonimization-multilang-v3 |

## Alleen op verzoek gedownload

Deze zitten niet in de installer. De app vraagt eerst om bevestiging en toont de licentie.

| Onderdeel | Licentie | Bron |
|---|---|---|
| PyMuPDF 1.27.2.2 (PDF-ondersteuning) | AGPL-3.0 of een commerciële licentie | https://github.com/pymupdf/PyMuPDF/blob/main/COPYING |
| wietsedv/bert-base-dutch-cased-finetuned-sonar-ner (SoNaR-BERT) | geen licentie vermeld | https://huggingface.co/wietsedv/bert-base-dutch-cased-finetuned-sonar-ner |
| fastino/gliner2-privacy-filter-PII-multi (eigen begrippen) | Apache-2.0 | https://huggingface.co/fastino/gliner2-privacy-filter-PII-multi |

Lokale taalmodellen via Ollama kies je zelf; elk heeft een eigen licentie, die Ollama
bij het model vermeldt.

## Python-pakketten in de engine (80)

| Pakket | Versie | Licentie |
|---|---|---|
| annotated-doc | 0.0.4 | MIT |
| annotated-types | 0.7.0 | MIT License |
| anyio | 4.13.0 | MIT |
| blis | 1.3.3 | BSD |
| catalogue | 2.0.10 | MIT |
| certifi | 2026.2.25 | MPL-2.0 |
| cffi | 2.0.0 | MIT |
| charset-normalizer | 3.4.7 | MIT |
| click | 8.3.2 | BSD-3-Clause |
| cloudpathlib | 0.23.0 | MIT License |
| confection | 1.3.3 | MIT |
| cryptography | 50.0.2 | Apache-2.0 OR BSD-3-Clause |
| cymem | 2.0.13 | MIT |
| et_xmlfile | 2.0.0 | MIT |
| fastapi | 0.136.0 | MIT |
| filelock | 3.29.0 | MIT |
| fsspec | 2026.3.0 | BSD-3-Clause |
| gliner2 | 2.1.0 | Apache-2.0 |
| h11 | 0.16.0 | MIT |
| hf-xet | 1.4.3 | Apache-2.0 |
| httpcore | 1.0.9 | BSD-3-Clause |
| httptools | 0.7.1 | MIT |
| httpx | 0.28.1 | BSD-3-Clause |
| huggingface_hub | 1.11.0 | Apache-2.0 |
| idna | 3.11 | BSD-3-Clause |
| Jinja2 | 3.1.6 | BSD License |
| lxml | 6.1.0 | BSD-3-Clause |
| markdown-it-py | 4.0.0 | MIT License |
| MarkupSafe | 3.0.3 | BSD-3-Clause |
| mdurl | 0.1.2 | MIT License |
| mpmath | 1.3.0 | BSD |
| murmurhash | 1.0.15 | MIT |
| networkx | 3.6.1 | BSD-3-Clause |
| nl_core_news_lg | 3.8.0 | CC BY-SA 4.0 |
| numpy | 2.4.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| openpyxl | 3.1.5 | MIT |
| packaging | 26.1 | Apache-2.0 OR BSD-2-Clause |
| phonenumbers | 9.0.28 | Apache-2.0 |
| preshed | 3.0.13 | MIT |
| presidio_analyzer | 2.2.366 | MIT |
| presidio_anonymizer | 2.2.366 | MIT |
| pycparser | 3.0 | BSD-3-Clause |
| pydantic | 2.13.3 | MIT |
| pydantic-settings | 2.14.0 | MIT |
| pydantic_core | 2.46.3 | MIT |
| Pygments | 2.20.0 | BSD-2-Clause |
| python-docx | 1.2.0 | MIT |
| python-dotenv | 1.2.2 | BSD-3-Clause |
| python-multipart | 0.0.26 | Apache-2.0 |
| PyYAML | 6.0.3 | MIT |
| regex | 2026.4.4 | Apache-2.0 AND CNRI-Python |
| requests | 2.33.1 | Apache-2.0 |
| requests-file | 3.0.1 | Apache 2.0 |
| rich | 15.0.0 | MIT |
| safetensors | 0.7.0 | Apache Software License |
| shellingham | 1.5.4 | ISC License |
| smart_open | 7.6.0 | MIT License |
| spacy | 3.8.14 | MIT |
| spacy-legacy | 3.0.12 | MIT |
| spacy-loggers | 1.0.5 | MIT |
| srsly | 2.5.3 | MIT |
| starlette | 1.0.0 | BSD-3-Clause |
| sympy | 1.14.0 | BSD |
| thinc | 8.3.13 | MIT |
| tldextract | 5.3.1 | BSD-3-Clause |
| tokenizers | 0.22.2 | Apache Software License |
| torch | 2.11.0 | BSD-3-Clause |
| tqdm | 4.67.3 | MPL-2.0 AND MIT |
| transformers | 5.5.4 | Apache 2.0 License |
| typer | 0.24.1 | MIT |
| typing-inspection | 0.4.2 | MIT |
| typing_extensions | 4.15.0 | PSF-2.0 |
| urllib3 | 2.6.3 | MIT |
| uvicorn | 0.44.0 | BSD-3-Clause |
| uvloop | 0.22.1 | MIT License |
| wasabi | 1.1.3 | MIT |
| watchfiles | 1.1.1 | MIT |
| weasel | 1.0.0 | MIT |
| websockets | 16.0 | BSD-3-Clause |
| wrapt | 2.1.2 | BSD-2-Clause |

## JavaScript-pakketten in de app (12)

| Pakket | Versie | Licentie |
|---|---|---|
| @radix-ui/react-compose-refs | 1.1.2 | MIT |
| @radix-ui/react-slot | 1.2.4 | MIT |
| class-variance-authority | 0.7.1 | Apache-2.0 |
| clsx | 2.1.1 | MIT |
| electron | 33.4.11 | MIT |
| js-tokens | 4.0.0 | MIT |
| loose-envify | 1.4.0 | MIT |
| lucide-react | 0.460.0 | ISC |
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| scheduler | 0.23.2 | MIT |
| tailwind-merge | 2.6.1 | MIT |

Electron levert Chromium mee; de licenties daarvan staan in `LICENSES.chromium.html`
naast de app.
