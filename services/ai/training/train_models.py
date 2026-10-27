"""
Model training script for AICTE Control Tower AI Microservice.
Trains baseline document classifier and delay risk predictor on synthetic seed data.
"""
import os
import pickle
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingRegressor, IsolationForest

MODEL_DIR = os.path.join(os.path.dirname(__file__), "../models")
os.makedirs(MODEL_DIR, exist_ok=True)

def train_classifier():
    print("[AI Training] Training Document Classifier...")
    categories = [
        "FIRE_SAFETY_NOC",
        "BUILDING_STABILITY",
        "LAND_USE_CERTIFICATE",
        "AFFILIATION_ORDER",
        "TRUST_DEED",
        "LEASE_DEED",
        "FACULTY_LIST",
        "BAR_COUNCIL_NOC",
    ]
    texts = [
        "fire safety certificate noc office fire prevention emergency exit verified fire extinguisher",
        "structural building stability certificate engineer safe occupancy load bearing capacity",
        "land use certificate conversion non agricultural order revenue authority collector",
        "university affiliation order provisional academic approval state directorate technical education",
        "trust deed registered society registration memorandum of association public charitable trust",
        "registered lease deed sub registrar tenure 30 years perpetual lease lessor lessee",
        "approved faculty list qualifications cadre ratio professor associate assistant ph.d.",
        "bar council of india legal education approval law course recognition noc",
    ]
    vectorizer = TfidfVectorizer(ngram_range=(1, 2))
    X = vectorizer.fit_transform(texts)
    clf = LogisticRegression(random_state=42).fit(X, categories)

    with open(os.path.join(MODEL_DIR, "doc_classifier_v1.pkl"), "wb") as f:
        pickle.dump({"vectorizer": vectorizer, "classifier": clf, "categories": categories}, f)
    print("[AI Training] Document Classifier saved.")

def train_delay_model():
    print("[AI Training] Training Delay Risk Regressor...")
    rng = np.random.default_rng(26262)
    days = rng.uniform(0, 45, 1000)
    raised = rng.integers(0, 8, 1000)
    pending = np.minimum(raised, rng.integers(0, 6, 1000))
    score = np.clip(5 + days * 1.6 + raised * 4.5 + pending * 10 + rng.normal(0, 4, 1000), 0, 100)

    model = HistGradientBoostingRegressor(max_depth=3, random_state=26262).fit(
        np.column_stack((days, raised, pending)), score
    )

    with open(os.path.join(MODEL_DIR, "delay_model_v1.pkl"), "wb") as f:
        pickle.dump(model, f)
    print("[AI Training] Delay Risk model saved.")

if __name__ == "__main__":
    train_classifier()
    train_delay_model()
    print("[AI Training] All models trained and saved to services/ai/models/")
