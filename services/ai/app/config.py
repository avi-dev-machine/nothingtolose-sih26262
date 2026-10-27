import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "AICTE Approval Control Tower AI Service"
    port: int = int(os.getenv("AI_PORT", "8000"))
    host: str = "0.0.0.0"
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    default_llm_provider: str = os.getenv("DEFAULT_LLM_PROVIDER", "claude")
    database_url: str = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/aicte_db")
    model_bge_m3: str = "BAAI/bge-m3"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
