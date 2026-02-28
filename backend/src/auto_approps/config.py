from pathlib import Path

from pydantic_settings import BaseSettings

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    anthropic_api_key: str = ""
    model_name: str = "claude-sonnet-4-5-20241022"
    browser_slow_mo: int = 100
    ms_playwright_headless: bool = True
    ms_nav_ai_retries: int = 1
    mapping_ai_retries: int = 1
    ms_nav_transition_timeout_ms: int = 8000
    ms_nav_max_pages: int = 40

    model_config = {"env_file": str(_ENV_FILE), "env_file_encoding": "utf-8"}


settings = Settings()
