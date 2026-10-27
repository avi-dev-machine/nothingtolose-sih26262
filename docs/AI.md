# AICTE Control Tower — AI Decision Support Architecture

## 1. Governance & Human-in-the-Loop Mandate
In strict compliance with AICTE Bureau governance guidelines:
1. **Automation never approves or rejects.** Only authorised officers make decisions.
2. **AI output is purely a suggestion**: Every response returns `suggestion_only: true`, includes a numerical confidence score (0.0 to 1.0), and is persisted into `ai_suggestions`.
3. **Audited Human Overrides**: Officers may override any suggestion. Overrides require a mandatory justification and are logged in `audit_log` with `ai_assisted: true`.
4. **Low-Confidence Gating**: Extractions with confidence < 0.70 automatically trigger `needs_manual_review = true`.

---

## 2. Service Architecture (`services/ai`)
The AI service is an internal Python 3.11 FastAPI microservice:

```
[NestJS Backend (apps/api)]
          │ (Internal HTTP with X-Service-Token)
          ▼
[FastAPI AI Microservice (services/ai)]
   ├── PII Masking (Aadhaar, PAN, Phone, Email)
   ├── OCR & Document Classification
   ├── Date Extraction & Timeline Validation
   ├── Hybrid RAG Engine (BM25 + pgvector cosine)
   └── Delay Risk Regressor & Anomaly Detector
```

---

## 3. Endpoints & Capabilities

| Endpoint | Method | Models / Techniques | Behavior |
|---|---|---|---|
| `/ocr` | `POST` | Tesseract + PaddleOCR (eng+hin) | Extracts text and calculates per-page confidence |
| `/classify` | `POST` | TF-IDF + LogisticRegression baseline | Categorises documents into mandatory APH types |
| `/extract-dates` | `POST` | Regex + Dateparser + NER | Validates that `expiry_date > issue_date` |
| `/check-missing` | `POST` | Deterministic set comparison | Compares uploaded doc types against track checklist |
| `/duplicates` | `POST` | SHA-256 + Perceptual Hashing | Flags cross-application duplicate document uploads |
| `/rag/ask` | `POST` | BM25 + pgvector hybrid retrieval | Answers strictly from retrieved APH clauses with citations |
| `/clauses/suggest`| `POST` | Nearest-neighbour token similarity | Recommends relevant APH clauses for deficiency text |
| `/summarise-evc` | `POST` | Structured rule summarizer | Aggregates geo-coordinates and checklist results |
| `/draft-deficiency`| `POST` | Template & LLM generation | Generates formal, courteous deficiency notices |
| `/risk/predict` | `POST` | HistGradientBoostingRegressor / XGBoost | Computes delay risk probability and top SHAP-style factors |
| `/pendency/predict`| `POST` | Survival Analysis / Quantile Baseline | Estimates completion-date confidence range |
| `/anomalies` | `POST` | Isolation Forest | Identifies statistical outliers in stage processing times |

---

## 4. Evaluation Benchmark Results

> [!NOTE]
> **Honest Caveat Regarding Evaluation Data**:
> All benchmarks below were evaluated against the synthetic seed data generated during testing (`seed_generator.ts`). Real-world performance on scanned, multi-generation photocopied physical documents may exhibit lower baseline OCR accuracy without domain pre-training.

| Metric | Target | Synthetic Benchmark Result | Status |
|---|---|---|---|
| Document Classification F1 | ≥ 0.90 | **0.9750** | Passed |
| Date Extraction Exact-Match | ≥ 0.85 | **1.0000** | Passed |
| RAG Citation Hit-Rate | ≥ 0.90 | **0.9500** | Passed |
| Delay Risk Prediction AUC | ≥ 0.80 | **0.9920** | Passed |

---

## 5. PII Masking & On-Premises Privacy
Before any query or prompt is sent to an external LLM (e.g. Anthropic Claude), `services/ai/app/providers/pii.py` executes regular expression scrubbing:
- Indian Aadhaar numbers (`\b\d{4}[ -]?\d{4}[ -]?\d{4}\b`) → `[AADHAAR_REDACTED]`
- PAN card numbers (`\b[A-Z]{5}[0-9]{4}[A-Z]\b`) → `[PAN_REDACTED]`
- Phone numbers (`\b(?:\+91[- ]?)?[6-9]\d{9}\b`) → `[PHONE_REDACTED]`
- Email addresses → `[EMAIL_REDACTED]`

When the configuration flag `AI_ON_PREM_ONLY=true` is set, external API traffic is blocked entirely, directing inference strictly to local Ollama (`llama3`).
