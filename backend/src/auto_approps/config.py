from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str = ""
    model_name: str = "claude-sonnet-4-5-20241022"
    browser_slow_mo: int = 100
    ms_nav_ai_retries: int = 1
    mapping_ai_retries: int = 1
    ms_nav_transition_timeout_ms: int = 8000
    ms_nav_max_pages: int = 40

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
