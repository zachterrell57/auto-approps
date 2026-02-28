from __future__ import annotations

import io
from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

from .models import DocChunk, ParsedDocument


def iter_block_items(parent):
    """Yield paragraphs and tables in document order."""
    body = parent.element.body
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, parent)
        elif child.tag == qn("w:tbl"):
            yield Table(child, parent)


def parse_docx(file_bytes: bytes, filename: str) -> ParsedDocument:
    doc = Document(io.BytesIO(file_bytes))
    chunks: list[DocChunk] = []
    full_text_parts: list[str] = []
    current_heading = ""
    chunk_index = 0

    for block in iter_block_items(doc):
        if isinstance(block, Paragraph):
            text = block.text.strip()
            if not text:
                continue

            style_name = (block.style.name or "").lower()
            if "heading" in style_name:
                current_heading = text
                source = f"Heading: '{text}'"
                chunk_type = "heading"
                # Extract heading level: "heading 1" -> 1, "heading 2" -> 2, default 2
                heading_level = 2
                for part in style_name.split():
                    if part.isdigit():
                        heading_level = int(part)
                        break
                full_text_parts.append(f"\n## {text}\n")
            else:
                source = f"Section '{current_heading}' > Paragraph {chunk_index + 1}" if current_heading else f"Paragraph {chunk_index + 1}"
                chunk_type = "paragraph"
                full_text_parts.append(text)

            chunks.append(DocChunk(
                text=text,
                source_location=source,
                chunk_type=chunk_type,
                heading_context=current_heading,
                heading_level=heading_level if chunk_type == "heading" else 0,
                index=chunk_index,
            ))
            chunk_index += 1

        elif isinstance(block, Table):
            headers = [cell.text.strip() for cell in block.rows[0].cells] if block.rows else []

            for row_idx, row in enumerate(block.rows):
                cells = [cell.text.strip() for cell in row.cells]
                if row_idx == 0:
                    # Header row
                    row_text = " | ".join(cells)
                    full_text_parts.append(row_text)
                    full_text_parts.append("-" * len(row_text))
                else:
                    if headers:
                        pairs = [f"{h}: {c}" for h, c in zip(headers, cells) if c]
                        row_text = " | ".join(pairs)
                    else:
                        row_text = " | ".join(cells)
                    full_text_parts.append(row_text)

                source = f"Section '{current_heading}' > Table Row {row_idx + 1}" if current_heading else f"Table Row {row_idx + 1}"
                chunks.append(DocChunk(
                    text=row_text if row_idx > 0 else " | ".join(cells),
                    source_location=source,
                    chunk_type="table_row",
                    heading_context=current_heading,
                    index=chunk_index,
                ))
                chunk_index += 1

    return ParsedDocument(
        filename=filename,
        chunks=chunks,
        full_text="\n".join(full_text_parts),
    )
