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
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Claude returned invalid JSON: {exc}. Response preview: {text[:200]!r}"
        ) from exc
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
    pdf_path = root / paper.get("file", "")
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
