from auto_approps.mapper import SYSTEM_PROMPT, build_user_message
from auto_approps.models import (
    DocChunk,
    FieldType,
    FormField,
    FormSchema,
    KnowledgeProfile,
    ParsedDocument,
)


def _doc() -> ParsedDocument:
    return ParsedDocument(
        filename="input.docx",
        chunks=[
            DocChunk(
                text="The firm advocates for workforce development grants.",
                source_location="Paragraph 1",
                chunk_type="paragraph",
                heading_context="",
                index=0,
            )
        ],
        full_text="The firm advocates for workforce development grants.",
    )


def _form() -> FormSchema:
    return FormSchema(
        title="Form",
        fields=[
            FormField(
                field_id="entry.1",
                label="What is your top policy focus?",
                field_type=FieldType.short_text,
            )
        ],
    )


def test_build_user_message_includes_profile_context_when_present():
    profile = KnowledgeProfile(
        user_context="User has 12 years in appropriations drafting.",
        firm_context="Firm specializes in labor and education policy.",
    )

    message = build_user_message(
        _doc(),
        _form(),
        field_id_to_alias={"entry.1": "F001"},
        knowledge_profile=profile,
    )

    assert "## Reusable User/Firm Context" in message
    assert "[User Knowledge]" in message
    assert "[Firm Knowledge]" in message
    assert "12 years in appropriations drafting" in message
    assert "specializes in labor and education policy" in message


def test_build_user_message_excludes_profile_section_when_empty():
    message = build_user_message(
        _doc(),
        _form(),
        field_id_to_alias={"entry.1": "F001"},
        knowledge_profile=KnowledgeProfile(),
    )

    assert "## Reusable User/Firm Context" not in message
    assert "[User Knowledge]" not in message
    assert "[Firm Knowledge]" not in message


def test_system_prompt_includes_profile_conflict_and_citation_rules():
    assert "If reusable profile context conflicts with the uploaded document" in SYSTEM_PROMPT
    assert 'set source_citation to "User/Firm Profile"' in SYSTEM_PROMPT
