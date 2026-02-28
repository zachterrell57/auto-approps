from __future__ import annotations

from enum import Enum


class FormProvider(str, Enum):
    google = "google"
    microsoft = "microsoft"


def detect_provider(url: str) -> FormProvider:
    """Detect the form provider from a URL."""
    if "google.com/forms" in url:
        return FormProvider.google
    if "forms.office.com" in url or "forms.microsoft.com" in url:
        return FormProvider.microsoft
    raise ValueError(
        "Unsupported form URL. Please provide a Google Forms or Microsoft Forms URL."
    )
