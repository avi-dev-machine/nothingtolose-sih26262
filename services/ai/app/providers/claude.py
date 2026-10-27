import json
from typing import Dict, Any, Optional
import httpx
from .base import BaseLLMProvider
from ..config import settings

class ClaudeProvider(BaseLLMProvider):
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.anthropic_api_key

    async def generate_completion(self, prompt: str, system_prompt: Optional[str] = None, max_tokens: int = 1000) -> str:
        if not self.api_key:
            return "Claude API key not configured. Mock completion returned for development setup."
        
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        }
        payload = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}]
        }
        if system_prompt:
            payload["system"] = system_prompt

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return data["content"][0]["text"]

    async def structured_extraction(self, prompt: str, schema: Dict[str, Any]) -> Dict[str, Any]:
        full_prompt = f"{prompt}\nReturn strictly valid JSON adhering to schema: {json.dumps(schema)}"
        completion = await self.generate_completion(full_prompt)
        try:
            return json.loads(completion)
        except Exception:
            return {"raw_text": completion}
