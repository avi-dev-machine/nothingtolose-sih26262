import re

def mask_pii(text: str) -> str:
    """
    Minimises personally identifiable information (PII) before any external LLM call.
    Masks Indian phone numbers, Aadhaar numbers, PAN numbers, and email addresses.
    """
    # Aadhaar (12 digits with optional spaces or hyphens)
    text = re.sub(r'\b\d{4}[ -]?\d{4}[ -]?\d{4}\b', '[AADHAAR_REDACTED]', text)
    # PAN card (5 uppercase letters, 4 digits, 1 uppercase letter)
    text = re.sub(r'\b[A-Z]{5}[0-9]{4}[A-Z]\b', '[PAN_REDACTED]', text)
    # Indian phone numbers (+91 or 10 digits starting with 6-9)
    text = re.sub(r'\b(?:\+91[- ]?)?[6-9]\d{9}\b', '[PHONE_REDACTED]', text)
    # Email addresses
    text = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b', '[EMAIL_REDACTED]', text)
    return text
