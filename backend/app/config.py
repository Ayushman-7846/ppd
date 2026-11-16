from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "sqlite:///./lingualens.sqlite3"
    web_origin: str = "http://localhost:3000"
    secure_cookie: bool = False
    registration_enabled: bool = True
    allow_shared_provider_keys: bool = True
    worker_enabled: bool = True
    credential_key: SecretStr | None = None
    openai_api_key: SecretStr | None = None
    gemini_api_key: SecretStr | None = None
    anthropic_api_key: SecretStr | None = None
    openrouter_api_key: SecretStr | None = None
    ollama_host: str = "http://127.0.0.1:11434"
    semantic_model: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
