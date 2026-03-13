import sys
sys.path.insert(0, ".")
from scripts.build import generate_id

# --- Task 3: ID generation ---

def test_id_strips_numeric_prefix():
    assert generate_id("3.YangAnalChem2010.pdf") == "yanganalchem2010"

def test_id_strips_extension():
    assert generate_id("MyPaper.pdf") == "mypaper"

def test_id_lowercases_and_replaces_spaces():
    assert generate_id("My Paper 2023.pdf") == "my-paper-2023"

def test_id_strips_version_suffix_for_sop():
    assert generate_id("droplet-generation-v2.1.pdf", strip_version=True) == "droplet-generation"

def test_id_handles_chinese_filename():
    assert generate_id("26.IEEE NEMS 2021_591_于子桐.pdf") == "ieee-nems-2021-591"


# --- Task 4: File scanner ---

import os
import json
import tempfile
from pathlib import Path
from scripts.build import scan_directory

def test_scan_papers_returns_journal_entries(tmp_path):
    papers_dir = tmp_path / "1.Journal Articles"
    papers_dir.mkdir(parents=True)
    (papers_dir / "3.YangAnalChem2010.pdf").touch()

    entries = scan_directory(tmp_path)
    assert len(entries["papers"]) == 1
    p = entries["papers"][0]
    assert p["type"] == "journal"
    assert p["year"] == 2010
    assert "yanganalchem2010" in p["id"]

def test_scan_conference_papers(tmp_path):
    conf_dir = tmp_path / "2.Conference Proceedings"
    conf_dir.mkdir(parents=True)
    (conf_dir / "10.YangTransducers2011.pdf").touch()
    entries = scan_directory(tmp_path)
    assert entries["papers"][0]["type"] == "conference"

def test_scan_sops(tmp_path):
    sop_dir = tmp_path / "files" / "sops"
    sop_dir.mkdir(parents=True)
    (sop_dir / "droplet-generation-v2.1.pdf").touch()
    entries = scan_directory(tmp_path)
    assert len(entries["sops"]) == 1
    assert entries["sops"][0]["id"] == "sop-droplet-generation"
    assert entries["sops"][0]["version"] == "v2.1"

def test_scan_presentations_parses_date(tmp_path):
    pres_dir = tmp_path / "files" / "presentations"
    pres_dir.mkdir(parents=True)
    (pres_dir / "2024-03-15-single-cell.pdf").touch()
    entries = scan_directory(tmp_path)
    assert entries["presentations"][0]["date"] == "2024-03-15"


# --- Task 5: data.json + data.js generation ---

from scripts.build import generate_data_files

def test_generate_creates_data_json(tmp_path):
    papers_dir = tmp_path / "1.Journal Articles"
    papers_dir.mkdir(parents=True)
    (papers_dir / "3.YangAnalChem2010.pdf").touch()

    data_dir = tmp_path / "data"
    generate_data_files(root=tmp_path, data_dir=data_dir)

    assert (data_dir / "data.json").exists()
    data = json.loads((data_dir / "data.json").read_text(encoding="utf-8"))
    assert "papers" in data
    assert "meta" in data

def test_generate_creates_data_js(tmp_path):
    data_dir = tmp_path / "data"
    generate_data_files(root=tmp_path, data_dir=data_dir)
    js = (data_dir / "data.js").read_text(encoding="utf-8")
    assert js.startswith("window.DATA =")
    assert js.endswith(";")

def test_rebuild_preserves_notes(tmp_path):
    papers_dir = tmp_path / "1.Journal Articles"
    papers_dir.mkdir(parents=True)
    (papers_dir / "3.YangAnalChem2010.pdf").touch()
    data_dir = tmp_path / "data"

    # First build
    generate_data_files(root=tmp_path, data_dir=data_dir)

    # Manually add notes
    data = json.loads((data_dir / "data.json").read_text(encoding="utf-8"))
    data["papers"][0]["notes"]["zh"] = "重要的一篇"
    (data_dir / "data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    # Rebuild
    generate_data_files(root=tmp_path, data_dir=data_dir, rebuild=True)
    data2 = json.loads((data_dir / "data.json").read_text(encoding="utf-8"))
    assert data2["papers"][0]["notes"]["zh"] == "重要的一篇"


# --- Task 9: Data contract tests ---

def test_archived_sop_excluded_from_scan(tmp_path):
    """build.py never marks new SOPs as archived — only --rebuild does."""
    sop_dir = tmp_path / "files" / "sops"
    sop_dir.mkdir(parents=True)
    (sop_dir / "protocol-v1.0.pdf").touch()
    (sop_dir / "protocol-v2.0.pdf").touch()
    entries = scan_directory(tmp_path)
    # Fresh scan: both appear, none archived
    assert all(not s.get("archived") for s in entries["sops"])

def test_rebuild_archives_old_sop_version(tmp_path):
    """After rebuild, older version of same SOP base ID is archived."""
    sop_dir = tmp_path / "files" / "sops"
    sop_dir.mkdir(parents=True)
    (sop_dir / "protocol-v1.0.pdf").touch()
    data_dir = tmp_path / "data"
    generate_data_files(root=tmp_path, data_dir=data_dir)

    # Now add v2.0
    (sop_dir / "protocol-v2.0.pdf").touch()
    generate_data_files(root=tmp_path, data_dir=data_dir, rebuild=True)

    data = json.loads((data_dir / "data.json").read_text(encoding="utf-8"))
    active = [s for s in data["sops"] if not s.get("archived")]
    archived = [s for s in data["sops"] if s.get("archived")]
    assert len(active) == 1
    assert len(archived) == 1

def test_paper_year_extracted_correctly(tmp_path):
    papers_dir = tmp_path / "1.Journal Articles"
    papers_dir.mkdir(parents=True)
    (papers_dir / "3.YangAnalChem2010.pdf").touch()
    entries = scan_directory(tmp_path)
    assert entries["papers"][0]["year"] == 2010

def test_presentation_date_extracted(tmp_path):
    pres_dir = tmp_path / "files" / "presentations"
    pres_dir.mkdir(parents=True)
    (pres_dir / "2024-03-15-single-cell.pdf").touch()
    entries = scan_directory(tmp_path)
    assert entries["presentations"][0]["date"] == "2024-03-15"
