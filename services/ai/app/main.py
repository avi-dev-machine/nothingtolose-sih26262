"""AI assistance service. Every response is a human-reviewable suggestion, never a decision."""
from datetime import datetime, timezone
from io import BytesIO
import re
from typing import Optional

import dateparser
import numpy as np
import psycopg
import pytesseract
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from pypdf import PdfReader
from sklearn.ensemble import HistGradientBoostingRegressor
from .config import settings

app = FastAPI(title=settings.app_name, version="1.0.0", description="Human-in-the-loop AI assistance for the AICTE Approval Control Tower")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

TYPE_PATTERNS = {
    "FIRE_SAFETY_NOC": ("fire", "noc"), "BUILDING_STABILITY": ("building", "stability"),
    "LAND_USE_CERTIFICATE": ("land", "use"), "AFFILIATION_ORDER": ("affiliation",),
    "UNDERTAKING": ("undertaking",), "LEASE_DEED": ("lease", "deed"),
}
DATE_PATTERNS = [r"(?:expiry|expires?|valid\s*(?:up\s*)?to|validity)[\s:.-]*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})"]

class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    timestamp: float

class AphQueryRequest(BaseModel):
    query: str = Field(min_length=5, max_length=2000)
    top_k: int = Field(default=3, ge=1, le=10)
    academic_year: Optional[str] = "2026-27"

class DelayRiskRequest(BaseModel):
    application_id: str
    current_state: str
    days_in_current_state: float = Field(ge=0)
    total_deficiencies_raised: int = Field(ge=0)
    deficiencies_pending: int = Field(ge=0)
    institution_type: str
    region_id: str

@app.get("/health", response_model=HealthResponse)
async def health_check():
    return {"status": "ok", "service": "aicte-ai", "version": "1.0.0", "timestamp": datetime.now(timezone.utc).timestamp()}

def document_text(contents: bytes, content_type: str | None) -> str:
    if content_type == "application/pdf" or contents.startswith(b"%PDF"):
        try:
            text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(contents)).pages).strip()
        except Exception as error:
            raise HTTPException(status_code=422, detail=f"PDF text extraction failed: {error}") from error
        if not text:
            raise HTTPException(status_code=422, detail="PDF has no embedded text; submit an OCR-readable image")
        return text
    try:
        text = pytesseract.image_to_string(Image.open(BytesIO(contents)).convert("RGB")).strip()
    except pytesseract.TesseractNotFoundError as error:
        raise HTTPException(status_code=503, detail="Tesseract is not installed on this AI worker") from error
    except UnidentifiedImageError as error:
        raise HTTPException(status_code=415, detail="Only PDF, JPEG and PNG documents are supported") from error
    if not text:
        raise HTTPException(status_code=422, detail="OCR produced no readable text")
    return text

def classify(text: str) -> tuple[str, float]:
    normalized = re.sub(r"[^a-z0-9]+", " ", text.lower())
    label, score = max(((name, sum(term in normalized for term in terms) / len(terms)) for name, terms in TYPE_PATTERNS.items()), key=lambda pair: pair[1])
    return (label if score else "UNCLASSIFIED", round(max(score, 0.15), 4))

def dates(text: str) -> list[str]:
    result: list[str] = []
    for pattern in DATE_PATTERNS:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            parsed = dateparser.parse(match.group(1), settings={"DATE_ORDER": "DMY"})
            if parsed and parsed.date().isoformat() not in result:
                result.append(parsed.date().isoformat())
    return result

@app.post("/ocr/extract")
async def extract_document_text(file: UploadFile = File(...)):
    if file.content_type not in {"application/pdf", "image/jpeg", "image/png"}:
        raise HTTPException(status_code=415, detail="Only PDF, JPEG and PNG files are accepted")
    contents = await file.read()
    if not contents or len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Document must be between 1 byte and 20 MiB")
    text = document_text(contents, file.content_type)
    label, confidence = classify(text)
    extracted_dates = dates(text)
    reference = re.search(r"(?:reference|ref(?:erence)?\s*(?:no\.?)?)[\s:.-]*([A-Za-z0-9/-]{4,})", text, flags=re.IGNORECASE)
    return {"filename": file.filename, "bytes_received": len(contents), "extracted_text": text, "detected_type": label, "extracted_expiry_date": extracted_dates[0] if extracted_dates else None, "confidence": confidence, "metadata": {"reference_number": reference.group(1) if reference else None, "extracted_dates": extracted_dates, "processor": "pypdf/tesseract+dateparser", "suggestion_only": True}}

def lexical_score(query: set[str], title: str, content: str, keywords: list[str]) -> float:
    corpus = set(re.findall(r"[a-z0-9]{3,}", f"{title} {content} {' '.join(keywords)}".lower()))
    return len(query & corpus) / max(len(query), 1)

@app.post("/aph/query")
async def query_aph_clauses(req: AphQueryRequest):
    try:
        with psycopg.connect(settings.database_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT clause_number, chapter, title, content, keywords FROM aph_clauses LIMIT 500")
            clauses = cursor.fetchall()
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"APH retrieval store is unavailable: {error}") from error
    tokens = set(re.findall(r"[a-z0-9]{3,}", req.query.lower()))
    ranked = sorted(clauses, key=lambda row: lexical_score(tokens, row[2], row[3], row[4] or []), reverse=True)[:req.top_k]
    matches = [{"clause_number": row[0], "chapter": row[1], "title": row[2], "similarity_score": round(lexical_score(tokens, row[2], row[3], row[4] or []), 4), "text_excerpt": row[3][:500], "compliance_verdict_suggestion": "NEEDS_VERIFICATION", "citation": {"clause_number": row[0], "title": row[2]}} for row in ranked]
    return {"query": req.query, "top_matches": matches, "ai_rationale": "Retrieval over the configured APH corpus. An authorised human must interpret cited clauses.", "suggestion_only": True}

def train_baseline() -> HistGradientBoostingRegressor:
    """Deterministic synthetic baseline; replace only with governance-approved outcome data."""
    rng = np.random.default_rng(26262)
    days, raised = rng.uniform(0, 40, 600), rng.integers(0, 7, 600)
    pending = np.minimum(raised, rng.integers(0, 5, 600))
    outcome = np.clip(6 + days * 1.8 + raised * 5 + pending * 11 + rng.normal(0, 5, 600), 1, 98)
    return HistGradientBoostingRegressor(max_depth=3, random_state=26262).fit(np.column_stack((days, raised, pending)), outcome)

DELAY_MODEL = train_baseline()

@app.post("/predict/delay-risk")
async def predict_delay_risk(req: DelayRiskRequest):
    score = round(float(np.clip(DELAY_MODEL.predict([[req.days_in_current_state, req.total_deficiencies_raised, req.deficiencies_pending]])[0], 0, 100)), 1)
    category = "CRITICAL" if score >= 75 else "HIGH" if score >= 50 else "MEDIUM" if score >= 25 else "LOW"
    factors = [{"factor": f"{req.deficiencies_pending} unresolved deficiency item(s)", "impact_weight": round(min(1.0, req.deficiencies_pending / 5), 2), "suggestion": "Prioritise outstanding evidence review."}, {"factor": f"{round(req.days_in_current_state, 1)} days in {req.current_state}", "impact_weight": round(min(1.0, req.days_in_current_state / 30), 2), "suggestion": "Review workload and SLA escalation."}]
    return {"application_id": req.application_id, "risk_score": score, "risk_category": category, "predicted_completion_days": round(max(1, 30 - score / 4), 1), "key_risk_factors": factors, "model": "HistGradientBoostingRegressor synthetic baseline", "suggestion_only": True}
