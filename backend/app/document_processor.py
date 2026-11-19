from io import BytesIO

from docx import Document
from pypdf import PdfReader


def extract_text(file_content: bytes, extension: str) -> str:
    """Extract readable text from PDF, DOCX or TXT files."""

    if extension == ".pdf":
        pdf = PdfReader(BytesIO(file_content))

        # Preserve PDF headings and bullet structure
        text = "\n".join(
            page.extract_text(extraction_mode="layout") or ""
            for page in pdf.pages
        )

    elif extension == ".docx":
        document = Document(BytesIO(file_content))

        text = "\n".join(
            paragraph.text
            for paragraph in document.paragraphs
        )

    elif extension == ".txt":
        text = file_content.decode("utf-8-sig")

    else:
        raise ValueError("Unsupported file format")

    text = text.strip()

    if not text:
        raise ValueError(
            "No readable text found in this document."
        )

    return text