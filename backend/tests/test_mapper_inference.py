from auto_approps.mapper import SYSTEM_PROMPT, build_user_message
from auto_approps.models import (
    DocChunk,
    FieldType,
    FormField,
    FormSchema,
    ParsedDocument,
)


def _doc() -> ParsedDocument:
    return ParsedDocument(
        filename="proposal.docx",
        chunks=[
            DocChunk(
                text="This project supports the Department of Defense missile defense program.",
                source_location="Paragraph 1",
                chunk_type="paragraph",
                heading_context="Project Overview",
                index=0,
            )
        ],
        full_text="This project supports the Department of Defense missile defense program.",
    )


def _classification_form() -> FormSchema:
    return FormSchema(
        title="Appropriations Request",
        fields=[
            FormField(
                field_id="entry.100",
                label="Is this a Defense Funding request or a Defense Language request?",
                field_type=FieldType.radio,
                options=["Defense Funding", "Defense Language", "Programmatic/Non-Defense"],
            ),
            FormField(
                field_id="entry.200",
                label="Which agency does this relate to?",
                field_type=FieldType.dropdown,
                options=["DOD", "HHS", "DOE", "USDA"],
            ),
        ],
    )


def test_system_prompt_includes_inference_rules():
    assert "Inference for classification and categorical questions" in SYSTEM_PROMPT
    assert "CLASSIFY" in SYSTEM_PROMPT
    assert "Do NOT default" in SYSTEM_PROMPT
    assert 'default to "N/A"' in SYSTEM_PROMPT


def test_system_prompt_instructs_reasoning_for_categories():
    assert "choose between categories" in SYSTEM_PROMPT
    assert "Explain your reasoning" in SYSTEM_PROMPT
    assert "confidence inference is far more valuable" in SYSTEM_PROMPT


def test_user_message_includes_classification_inference_instruction():
    message = build_user_message(
        _doc(),
        _classification_form(),
        field_id_to_alias={"entry.100": "F001", "entry.200": "F002"},
    )

    assert "classification or categorical fields" in message
    assert "infer the correct answer" in message
    assert "Do not skip these or default to a generic catch-all option" in message


def test_user_message_renders_radio_options_for_classification_field():
    message = build_user_message(
        _doc(),
        _classification_form(),
        field_id_to_alias={"entry.100": "F001", "entry.200": "F002"},
    )

    assert "Defense Funding" in message
    assert "Defense Language" in message
    assert "Programmatic/Non-Defense" in message
    assert "Type: radio" in message
