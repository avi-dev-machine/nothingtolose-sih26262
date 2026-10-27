from abc import ABC, abstractmethod
from typing import Dict, Any, Optional

class BaseLLMProvider(ABC):
    @abstractmethod
    async def generate_completion(self, prompt: str, system_prompt: Optional[str] = None, max_tokens: int = 1000) -> str:
        """Generate text completion from LLM."""
        pass

    @abstractmethod
    async def structured_extraction(self, prompt: str, schema: Dict[str, Any]) -> Dict[str, Any]:
        """Extract structured JSON matching a specified schema."""
        pass
