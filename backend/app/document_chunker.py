import re


def split_text(
    text: str,
    chunk_size: int = 1000,
    overlap: int = 150
) -> list[str]:
    """
    Split document text into overlapping chunks while preserving
    topic sections when possible.
    """

    if chunk_size <= 0:
        raise ValueError("Chunk size must be positive.")

    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("Overlap must be smaller than chunk size.")

    text = text.strip()

    if not text:
        return []

    # Identify standalone topic headings
    headings = {
        "Arrays & Hashing",
        "Two Pointers",
        "Sliding Window",
        "Stack",
        "Binary Search",
        "Linked List",
        "Trees",
        "Tries",
        "Heap / Priority Queue",
        "Backtracking",
        "Graphs",
        "Dynamic Programming",
        "Greedy",
        "Intervals",
        "Math & Geometry",
        "Bit Manipulation",
    }

    # Separate document into topic sections
    lines = text.splitlines()
    sections = []
    current_section = []

    for line in lines:
        line = line.strip()

        if not line:
            continue

        if line in headings and current_section:
            sections.append("\n".join(current_section))
            current_section = []

        current_section.append(line)

    if current_section:
        sections.append("\n".join(current_section))

    chunks = []

    # Split each section independently
    for section in sections:

        if len(section) <= chunk_size:
            chunks.append(section)
            continue

        start = 0

        while start < len(section):
            end = min(start + chunk_size, len(section))

            if end < len(section):
                boundary = section.rfind(" ", start, end)

                if boundary > start + chunk_size // 2:
                    end = boundary

            chunk = section[start:end].strip()

            if chunk:
                chunks.append(chunk)

            if end == len(section):
                break

            start = max(start + 1, end - overlap)

    return chunks