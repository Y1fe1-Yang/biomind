"""Tests for sop_service extraction logic (no live API calls)."""
import pytest
from pathlib import Path


# ── extract_pdf_methods ──────────────────────────────────────────────────────

def test_extract_pdf_methods_missing_file():
    from backend.services.sop_service import extract_pdf_methods
    result = extract_pdf_methods(Path("/nonexistent/file.pdf"))
    assert result == ""


def test_extract_pdf_methods_truncates_at_8000(tmp_path, monkeypatch):
    from backend.services import sop_service

    def fake_open(path):
        class FakePage:
            def get_text(self):
                return "Methods\n" + "x" * 9000
        class FakeDoc:
            def __len__(self): return 1
            def __getitem__(self, i): return FakePage()
            def close(self): pass
        return FakeDoc()

    monkeypatch.setattr(sop_service.fitz, "open", fake_open)
    result = sop_service.extract_pdf_methods(tmp_path / "fake.pdf")
    assert len(result) <= 8000


# ── build_sop_entries ────────────────────────────────────────────────────────

def _make_paper():
    return {
        "id": "labchip2022",
        "title": "Microfluidic Chip Study",
        "authors": ["Lin Zeng", "Jane Doe"],
        "year": 2022,
        "journal": "Lab on a Chip",
        "doi": "10.1039/d2lc00386h",
    }


def test_build_sop_entries_single_result():
    from backend.services.sop_service import build_sop_entries
    ai_result = {
        "title": "PDMS Chip Prep",
        "category": "微流控器件",
        "subcategory": "芯片制备",
        "purpose": "Prepare PDMS chip",
        "materials": ["PDMS"],
        "steps": ["Step 1"],
        "protocol_notes": [],
        "tags": ["PDMS"],
        "responsible": "Lin Zeng",
    }
    entries = build_sop_entries(_make_paper(), [ai_result], [])
    assert len(entries) == 1
    e = entries[0]
    assert e["id"] == "sop-labchip2022-1"
    assert e["status"] == "auto"
    assert e["source_paper_id"] == "labchip2022"
    assert e["source_doi"] == "10.1039/d2lc00386h"
    assert e["updated"] == "2022"
    assert e["version"] == "v1.0"
    assert "Zeng" in e["reference"]


def test_build_sop_entries_multiple_results():
    from backend.services.sop_service import build_sop_entries
    ai_results = [
        {"title": "SOP A", "category": "微流控器件", "subcategory": "",
         "purpose": "", "materials": [], "steps": ["s1"], "protocol_notes": [],
         "tags": [], "responsible": "Lin Zeng"},
        {"title": "SOP B", "category": "检测与表征", "subcategory": "",
         "purpose": "", "materials": [], "steps": ["s2"], "protocol_notes": [],
         "tags": [], "responsible": "Lin Zeng"},
    ]
    entries = build_sop_entries(_make_paper(), ai_results, [])
    assert len(entries) == 2
    assert entries[0]["id"] == "sop-labchip2022-1"
    assert entries[1]["id"] == "sop-labchip2022-2"


def test_build_sop_entries_id_does_not_collide_with_existing():
    from backend.services.sop_service import build_sop_entries
    existing = [
        {"id": "sop-labchip2022-1", "status": "auto"},
        {"id": "sop-labchip2022-2", "status": "auto"},
    ]
    ai_result = {
        "title": "New SOP", "category": "检测与表征", "subcategory": "",
        "purpose": "", "materials": [], "steps": ["s1"], "protocol_notes": [],
        "tags": [], "responsible": "Lin Zeng",
    }
    entries = build_sop_entries(_make_paper(), [ai_result], existing)
    assert entries[0]["id"] == "sop-labchip2022-3"


def test_build_sop_entries_abstract_only():
    from backend.services.sop_service import build_sop_entries
    ai_result = {
        "title": "Some Study",
        "category": "检测与表征",
        "subcategory": "光学检测",
        "purpose": "Detect biomarkers",
        "materials": [],
        "steps": [],
        "protocol_notes": [],
        "tags": ["SPR"],
        "responsible": "Lin Zeng",
    }
    entries = build_sop_entries(_make_paper(), [ai_result], [], abstract_only=True)
    assert entries[0]["status"] == "abstract-only"
