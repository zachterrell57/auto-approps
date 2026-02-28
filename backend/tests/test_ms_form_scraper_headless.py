import asyncio

import pytest

from auto_approps import ms_form_scraper
from auto_approps.config import Settings


class _FakePage:
    url = "https://forms.office.com/r/test"

    async def goto(self, _url: str, wait_until: str):
        return None

    async def wait_for_selector(self, _selector: str, timeout: int):
        raise RuntimeError("No questions")


class _FakeBrowser:
    def __init__(self) -> None:
        self._page = _FakePage()

    async def new_page(self):
        return self._page

    async def close(self):
        return None


class _FakeChromium:
    def __init__(self, launch_calls: list[bool]) -> None:
        self.launch_calls = launch_calls

    async def launch(self, *, headless: bool):
        self.launch_calls.append(headless)
        return _FakeBrowser()


class _FakePlaywright:
    def __init__(self, launch_calls: list[bool]) -> None:
        self.chromium = _FakeChromium(launch_calls)


class _FakePlaywrightContext:
    def __init__(self, launch_calls: list[bool]) -> None:
        self._playwright = _FakePlaywright(launch_calls)

    async def __aenter__(self):
        return self._playwright

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _run_scrape_and_capture_headless(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> list[bool]:
    launch_calls: list[bool] = []

    def _fake_async_playwright() -> _FakePlaywrightContext:
        return _FakePlaywrightContext(launch_calls)

    monkeypatch.setattr(ms_form_scraper, "settings", settings)
    monkeypatch.setattr(ms_form_scraper, "async_playwright", _fake_async_playwright)

    with pytest.raises(ValueError, match="Could not find form questions"):
        asyncio.run(ms_form_scraper.scrape_ms_form("https://forms.office.com/r/test"))

    return launch_calls


def test_scrape_ms_form_defaults_headless_when_env_unset(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("MS_PLAYWRIGHT_HEADLESS", raising=False)
    settings = Settings(_env_file=None)

    launch_calls = _run_scrape_and_capture_headless(monkeypatch, settings)

    assert settings.ms_playwright_headless is True
    assert launch_calls == [True]


def test_scrape_ms_form_supports_headed_debug_override(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MS_PLAYWRIGHT_HEADLESS", "false")
    settings = Settings(_env_file=None)

    launch_calls = _run_scrape_and_capture_headless(monkeypatch, settings)

    assert settings.ms_playwright_headless is False
    assert launch_calls == [False]
