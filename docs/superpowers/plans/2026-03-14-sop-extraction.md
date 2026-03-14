# SOP Extraction Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-extract lab SOPs from paper PDF Methods sections using Claude API, with batch CLI + admin on-demand SSE endpoint, hierarchical category filtering in the SOP library view, and an "Extract SOP" button on paper cards (admin only).

**Architecture:** Core extraction logic lives in `backend/services/sop_service.py` (shared by both the batch CLI and the FastAPI router). The FastAPI router (`sop_extract.py`) exposes a Server-Sent Events endpoint that streams extraction progress to the frontend. The batch CLI (`scripts/extract_sops.py`) iterates over all papers and writes extracted SOPs to `data/data.json`. `build.py` is patched to preserve `status: "auto"` SOPs on `--rebuild`. The frontend SOP library view is rewritten with category/subcategory tabs and expandable cards; paper cards gain an admin-only "Extract SOP" button.

**Tech Stack:** FastAPI, PyMuPDF (fitz), Anthropic SDK (anthropic.AsyncAnthropic, claude-sonnet-4-6), httpx (CrossRef fallback), pytest, Tailwind CSS v3, Vanilla JS

---

## Chunk 1: Backend — build.py + sop_service + SSE router

### Task 1: Protect auto SOPs during `--rebuild`

**Files:**
- Modify: `scripts/build.py:304-318`
- Modify: `tests/test_build.py` (append new test)

- [ ] **Step 1.1: Write the failing test**

  Append to `tests/test_build.py`:

  ```python
  def test_rebuild_preserves_auto_sops(tmp_path):
      """--rebuild must keep status='auto' SOPs; file-based SOPs come first."""
      from scripts.build import generate_data_files
      import json

      # Seed data.json with one file-based SOP and one auto SOP
      data_dir = tmp_path / "data"
      data_dir.mkdir()
      seed = {
          "meta": {"lab": "BioMiND", "directions": []},
          "papers": [], "books": [], "presentations": [],
          "sops": [
              {"id": "sop-manual", "title": "Manual SOP", "version": "v1.0",
               "updated": "", "author": "", "file": "files/sops/manual.pdf",
               "tags": [], "archived": False},
              {"id": "sop-labchip2022-1", "title": "PDMS Chip Prep",
               "status": "auto", "source_paper_id": "labchip2022",
               "category": "微流控器件", "steps": ["Step 1"]},
          ],
      }
      (data_dir / "data.json").write_text(json.dumps(seed), encoding="utf-8")

      generate_data_files(root=tmp_path, data_dir=data_dir, rebuild=True)

      result = json.loads((data_dir / "data.json").read_text(encoding="utf-8"))
      sop_ids = [s["id"] for s in result["sops"]]
      auto_sops = [s for s in result["sops"] if s.get("status") == "auto"]

      assert len(auto_sops) == 1, "auto SOP must be preserved"
      assert auto_sops[0]["id"] == "sop-labchip2022-1"
      # File-based SOPs appear before auto SOPs
      if len(sop_ids) > 1:
          auto_idx = sop_ids.index("sop-labchip2022-1")
          for sid in sop_ids[:auto_idx]:
              matching = next(s for s in result["sops"] if s["id"] == sid)
              assert matching.get("status") != "auto"
  ```

- [ ] **Step 1.2: Run test to verify it fails**

  ```
  pytest tests/test_build.py::test_rebuild_preserves_auto_sops -v
  ```

  Expected: FAIL (auto SOP is lost on rebuild).

- [ ] **Step 1.3: Patch `generate_data_files()` in `scripts/build.py`**

  Inside the `if rebuild:` branch, after `new_data = scanned` (line ~313), add two lines before the merge-notes loop:

  ```python
  # Preserve auto SOPs (AI-extracted) — they are not file-based
  auto_sops = [s for s in existing_data.get("sops", []) if s.get("status") == "auto"]
  new_data["sops"] = new_data["sops"] + auto_sops
  ```

  The full `if rebuild:` block after the edit:

  ```python
  if rebuild:
      archive_old_sop_versions(scanned["sops"])
      for key in ("papers", "books", "sops", "presentations"):
          scanned[key] = deduplicate_ids(scanned[key])
      new_data = scanned
      # Preserve auto SOPs (AI-extracted) — they are not file-based
      auto_sops = [s for s in existing_data.get("sops", []) if s.get("status") == "auto"]
      new_data["sops"] = new_data["sops"] + auto_sops
      for key in ("papers", "books", "sops", "presentations"):
          for i, entry in enumerate(new_data[key]):
              if entry["id"] in existing_by_id:
                  new_data[key][i] = merge_notes(existing_by_id[entry["id"]], entry)
  ```

- [ ] **Step 1.4: Run test to verify it passes**

  ```
  pytest tests/test_build.py -v
  ```

  Expected: all build tests pass (was 16, now 17).

- [ ] **Step 1.5: Commit**

  ```bash
  git add scripts/build.py tests/test_build.py
  git commit -m "feat: preserve auto SOPs on build --rebuild"
  ```

---

### Task 2: `backend/services/sop_service.py` — core extraction logic

**Files:**
- Create: `backend/services/sop_service.py`
- Create: `tests/test_sop_service.py`

The service exposes four functions:
- `extract_pdf_methods(pdf_path)` → methods text string
- `fetch_abstract_from_crossref(doi)` → abstract string or None
- `async call_claude_for_sop(prompt, api_key)` → raw response string
- `build_sop_entries(paper, ai_results, existing_sops)` → list of SOP dicts

- [ ] **Step 2.1: Write failing tests for `extract_pdf_methods` and `build_sop_entries`**

  Create `tests/test_sop_service.py`:

  ```python
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
  ```

- [ ] **Step 2.2: Run tests to verify they fail**

  ```
  pytest tests/test_sop_service.py -v
  ```

  Expected: all 6 tests FAIL (module doesn't exist yet).

- [ ] **Step 2.3: Create `backend/services/sop_service.py`**

  ```python
  """
  SOP extraction service.

  Used by both:
  - scripts/extract_sops.py  (batch CLI)
  - backend/routers/sop_extract.py  (on-demand SSE endpoint)
  """
  from __future__ import annotations

  import json
  import re
  from pathlib import Path
  from typing import AsyncIterator

  try:
      import fitz  # PyMuPDF
  except ImportError:
      fitz = None  # type: ignore[assignment]

  # Methods section heading patterns
  _METHODS_RE = re.compile(
      r'(?:^|\n)(?:(?:\d+\.?\s+)?'
      r'(?:Materials?\s+and\s+Methods?|Experimental\s+(?:Section|Methods?|Procedures?)'
      r'|Methods?|实验方法|方法|实验部分))\s*\n',
      re.IGNORECASE | re.MULTILINE,
  )
  # Next section heading (stops methods extraction)
  _NEXT_SECTION_RE = re.compile(
      r'\n(?:\d+\.?\s+)?(?:Results?|Discussion|Conclusion|Acknowledgement|References?|Supporting)\b',
      re.IGNORECASE,
  )

  _PROMPT_FULL = """\
  你是实验室 SOP 整理助手。从以下论文 Methods 章节提取完整实验协议。

  严格要求：
  - steps 字段必须完整还原原文每一步，禁止合并或省略任何操作
  - 所有数值参数（浓度、温度、时间、转速、体积、功率）必须原文保留
  - 若原文包含多个独立 protocol，分别生成多个对象（返回 JSON 数组）
  - 不得用"按常规操作"等模糊表述替代具体步骤
  - materials 列出所有试剂和仪器（含型号/货号如有）

  返回格式：JSON 数组，每个元素包含以下字段：
    title (string)          - 简明描述该操作，如"PDMS 芯片制备"
    category (string)       - 从以下四项选一：微流控器件/生物样本处理/检测与表征/数据分析
    subcategory (string)    - 自行细化
    purpose (string)        - 1-2 句说明该操作的目的
    materials (list)        - 所有试剂和仪器
    steps (list)            - 编号步骤，完整原文
    protocol_notes (list)   - 安全提示、关键参数、注意事项
    tags (list)             - 关键词
    responsible (string)    - 第一作者姓名

  论文信息：
    标题：{title}
    作者：{authors}
    年份：{year}
    期刊：{journal}

  Methods 文本：
  {methods_text}
  """

  _PROMPT_ABSTRACT = """\
  从以下论文摘要提取基本信息（无完整 Methods 文本）。
  仅填充 title/category/subcategory/tags/purpose，steps/materials 留空列表。
  返回格式：单个 JSON 对象（非数组）。

  论文信息：
    标题：{title}
    作者：{authors}
    年份：{year}
    期刊：{journal}

  摘要：{abstract_text}
  """


  # ---------------------------------------------------------------------------
  # PDF Methods extraction
  # ---------------------------------------------------------------------------

  def extract_pdf_methods(pdf_path: Path) -> str:
      """Extract the Methods section text from a PDF. Returns '' on failure."""
      if fitz is None or not pdf_path.exists():
          return ""
      try:
          doc = fitz.open(str(pdf_path))
          full_text = "\n".join(doc[i].get_text() for i in range(len(doc)))
          doc.close()
      except Exception:
          return ""

      # Find Methods section
      m = _METHODS_RE.search(full_text)
      if not m:
          return ""

      section = full_text[m.end():]

      # Cut at next major heading
      end = _NEXT_SECTION_RE.search(section)
      if end:
          section = section[: end.start()]

      section = section.strip()
      if len(section) > 8000:
          section = section[:8000]
      return section


  # ---------------------------------------------------------------------------
  # CrossRef abstract fallback
  # ---------------------------------------------------------------------------

  def fetch_abstract_from_crossref(doi: str) -> str | None:
      """Fetch abstract from CrossRef for papers with no extractable Methods."""
      import httpx
      try:
          url = f"https://api.crossref.org/works/{doi}"
          resp = httpx.get(url, timeout=15, headers={"User-Agent": "BioMiND/1.0"})
          resp.raise_for_status()
          data = resp.json()
          return data.get("message", {}).get("abstract") or None
      except Exception:
          return None


  # ---------------------------------------------------------------------------
  # Claude API call
  # ---------------------------------------------------------------------------

  async def call_claude_for_sop(prompt: str, api_key: str) -> str:
      """Stream claude-sonnet-4-6 and return complete response text."""
      import anthropic
      client = anthropic.AsyncAnthropic(api_key=api_key)
      chunks: list[str] = []
      async with client.messages.stream(
          model="claude-sonnet-4-6",
          max_tokens=8192,
          messages=[{"role": "user", "content": prompt}],
      ) as stream:
          async for text in stream.text_stream:
              chunks.append(text)
      return "".join(chunks)


  def parse_json_response(text: str) -> list[dict]:
      """Parse Claude's response into a list of SOP dicts. Strips markdown fences."""
      # Strip ```json ... ``` or ``` ... ``` wrappers
      m = re.search(r"```(?:json)?\s*([\[{].*?)\s*```", text, re.DOTALL)
      if m:
          text = m.group(1)
      text = text.strip()
      parsed = json.loads(text)
      if isinstance(parsed, dict):
          parsed = [parsed]
      return parsed


  # ---------------------------------------------------------------------------
  # Build SOP entry dicts
  # ---------------------------------------------------------------------------

  def build_sop_entries(
      paper: dict,
      ai_results: list[dict],
      existing_sops: list[dict],
      abstract_only: bool = False,
  ) -> list[dict]:
      """
      Construct final SOP entry dicts from AI results.

      - Assigns IDs: sop-{paper_id}-{n}, starting after highest existing n
      - Fills source_paper_id, source_doi, reference, updated, version, status
      """
      paper_id = paper["id"]
      doi = paper.get("doi", "")
      year = str(paper.get("year", ""))
      journal = paper.get("journal", "")
      authors = paper.get("authors", [])
      first_author_last = authors[0].split()[-1] if authors else ""
      title = paper.get("title", "")

      # Find the highest existing n for this paper
      pattern = re.compile(rf"^sop-{re.escape(paper_id)}-(\d+)$")
      existing_ns = [
          int(m.group(1))
          for s in existing_sops
          if (m := pattern.match(s.get("id", "")))
      ]
      next_n = max(existing_ns, default=0) + 1

      reference = f"{first_author_last} et al., {journal}, {year}"
      if doi:
          reference += f", DOI: {doi}"

      status = "abstract-only" if abstract_only else "auto"
      entries: list[dict] = []
      for result in ai_results:
          entry = {
              "id": f"sop-{paper_id}-{next_n}",
              "title": result.get("title", ""),
              "category": result.get("category", ""),
              "subcategory": result.get("subcategory", ""),
              "version": "v1.0",
              "source_paper_id": paper_id,
              "source_doi": doi,
              "responsible": result.get("responsible", ""),
              "updated": year,
              "tags": result.get("tags", []),
              "status": status,
              "purpose": result.get("purpose", ""),
              "materials": result.get("materials", []),
              "steps": result.get("steps", []),
              "protocol_notes": result.get("protocol_notes", []),
              "reference": reference,
              "archived": False,
          }
          entries.append(entry)
          next_n += 1
      return entries


  # ---------------------------------------------------------------------------
  # Full extraction pipeline for one paper
  # ---------------------------------------------------------------------------

  async def extract_sop_for_paper(
      paper: dict,
      root: Path,
      api_key: str,
      existing_sops: list[dict],
  ) -> list[dict]:
      """
      Run the full extraction pipeline for a single paper.

      Returns a list of new SOP entry dicts (empty list if extraction failed).
      """
      pdf_path = root / paper["file"]
      methods_text = extract_pdf_methods(pdf_path)
      abstract_only = False

      if len(methods_text) < 200:
          doi = paper.get("doi", "")
          if doi:
              abstract = fetch_abstract_from_crossref(doi)
              if abstract:
                  abstract_only = True
                  prompt = _PROMPT_ABSTRACT.format(
                      title=paper.get("title", ""),
                      authors=", ".join(paper.get("authors", [])),
                      year=paper.get("year", ""),
                      journal=paper.get("journal", ""),
                      abstract_text=abstract,
                  )
              else:
                  return []
          else:
              return []
      else:
          prompt = _PROMPT_FULL.format(
              title=paper.get("title", ""),
              authors=", ".join(paper.get("authors", [])),
              year=paper.get("year", ""),
              journal=paper.get("journal", ""),
              methods_text=methods_text,
          )

      response_text = await call_claude_for_sop(prompt, api_key)
      ai_results = parse_json_response(response_text)
      return build_sop_entries(paper, ai_results, existing_sops, abstract_only)
  ```

- [ ] **Step 2.4: Run tests to verify they pass**

  ```
  pytest tests/test_sop_service.py -v
  ```

  Expected: all 6 tests PASS.

- [ ] **Step 2.5: Run full test suite to verify nothing broken**

  ```
  pytest -v
  ```

  Expected: all 55 tests pass (49 original + 6 new).

- [ ] **Step 2.6: Commit**

  ```bash
  git add backend/services/sop_service.py tests/test_sop_service.py
  git commit -m "feat: sop_service — PDF extraction, Claude call, entry builder"
  ```

---

### Task 3: SSE endpoint `POST /api/extract-sop` + register in `main.py`

**Files:**
- Create: `backend/routers/sop_extract.py`
- Modify: `backend/main.py`
- Create: `tests/test_sop_extract_router.py`

- [ ] **Step 3.1: Write failing tests**

  Create `tests/test_sop_extract_router.py`:

  ```python
  """Tests for POST /api/extract-sop SSE endpoint."""
  import time
  import json
  import pytest
  import jwt as pyjwt
  from fastapi.testclient import TestClient


  def _token(username: str, is_admin: bool, secret: str = "test-secret") -> str:
      return pyjwt.encode(
          {"sub": username, "is_admin": is_admin, "exp": time.time() + 3600},
          secret, algorithm="HS256",
      )


  @pytest.fixture(autouse=True)
  def patch_jwt(monkeypatch):
      monkeypatch.setenv("JWT_SECRET", "test-secret")
      import backend.config as cfg
      monkeypatch.setattr(cfg, "JWT_SECRET", "test-secret")


  @pytest.fixture
  def client():
      from backend.main import app
      return TestClient(app)


  def auth(is_admin: bool = False) -> dict:
      return {"Authorization": f"Bearer {_token('alice', is_admin)}"}


  def test_extract_sop_unauthenticated(client):
      resp = client.post("/api/extract-sop", json={"paper_id": "test"})
      assert resp.status_code == 401


  def test_extract_sop_non_admin_forbidden(client):
      resp = client.post(
          "/api/extract-sop",
          json={"paper_id": "test"},
          headers=auth(is_admin=False),
      )
      assert resp.status_code == 403


  def test_extract_sop_paper_not_found(client, monkeypatch, tmp_path):
      # Patch data.json to have no papers
      import backend.routers.sop_extract as mod
      monkeypatch.setattr(mod, "_ROOT", tmp_path)
      data_dir = tmp_path / "data"
      data_dir.mkdir()
      (data_dir / "data.json").write_text(
          json.dumps({"meta": {}, "papers": [], "sops": []}), encoding="utf-8"
      )
      resp = client.post(
          "/api/extract-sop",
          json={"paper_id": "nonexistent"},
          headers=auth(is_admin=True),
      )
      assert resp.status_code == 404


  def test_extract_sop_success_sse(client, monkeypatch, tmp_path):
      """SSE stream contains progress + done events when extraction succeeds."""
      import backend.routers.sop_extract as mod
      import backend.services.sop_service as svc

      monkeypatch.setattr(mod, "_ROOT", tmp_path)

      # Seed data.json with one paper
      data_dir = tmp_path / "data"
      data_dir.mkdir()
      paper = {
          "id": "labchip2022", "title": "Test Paper", "authors": ["Lin Zeng"],
          "year": 2022, "journal": "Lab on a Chip", "doi": "10.1039/test",
          "file": "1.Journal Articles/test.pdf", "type": "journal",
      }
      (data_dir / "data.json").write_text(
          json.dumps({"meta": {}, "papers": [paper], "sops": []}), encoding="utf-8"
      )

      # Mock the extraction to avoid real API call
      async def fake_extract(p, root, api_key, existing):
          return [{
              "id": "sop-labchip2022-1", "title": "PDMS Chip", "status": "auto",
              "source_paper_id": "labchip2022", "category": "微流控器件",
              "subcategory": "芯片制备", "steps": ["Step 1"],
          }]
      monkeypatch.setattr(svc, "extract_sop_for_paper", fake_extract)

      # Mock generate_data_files to avoid file scanning
      import scripts.build as build_mod
      monkeypatch.setattr(build_mod, "generate_data_files", lambda **kw: None)

      resp = client.post(
          "/api/extract-sop",
          json={"paper_id": "labchip2022"},
          headers=auth(is_admin=True),
      )
      assert resp.status_code == 200
      assert "text/event-stream" in resp.headers["content-type"]

      events = []
      for line in resp.text.splitlines():
          if line.startswith("data: "):
              events.append(json.loads(line[6:]))

      types = [e["type"] for e in events]
      assert "progress" in types
      assert "done" in types
      done_event = next(e for e in events if e["type"] == "done")
      assert "sop-labchip2022-1" in done_event["sop_ids"]
  ```

- [ ] **Step 3.2: Run tests to verify they fail**

  ```
  pytest tests/test_sop_extract_router.py -v
  ```

  Expected: 4 tests FAIL (router doesn't exist).

- [ ] **Step 3.3: Create `backend/routers/sop_extract.py`**

  ```python
  """
  POST /api/extract-sop  — on-demand SOP extraction (admin only, SSE)

  Request body: { "paper_id": "labchip2022" }

  SSE events:
      data: {"type": "progress", "status": "extracting", "message": "..."}
      data: {"type": "progress", "status": "ai_processing", "message": "..."}
      data: {"type": "done", "sop_ids": ["sop-labchip2022-1"]}
      data: {"type": "error", "message": "..."}
  """
  from __future__ import annotations

  import asyncio
  import json
  from pathlib import Path

  from fastapi import APIRouter, Depends
  from fastapi.responses import JSONResponse, StreamingResponse
  from pydantic import BaseModel

  from backend.config import CLAUDE_API_KEY
  from backend.deps import current_user
  from backend.services.sop_service import extract_sop_for_paper

  router = APIRouter(prefix="/api")

  _ROOT = Path(__file__).parent.parent.parent


  class ExtractRequest(BaseModel):
      paper_id: str


  @router.post("/extract-sop")
  async def extract_sop(
      req: ExtractRequest,
      user: dict = Depends(current_user),
  ):
      if not user["is_admin"]:
          return JSONResponse({"detail": "Admin only"}, status_code=403)

      # Load data.json to find the paper
      data_path = _ROOT / "data" / "data.json"
      try:
          data = json.loads(data_path.read_text(encoding="utf-8"))
      except Exception:
          return JSONResponse({"detail": "data.json not found"}, status_code=500)

      paper = next((p for p in data.get("papers", []) if p["id"] == req.paper_id), None)
      if paper is None:
          return JSONResponse({"detail": f"Paper '{req.paper_id}' not found"}, status_code=404)

      async def event_stream():
          yield _sse({"type": "progress", "status": "extracting",
                      "message": "正在提取 PDF 文本..."})
          try:
              existing_sops = data.get("sops", [])
              yield _sse({"type": "progress", "status": "ai_processing",
                          "message": "AI 分析中..."})
              new_entries = await extract_sop_for_paper(
                  paper, _ROOT, CLAUDE_API_KEY, existing_sops
              )

              if not new_entries:
                  yield _sse({"type": "error",
                              "message": "无法提取 SOP：PDF 文本不足且无 DOI 摘要"})
                  return

              # Write to data.json
              data["sops"] = existing_sops + new_entries
              data_path.write_text(
                  json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
              )

              # Regenerate data.js in thread pool (non-blocking)
              from scripts.build import generate_data_files
              loop = asyncio.get_running_loop()
              await loop.run_in_executor(
                  None, lambda: generate_data_files(root=_ROOT, rebuild=False)
              )

              yield _sse({"type": "done", "sop_ids": [e["id"] for e in new_entries]})

          except Exception as exc:
              yield _sse({"type": "error", "message": str(exc)})

      return StreamingResponse(
          event_stream(),
          media_type="text/event-stream",
          headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
      )


  def _sse(payload: dict) -> str:
      return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
  ```

- [ ] **Step 3.4: Register router in `backend/main.py`**

  Add import and `app.include_router()` call:

  ```python
  from backend.routers.sop_extract import router as sop_extract_router
  # ... existing imports ...
  app.include_router(sop_extract_router)
  ```

  Full updated `backend/main.py`:

  ```python
  from fastapi import FastAPI
  from fastapi.staticfiles import StaticFiles
  from pathlib import Path
  from backend.routers.files import router as files_router
  from backend.routers.downloads import router as downloads_router
  from backend.routers.auth import router as auth_router
  from backend.routers.chat import router as chat_router
  from backend.routers.conversations import router as conversations_router
  from backend.routers.sop_extract import router as sop_extract_router

  app = FastAPI(title="BioMiND")

  app.include_router(auth_router)
  app.include_router(files_router)
  app.include_router(downloads_router)
  app.include_router(chat_router)
  app.include_router(conversations_router)
  app.include_router(sop_extract_router)

  @app.get("/api/health")
  def health():
      return {"status": "ok"}

  root = Path(__file__).parent.parent

  data_dir = root / "data"
  data_dir.mkdir(exist_ok=True)
  app.mount("/data", StaticFiles(directory=str(data_dir)), name="data")

  frontend_dir = root / "frontend"
  if frontend_dir.exists():
      app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
  ```

- [ ] **Step 3.5: Run tests to verify they pass**

  ```
  pytest tests/test_sop_extract_router.py -v
  ```

  Expected: all 4 tests PASS.

- [ ] **Step 3.6: Run full test suite**

  ```
  pytest -v
  ```

  Expected: all 59 tests pass.

- [ ] **Step 3.7: Commit**

  ```bash
  git add backend/routers/sop_extract.py backend/main.py tests/test_sop_extract_router.py
  git commit -m "feat: POST /api/extract-sop SSE endpoint (admin auth)"
  ```

---

## Chunk 2: Batch CLI — `scripts/extract_sops.py`

### Task 4: Batch extraction CLI

**Files:**
- Create: `scripts/extract_sops.py`

This script has no automated tests (requires real PDFs and Claude API key). It is verified manually with `--dry-run`.

- [ ] **Step 4.1: Create `scripts/extract_sops.py`**

  ```python
  """
  Batch SOP extraction script.

  Extracts experiment protocols from paper PDFs and writes them to data/data.json.

  Usage:
      python scripts/extract_sops.py            # skip already-extracted papers
      python scripts/extract_sops.py --force    # re-extract all papers
      python scripts/extract_sops.py --dry-run  # print papers that would be processed
  """
  from __future__ import annotations

  import argparse
  import asyncio
  import json
  import sys
  from pathlib import Path

  _ROOT = Path(__file__).parent.parent
  sys.path.insert(0, str(_ROOT))

  from backend.config import CLAUDE_API_KEY
  from backend.services.sop_service import extract_sop_for_paper
  from scripts.build import generate_data_files


  def _load_data() -> dict:
      path = _ROOT / "data" / "data.json"
      return json.loads(path.read_text(encoding="utf-8"))


  def _save_data(data: dict) -> None:
      path = _ROOT / "data" / "data.json"
      path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


  def _already_extracted(paper_id: str, sops: list[dict]) -> bool:
      return any(s.get("source_paper_id") == paper_id for s in sops)


  async def _run(force: bool, dry_run: bool) -> None:
      if not CLAUDE_API_KEY:
          print("ERROR: CLAUDE_API_KEY not set. Aborting.", file=sys.stderr)
          sys.exit(1)

      data = _load_data()
      papers = [p for p in data.get("papers", []) if not p.get("archived")]
      sops = data.get("sops", [])

      to_process = [
          p for p in papers
          if force or not _already_extracted(p["id"], sops)
      ]

      if dry_run:
          print(f"Would process {len(to_process)} paper(s):")
          for p in to_process:
              print(f"  {p['id']}: {p.get('title', '(no title)')}")
          return

      print(f"Processing {len(to_process)} paper(s)...")
      any_new = False

      for i, paper in enumerate(to_process, 1):
          print(f"[{i}/{len(to_process)}] {paper['id']} — {paper.get('title', '')[:60]}")
          try:
              new_entries = await extract_sop_for_paper(
                  paper, _ROOT, CLAUDE_API_KEY, sops
              )
          except Exception as exc:
              print(f"  ERROR: {exc}")
              continue

          if not new_entries:
              print("  SKIP: could not extract (short text, no DOI)")
              continue

          for e in new_entries:
              print(f"  → {e['id']}: {e['title']}")
          sops.extend(new_entries)
          any_new = True

      if any_new:
          data["sops"] = sops
          _save_data(data)
          print("Regenerating data.js...")
          generate_data_files(root=_ROOT, rebuild=False)
          print("Done.")
      else:
          print("No new SOPs extracted.")


  if __name__ == "__main__":
      parser = argparse.ArgumentParser(description="Batch SOP extraction")
      parser.add_argument("--force", action="store_true",
                          help="Re-extract even if SOPs already exist")
      parser.add_argument("--dry-run", action="store_true",
                          help="Print papers to be processed without calling API")
      args = parser.parse_args()
      asyncio.run(_run(args.force, args.dry_run))
  ```

- [ ] **Step 4.2: Verify dry-run works (no API key required)**

  ```
  python scripts/extract_sops.py --dry-run
  ```

  Expected: prints list of papers that would be processed (no Claude API call made).

- [ ] **Step 4.3: Commit**

  ```bash
  git add scripts/extract_sops.py
  git commit -m "feat: batch SOP extraction CLI (extract_sops.py)"
  ```

---

## Chunk 3: Frontend — i18n, CSS, app.js

### Task 5: Extend i18n `sop` namespace

**Files:**
- Modify: `frontend/i18n/zh.js`
- Modify: `frontend/i18n/en.js`

- [ ] **Step 5.1: Update `frontend/i18n/zh.js`**

  Replace the `sop` object (lines 26-31) with:

  ```javascript
  sop: {
    version: "版本",
    updated: "更新日期",
    author: "负责人",
    openPdf: "打开 SOP",
    categoryAll: "全部",
    catMicrofluidics: "微流控器件",
    catBioSample: "生物样本处理",
    catDetection: "检测与表征",
    catDataAnalysis: "数据分析",
    btnExtract: "📋 提取 SOP",
    btnViewSop: "查看 SOP →",
    progressExtracting: "正在提取 PDF 文本...",
    progressAI: "AI 分析中...",
    progressDone: "提取完成，刷新中...",
    progressError: "提取失败：",
    fieldPurpose: "目的",
    fieldMaterials: "所需材料",
    fieldSteps: "操作步骤",
    fieldNotes: "注意事项",
    fieldSource: "来源论文",
    fieldResponsible: "负责人",
    statusAutoLabel: "AI 提取",
    statusAbstractOnly: "仅摘要",
  },
  ```

- [ ] **Step 5.2: Update `frontend/i18n/en.js`**

  Replace the `sop` object (lines 26-31) with:

  ```javascript
  sop: {
    version: "Version",
    updated: "Updated",
    author: "Author",
    openPdf: "Open SOP",
    categoryAll: "All",
    catMicrofluidics: "Microfluidics",
    catBioSample: "Bio Samples",
    catDetection: "Detection",
    catDataAnalysis: "Data Analysis",
    btnExtract: "📋 Extract SOP",
    btnViewSop: "View SOP →",
    progressExtracting: "Extracting PDF text...",
    progressAI: "AI processing...",
    progressDone: "Done, reloading...",
    progressError: "Extraction failed: ",
    fieldPurpose: "Purpose",
    fieldMaterials: "Materials",
    fieldSteps: "Steps",
    fieldNotes: "Notes",
    fieldSource: "Source Paper",
    fieldResponsible: "Responsible",
    statusAutoLabel: "AI Extracted",
    statusAbstractOnly: "Abstract Only",
  },
  ```

- [ ] **Step 5.3: Commit**

  ```bash
  git add frontend/i18n/zh.js frontend/i18n/en.js
  git commit -m "feat: i18n sop namespace extensions for AI extraction UI"
  ```

---

### Task 6: SOP card CSS styles

**Files:**
- Modify: `frontend/assets/input.css`
- Rebuild: `frontend/assets/style.css`

- [ ] **Step 6.1: Append SOP card styles to `frontend/assets/input.css`**

  Append after the last existing rule:

  ```css
  /* ── SOP Library: Category tabs ── */
  .sop-cat-tab {
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 8px 8px 0 0;
    border: 1px solid transparent;
    cursor: pointer;
    transition: color .15s, background .15s;
    color: #6b7280;
  }
  .sop-cat-tab.active {
    background: white;
    border-color: #e5e7eb;
    border-bottom-color: white;
    color: #2563eb;
  }
  .sop-cat-tab:hover:not(.active) {
    color: #374151;
  }

  /* ── SOP Library: Expandable card ── */
  .sop-card-expand-icon {
    transition: transform .2s;
    display: inline-block;
  }
  .sop-card-expand-icon.open {
    transform: rotate(180deg);
  }

  /* ── SOP Library: Steps list ── */
  .sop-steps-list li {
    padding: 3px 0;
    border-bottom: 1px solid #f3f4f6;
  }
  .sop-steps-list li:last-child {
    border-bottom: none;
  }
  ```

- [ ] **Step 6.2: Recompile Tailwind CSS**

  ```
  node_modules/.bin/tailwindcss -i frontend/assets/input.css -o frontend/assets/style.css --minify
  ```

  Expected: `frontend/assets/style.css` updated without errors.

- [ ] **Step 6.3: Commit**

  ```bash
  git add frontend/assets/input.css frontend/assets/style.css
  git commit -m "feat: SOP card expand styles (Tailwind recompile)"
  ```

---

### Task 7: `window.__isAdmin` — auth persistence

**Files:**
- Modify: `frontend/assets/app.js` (auth section, lines 30-38 and 129-165)

The goal: admin status is stored in `localStorage` alongside the token, set at login/register, read in `boot()`.

- [ ] **Step 7.1: Update `setAuth()` to accept and store `isAdmin`**

  Replace lines 30-43 (setAuth, clearAuth, authHeaders):

  ```javascript
  function setAuth(token, username, isAdmin) {
    localStorage.setItem("biomind_token", token);
    localStorage.setItem("biomind_username", username);
    localStorage.setItem("biomind_is_admin", isAdmin ? "true" : "false");
    window.__isAdmin = isAdmin === true;
  }

  function clearAuth() {
    localStorage.removeItem("biomind_token");
    localStorage.removeItem("biomind_username");
    localStorage.removeItem("biomind_is_admin");
    window.__isAdmin = false;
  }

  function authHeaders() {
    const tok = getToken();
    return tok ? { "Authorization": `Bearer ${tok}` } : {};
  }
  ```

- [ ] **Step 7.2: Update login handler to pass `is_admin` to `setAuth`**

  In the login submit handler (around line 130), change:
  ```javascript
  setAuth(data.access_token, data.username);
  ```
  to:
  ```javascript
  setAuth(data.access_token, data.username, data.is_admin === true);
  ```

- [ ] **Step 7.3: Update register handler to pass `is_admin` to `setAuth`**

  In the register submit handler (around line 159), change:
  ```javascript
  setAuth(data.access_token, data.username);
  ```
  to:
  ```javascript
  setAuth(data.access_token, data.username, data.is_admin === true);
  ```

- [ ] **Step 7.4: Initialize `window.__isAdmin` in `boot()`**

  In `boot()` (around line 799), add before `applyI18n()`:

  ```javascript
  window.__isAdmin = localStorage.getItem("biomind_is_admin") === "true";
  ```

  Full updated `boot()`:

  ```javascript
  async function boot() {
    window.__isAdmin = localStorage.getItem("biomind_is_admin") === "true";
    applyI18n();
    updateNavUser();
    const hash = location.hash.replace("#", "") || "home";
    showView(hash);
    renderView(hash);
  }
  ```

- [ ] **Step 7.5: Verify manually**

  Start the server, log in as the first user (admin), open DevTools console and run `window.__isAdmin`. Expected: `true`. Log out, run again. Expected: `false`.

- [ ] **Step 7.6: Commit**

  ```bash
  git add frontend/assets/app.js
  git commit -m "feat: window.__isAdmin persisted in localStorage at login"
  ```

---

### Task 8: Rewrite `renderSops()` and update `paperCard()` + event delegation

**Files:**
- Modify: `frontend/assets/app.js` (SOP library section lines 508-558, `paperCard` lines 360-385, and `boot` for event delegation)

- [ ] **Step 8.1: Replace SOP Library state variables and `renderSops()` / `sopCard()` functions**

  Replace the entire SOP Library section (lines 508-558 — `sopSearchQuery`, `selectedSopTags`, `renderSops()`, `toggleSopTag()`). Note: `toggleSopTag()` is intentionally removed; it was only called from inline `onclick` attributes inside the old `renderSops()` HTML which is being fully replaced. Replace with the following:

  ```javascript
  // ── SOP Library ───────────────────────────────────────────────────
  let sopSearchQuery = "";
  let selectedSopCategory = "";
  let selectedSopSubcategory = "";

  const _SOP_CATS = ["微流控器件", "生物样本处理", "检测与表征", "数据分析"];

  function sopCard(s) {
    const isAuto = s.status === "auto" || s.status === "abstract-only";
    const responsible = s.responsible || s.author || "";

    // Source info line: find the source paper for journal+year
    let sourceInfo = s.updated || "";
    if (s.source_paper_id && window.DATA && window.DATA.papers) {
      const src = window.DATA.papers.find(p => p.id === s.source_paper_id);
      if (src) sourceInfo = [src.journal, s.updated].filter(Boolean).join(" ");
    }

    // Category badge (auto SOPs only)
    const catBadge = isAuto && s.category
      ? `<span class="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">${s.category}${s.subcategory ? " › " + s.subcategory : ""}</span>`
      : "";

    // Status badge
    const statusBadge = s.status === "abstract-only"
      ? `<span class="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">${t("sop.statusAbstractOnly")}</span>`
      : isAuto
      ? `<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">🤖 ${t("sop.statusAutoLabel")}</span>`
      : "";

    const tags = (s.tags || [])
      .map(tag => `<span class="text-xs bg-yellow-50 text-yellow-600 px-2 py-0.5 rounded-full">${tag}</span>`)
      .join("");

    // Expanded content: steps-based (auto) or PDF link (file-based)
    let expandedContent = "";
    if (s.steps && s.steps.length) {
      const mats = (s.materials || []).map(m => `<li>${m}</li>`).join("");
      const stps = (s.steps || []).map(st => `<li class="mb-1 pb-1 border-b border-gray-50 last:border-0">${st}</li>`).join("");
      const nts  = (s.protocol_notes || []).map(n => `<li>${n}</li>`).join("");
      expandedContent = `
        ${s.purpose ? `<p class="text-xs text-gray-700 mb-3"><span class="font-semibold">${t("sop.fieldPurpose")}：</span>${s.purpose}</p>` : ""}
        ${mats ? `<div class="mb-3"><p class="text-xs font-semibold text-gray-600 mb-1">${t("sop.fieldMaterials")}</p><ul class="text-xs text-gray-600 list-disc ml-4 space-y-0.5">${mats}</ul></div>` : ""}
        ${stps ? `<div class="mb-3"><p class="text-xs font-semibold text-gray-600 mb-1">${t("sop.fieldSteps")}</p><ol class="text-xs text-gray-600 list-decimal ml-4">${stps}</ol></div>` : ""}
        ${nts  ? `<div class="mb-2"><p class="text-xs font-semibold text-gray-600 mb-1">${t("sop.fieldNotes")}</p><ul class="text-xs text-gray-600 list-disc ml-4">${nts}</ul></div>` : ""}
        ${s.reference ? `<p class="text-xs text-gray-400 italic mt-2">${t("sop.fieldSource")}: ${s.reference}</p>` : ""}`;
    } else if (s.file) {
      expandedContent = `<a href="/api/files/${encodeURIComponent(s.file).replace(/%2F/g,'/')}" target="_blank" class="text-xs text-blue-500 hover:underline">↗ ${t("sop.openPdf")}</a>`;
    }

    return `
      <div class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition">
        <div class="flex items-start justify-between gap-2 cursor-pointer"
             onclick="const d=this.closest('.bg-white').querySelector('.sop-detail');d.classList.toggle('hidden');this.querySelector('.sop-card-expand-icon').classList.toggle('open')">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1 mb-1.5 flex-wrap">
              ${statusBadge}${catBadge}
            </div>
            <p class="text-sm font-medium text-gray-900">${isAuto ? "📋 " : ""}${s.title || s.id}</p>
            <p class="text-xs text-gray-500 mt-0.5">${[responsible ? t("sop.fieldResponsible") + ": " + responsible : "", sourceInfo, s.version].filter(Boolean).join(" · ")}</p>
            ${tags ? `<div class="flex flex-wrap gap-1 mt-1.5">${tags}</div>` : ""}
          </div>
          <span class="sop-card-expand-icon text-xs text-gray-400 flex-shrink-0 mt-1">▼</span>
        </div>
        <div class="sop-detail hidden mt-3 pt-3 border-t border-gray-100 text-sm">${expandedContent}</div>
      </div>`;
  }

  function renderSops() {
    const data = window.DATA;
    const allSops = data.sops.filter(s => !s.archived);

    // Category filter
    let filtered = selectedSopCategory
      ? allSops.filter(s => s.category === selectedSopCategory)
      : allSops;

    // Subcategory filter
    if (selectedSopCategory && selectedSopSubcategory) {
      filtered = filtered.filter(s => s.subcategory === selectedSopSubcategory);
    }

    // Search filter (title + purpose + tags)
    if (sopSearchQuery) {
      const q = sopSearchQuery.toLowerCase();
      filtered = filtered.filter(s =>
        [s.title, s.purpose, ...(s.tags || [])].filter(Boolean).join(" ").toLowerCase().includes(q)
      );
    }

    // Category tabs
    const catTabItems = [{ label: t("sop.categoryAll"), val: "" }, ..._SOP_CATS.map(c => ({ label: c, val: c }))];
    const catTabs = catTabItems.map(({ label, val }) => {
      const active = selectedSopCategory === val;
      return `<button onclick="selectedSopCategory='${val}';selectedSopSubcategory='';renderSops()"
        class="sop-cat-tab${active ? ' active' : ''}">${label}</button>`;
    }).join("");

    // Subcategory buttons (only when a category is selected)
    let subRow = "";
    if (selectedSopCategory) {
      const subs = [...new Set(
        allSops.filter(s => s.category === selectedSopCategory && s.subcategory).map(s => s.subcategory)
      )];
      if (subs.length) {
        subRow = `<div class="flex flex-wrap gap-2 mb-3">
          ${subs.map(sub => `<button onclick="selectedSopSubcategory=selectedSopSubcategory==='${sub}'?'':'${sub}';renderSops()"
            class="px-3 py-1 rounded-full text-xs border ${selectedSopSubcategory === sub ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'}">${sub}</button>`).join("")}
        </div>`;
      }
    }

    document.getElementById("view-sops").innerHTML = `
      <div class="border-b border-gray-200 mb-0 flex gap-0.5">${catTabs}</div>
      <div class="bg-white border border-t-0 border-gray-200 rounded-b-lg px-4 py-3 mb-4">
        ${subRow}
        <input type="text" placeholder="${t("search.placeholder")}"
          value="${sopSearchQuery}"
          oninput="sopSearchQuery=this.value;renderSops()"
          class="border rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
      <div class="space-y-3">${filtered.map(sopCard).join("") || `<p class="text-gray-400 py-12 text-center">${t("noResults")}</p>`}</div>`;
  }
  ```

  Note: the old `sopSearchCard()` function (used in timeline and search views) is kept as-is for now — it still renders a simple card for SOPs appearing in timeline/search results. Only the dedicated SOP library view (`#view-sops`) gets the new card style.

- [ ] **Step 8.2: Update `paperCard()` to add admin-only Extract SOP button**

  In `paperCard(p)` (line 360), add `sopBtn` variable and include it in the card-detail `<div class="flex gap-2 mt-2">`:

  ```javascript
  function paperCard(p) {
    const doi = p.doi ? `<a href="https://doi.org/${p.doi}" target="_blank" class="text-xs text-blue-500 hover:underline ml-2">${t("paper.doi")}: ${p.doi}</a>` : "";
    const pdfLink = p.file ? `<a href="/api/files/${encodeURIComponent(p.file).replace(/%2F/g,'/')}" target="_blank" class="text-xs text-gray-500 hover:text-gray-700 ml-2">↗ ${t("paper.openPdf")}</a>` : "";
    const notes = currentLang === "zh" ? p.notes?.zh : p.notes?.en;

    // Admin-only SOP button
    let sopBtn = "";
    if (window.__isAdmin === true) {
      const hasSop = (window.DATA.sops || []).some(s => s.source_paper_id === p.id);
      if (hasSop) {
        sopBtn = `<button data-action="view-sop" data-paper-id="${p.id}"
          class="text-xs text-purple-600 hover:text-purple-800 ml-2 cursor-pointer">${t("sop.btnViewSop")}</button>`;
      } else {
        sopBtn = `<button data-action="extract-sop" data-paper-id="${p.id}"
          class="text-xs text-green-600 hover:text-green-800 ml-2 cursor-pointer">${t("sop.btnExtract")}</button>`;
      }
    }

    return `
      <div class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition cursor-pointer" onclick="this.querySelector('.card-detail').classList.toggle('hidden')">
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0 w-14">
            <img src="/data/thumbs/${p.id}.png" onerror="this.parentElement.style.display='none'"
                 class="w-14 rounded border border-gray-200 object-cover object-top" style="height:80px" alt="">
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 mb-1 flex-wrap">
              <span class="text-xs px-2 py-0.5 rounded-full font-medium ${paperTypeColor(p.type)}">${t("type." + p.type)}</span>
            </div>
            <p class="text-sm font-medium text-gray-900 leading-snug">${p.title || p.file.split("/").pop()}</p>
            <p class="text-xs text-gray-500 italic mt-0.5">${[p.journal, p.year].filter(Boolean).join(" · ") || (p.year || "")}</p>
          </div>
        </div>
        <div class="card-detail hidden mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600 space-y-1">
          ${p.abstract ? `<p>${p.abstract}</p>` : `<p class="text-gray-400">${t("paper.noAbstract")}</p>`}
          ${notes ? `<p class="text-blue-700 bg-blue-50 rounded p-2 mt-2">${notes}</p>` : ""}
          <div class="flex gap-2 mt-2 flex-wrap">${doi}${pdfLink}${sopBtn}</div>
        </div>
      </div>`;
  }
  ```

- [ ] **Step 8.3: Add event delegation for extract-sop clicks in `boot()`**

  After `renderView(hash)` in `boot()`, add:

  ```javascript
  // One-time event delegation for extract-sop / view-sop buttons on paper cards
  document.querySelector("main").addEventListener("click", _handleSopAction);
  ```

  Add the handler function before `boot()`:

  ```javascript
  async function _handleSopAction(e) {
    // Handle "view-sop" — navigate to SOP library
    const viewBtn = e.target.closest("[data-action='view-sop']");
    if (viewBtn) {
      e.stopPropagation();
      showView("sops");
      renderView("sops");
      return;
    }

    // Handle "extract-sop" — trigger SSE extraction
    const extractBtn = e.target.closest("[data-action='extract-sop']");
    if (!extractBtn) return;
    e.stopPropagation();

    const paperId = extractBtn.dataset.paperId;
    extractBtn.disabled = true;
    extractBtn.textContent = t("sop.progressExtracting");

    try {
      const resp = await apiFetch("/api/extract-sop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_id: paperId }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        extractBtn.textContent = t("sop.progressError") + (err.detail || resp.status);
        extractBtn.disabled = false;
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "progress") extractBtn.textContent = ev.message;
            if (ev.type === "done") {
              extractBtn.textContent = t("sop.progressDone");
              setTimeout(() => window.location.reload(), 600);
            }
            if (ev.type === "error") {
              extractBtn.textContent = t("sop.progressError") + ev.message;
              extractBtn.disabled = false;
            }
          } catch { /* ignore malformed SSE */ }
        }
      }
    } catch (err) {
      extractBtn.textContent = t("sop.progressError") + err.message;
      extractBtn.disabled = false;
    }
  }
  ```

- [ ] **Step 8.4: Verify SOP library view visually**

  Start server and navigate to `#sops`. Verify:
  - Category tabs (全部 / 微流控器件 / 生物样本处理 / 检测与表征 / 数据分析) appear
  - Search box is visible
  - File-based SOPs appear in "全部" tab
  - Clicking a SOP card expands/collapses it with ▼ rotation

- [ ] **Step 8.5: Verify Extract SOP button in timeline (logged in as admin)**

  Log in as admin, navigate to `#timeline`, open a paper card. Verify:
  - "📋 提取 SOP" button appears in the card detail
  - Clicking it shows progress text
  - On completion, page reloads

- [ ] **Step 8.6: Commit**

  ```bash
  git add frontend/assets/app.js
  git commit -m "feat: SOP library category tabs, expandable cards, extract-SOP button"
  ```

---

## Summary

| Chunk | Tasks | Files Changed | Tests |
|-------|-------|---------------|-------|
| 1 — Backend | 3 | build.py, sop_service.py, sop_extract.py, main.py | +17 tests (59 total) |
| 2 — CLI | 1 | extract_sops.py | dry-run manual check |
| 3 — Frontend | 4 | zh.js, en.js, input.css, style.css, app.js | visual verification |

**Run full test suite before marking complete:**

```
pytest -v
```

Expected: 59 tests pass.
