"""
extract_meta.py — Kimi-assisted PDF metadata extraction.
Called by: python scripts/build.py --extract
Implemented in Plan 2 (Kimi AI Assistant).
"""


def extract_metadata(pdf_path: str, api_key: str) -> dict:
    """Extract structured metadata from a PDF using Kimi API.
    Returns dict with keys: title, authors, abstract, doi, year, journal.
    Raises NotImplementedError until Plan 2 is complete.
    """
    raise NotImplementedError("Kimi extraction not yet implemented — coming in Plan 2")
