import json
from typing import Dict, Any, Optional
import httpx
from .base import BaseLLMProvider
from ..config import settings

class OllamaProvider(BaseLLMProvider):
    def __init__(self, base_url: Optional[str] = None):
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")

    async def generate_completion(self, prompt: str, system_prompt: Optional[str] = None, max_tokens: int = 1000) -> str:
        payload = {
            "model": "llama3",
            "prompt": prompt,
            "stream": False
        }
        if system_prompt:
            payload["system"] = system_prompt

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{self.base_url}/api/generate", json=payload)
            resp.raise_for_status()
            return resp.json().get("response", "")

    async def structured_extraction(self, prompt: str, schema: Dict[str, Any]) -> Dict[str, Any]:
        full_prompt = f"{prompt}\nReturn JSON strictly matching schema: {json.dumps(schema)}"
        completion = await self.generate_completion(full_prompt)
        try:
            return json.loads(completion)
        except Exception:
            return {"raw_text": completion}
