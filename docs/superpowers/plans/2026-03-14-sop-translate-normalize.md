# SOP 翻译与分类标准化 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate all English-content SOPs to Chinese and standardize all SOP categories to one of 4 fixed Chinese values.

**Architecture:** Two independent changes. First, a one-time batch script (`scripts/translate_sops.py`) finds English SOPs, calls the local `claude` CLI to translate all fields, normalizes categories, and writes back to `data.json`. Second, `sop_service.py` prompt templates are tightened to enforce Chinese output and standard categories on all future extractions.

**Tech Stack:** Python, subprocess (claude CLI), json, rank-bm25 (via existing build pipeline)

**Spec:** `docs/superpowers/specs/2026-03-14-sop-translate-normalize-design.md`

---

## Chunk 1: sop_service.py prompt hardening

### File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `backend/services/sop_service.py` | Add Chinese-only + standard category constraints to both prompt templates |

No new tests needed — the prompts are string constants and the existing test suite already mocks Claude responses; prompt wording doesn't affect test behavior.

---

### Task 1: Tighten sop_service.py prompts

**Files:**
- Modify: `backend/services/sop_service.py`

Current state: `_PROMPT_FULL` (line 32) and `_PROMPT_ABSTRACT` (line 63) have a "严格要求" section but don't enforce Chinese output or a fixed category list.

- [ ] **Step 1: Add constraints to `_PROMPT_FULL`**

In `_PROMPT_FULL`, find the "严格要求：" block and append two new lines:

Current ending of the requirements block:
```
- materials 列出所有试剂和仪器（含型号/货号如有）
```

Replace with:
```
- materials 列出所有试剂和仪器（含型号/货号如有）
- 所有字段必须使用中文（数值参数如浓度、温度、时间、转速保留原文数字和单位）
- category 只能从以下四项选一：微流控器件 / 生物样本处理 / 检测与表征 / 数据分析
```

- [ ] **Step 2: Add constraints to `_PROMPT_ABSTRACT`**

In `_PROMPT_ABSTRACT`, after the line `仅填充 title/category/subcategory/tags/purpose，steps/materials 留空列表。` add:

```
category 只能从以下四项选一：微流控器件 / 生物样本处理 / 检测与表征 / 数据分析
所有字段使用中文。
```

- [ ] **Step 3: Run existing tests to confirm no breakage**

```bash
cd D:/BioMiND
pytest tests/test_sop_extract_router.py -v
```

Expected: All tests pass (tests mock Claude responses, so prompt wording doesn't affect them).

- [ ] **Step 4: Commit**

```bash
git add backend/services/sop_service.py
git commit -m "feat: enforce Chinese output and standard categories in SOP extraction prompts"
```

---

## Chunk 2: translate_sops.py batch translation script

### File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `scripts/translate_sops.py` | Detect English SOPs, translate via claude CLI, normalize categories, write data.json |

---

### Task 2: Write translate_sops.py

**Files:**
- Create: `scripts/translate_sops.py`

- [ ] **Step 1: Write `scripts/translate_sops.py`**

```python
"""
One-time batch script: translate English-content SOPs to Chinese and
normalize all SOP categories to the 4 standard Chinese values.

Usage:
    python scripts/translate_sops.py            # translate English SOPs only
    python scripts/translate_sops.py --all      # re-normalize ALL SOPs (no translation)
    python scripts/translate_sops.py --dry-run  # print which SOPs would be processed
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT))

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf-8-sig"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

from scripts.build import generate_data_files  # noqa: E402

_CC_ENV = {**os.environ, "CLAUDE_CODE_GIT_BASH_PATH": r"D:\Git\usr\bin\bash.exe"}
_CC_TIMEOUT = 120

# Standard category mapping (English or non-standard → Chinese)
_CATEGORY_MAP: dict[str, str] = {
    "review": "检测与表征",
    "imaging technology": "检测与表征",
    "photonics & optics": "检测与表征",
    "detection & analysis": "检测与表征",
    "proteomics & mass spectrometry": "检测与表征",
    "experimental protocol": "微流控器件",
    "technology & methods": "微流控器件",
    "biomaterials": "生物样本处理",
    "drug delivery & therapeutics": "生物样本处理",
    "separation & isolation": "生物样本处理",
}

_STANDARD_CATEGORIES = {"微流控器件", "生物样本处理", "检测与表征", "数据分析"}

_TRANSLATE_PROMPT = """\
将以下实验室 SOP 条目的所有文本字段翻译成中文。

规则：
- 所有文本字段翻译成中文
- 数值参数（浓度、温度、时间、转速、体积等）保留原文数字和单位不变
- category 只能从以下四项选一：微流控器件 / 生物样本处理 / 检测与表征 / 数据分析
- 返回与输入完全相同结构的 JSON 对象，只翻译文本内容，不增减任何字段
- 只返回 JSON，不要其他说明文字

输入 JSON：
{sop_json}
"""

_FIELDS_TO_TRANSLATE = ("title", "purpose", "subcategory", "category")
_LIST_FIELDS_TO_TRANSLATE = ("steps", "materials", "protocol_notes", "tags")


def _normalize_category(cat: str) -> str:
    """Map non-standard category to one of the 4 standard Chinese values."""
    if cat in _STANDARD_CATEGORIES:
        return cat
    return _CATEGORY_MAP.get(cat.lower(), "检测与表征")


def _english_ratio(text: str) -> float:
    """Return fraction of ASCII letters in text (0.0–1.0)."""
    if not text:
        return 0.0
    ascii_count = sum(1 for c in text if c.isascii() and c.isalpha())
    return ascii_count / len(text)


def _needs_translation(sop: dict) -> bool:
    """True if title, purpose, or joined steps are >50% ASCII letters."""
    checks = [
        sop.get("title", ""),
        sop.get("purpose", ""),
        " ".join(sop.get("steps", [])),
    ]
    return any(_english_ratio(t) > 0.5 for t in checks if t)


def _call_claude(prompt: str) -> str:
    result = subprocess.run(
        ["claude", "--output-format", "text"],
        input=prompt,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=_CC_ENV,
        timeout=_CC_TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError(f"claude exited {result.returncode}: {result.stderr[:300]}")
    return result.stdout


def _parse_json_response(text: str) -> dict:
    """Strip markdown fences and parse JSON object."""
    m = re.search(r"```(?:json)?\s*(\{.*?)\s*```", text, re.DOTALL)
    if m:
        text = m.group(1)
    return json.loads(text.strip())


def translate_sop(sop: dict) -> dict:
    """
    Call Claude to translate all text fields of a single SOP entry.
    Falls back to original on any error.
    """
    # Only send the fields Claude needs to translate (not metadata like id, source_paper_id etc.)
    payload = {k: sop[k] for k in _FIELDS_TO_TRANSLATE if k in sop}
    for k in _LIST_FIELDS_TO_TRANSLATE:
        if k in sop:
            payload[k] = sop[k]

    prompt = _TRANSLATE_PROMPT.format(sop_json=json.dumps(payload, ensure_ascii=False, indent=2))
    try:
        raw = _call_claude(prompt)
        translated = _parse_json_response(raw)
    except Exception as exc:
        print(f"  TRANSLATE ERROR ({sop['id']}): {exc} — keeping original")
        return sop

    updated = dict(sop)
    for k in _FIELDS_TO_TRANSLATE:
        if k in translated:
            updated[k] = translated[k]
    for k in _LIST_FIELDS_TO_TRANSLATE:
        if k in translated and isinstance(translated[k], list):
            updated[k] = translated[k]
    return updated


def _load_data() -> dict:
    return json.loads((_ROOT / "data" / "data.json").read_text(encoding="utf-8"))


def _save_data(data: dict) -> None:
    (_ROOT / "data" / "data.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _run(normalize_all: bool, dry_run: bool) -> None:
    data = _load_data()
    sops = data.get("sops", [])

    to_translate = [s for s in sops if _needs_translation(s)]
    to_normalize = [s for s in sops if s.get("category", "") not in _STANDARD_CATEGORIES]

    if dry_run:
        print(f"Would translate {len(to_translate)} SOP(s):")
        for s in to_translate:
            print(f"  {s['id']}: {s.get('title', '')[:60]}")
        print(f"\nWould normalize category for {len(to_normalize)} SOP(s):")
        for s in to_normalize:
            print(f"  {s['id']}: '{s.get('category', '')}' → '{_normalize_category(s.get('category', ''))}'")
        return

    changed = False

    # Step 1: Normalize categories for all SOPs
    for sop in sops:
        old_cat = sop.get("category", "")
        new_cat = _normalize_category(old_cat)
        if old_cat != new_cat:
            print(f"  normalize: {sop['id']} '{old_cat}' → '{new_cat}'")
            sop["category"] = new_cat
            changed = True

    # Step 2: Translate English SOPs (unless --all skips translation)
    if not normalize_all:
        print(f"\nTranslating {len(to_translate)} SOP(s)...")
        for i, sop in enumerate(to_translate, 1):
            print(f"[{i}/{len(to_translate)}] {sop['id']}: {sop.get('title', '')[:55]}")
            idx = next(j for j, s in enumerate(sops) if s["id"] == sop["id"])
            sops[idx] = translate_sop(sop)
            changed = True

    if changed:
        data["sops"] = sops
        _save_data(data)
        print("\nRegenerating data.js...")
        generate_data_files(root=_ROOT, rebuild=False)
        print("Done.")
    else:
        print("Nothing to do.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Translate English SOPs to Chinese")
    parser.add_argument("--all", action="store_true",
                        help="Re-normalize ALL SOP categories (skip translation)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be processed without making changes")
    args = parser.parse_args()
    _run(args.all, args.dry_run)
```

- [ ] **Step 2: Dry-run to verify detection logic**

```bash
python scripts/translate_sops.py --dry-run
```

Expected output: List of English-titled SOPs (e.g., `sop-biosensors2023-liu-qing-1`, `sop-laser-photonicsreviews2025-1`, etc.) and list of non-standard categories. Should show ~10 SOPs to translate and ~12 categories to normalize.

- [ ] **Step 3: Run category normalization only first (safe, no AI calls)**

```bash
python scripts/translate_sops.py --all
```

Expected: Prints category changes (e.g., `'Review' → '检测与表征'`), writes data.json, regenerates data.js. No AI calls.

- [ ] **Step 4: Verify categories in data.json**

```bash
python -c "
import json
d = json.load(open('data/data.json', encoding='utf-8'))
from collections import Counter
cats = Counter(s.get('category','') for s in d.get('sops',[]))
for cat, n in cats.most_common():
    print(f'  {cat}: {n}')
bad = [s for s in d['sops'] if s.get('category','') not in {'微流控器件','生物样本处理','检测与表征','数据分析'}]
print(f'Non-standard categories remaining: {len(bad)}')
"
```

Expected: Only the 4 standard categories appear, `Non-standard categories remaining: 0`.

- [ ] **Step 5: Run full translation (AI calls for English SOPs)**

```bash
python scripts/translate_sops.py
```

Expected: Translates ~10 English SOPs, prints progress, writes data.json + data.js.

- [ ] **Step 6: Verify no English titles remain in data.json**

```bash
python -c "
import json, re
d = json.load(open('data/data.json', encoding='utf-8'))
def eng_ratio(t):
    if not t: return 0
    return sum(1 for c in t if c.isascii() and c.isalpha()) / len(t)
bad = [s for s in d['sops'] if eng_ratio(s.get('title','')) > 0.5]
print(f'SOPs with English titles: {len(bad)}')
for s in bad: print(f'  {s[\"id\"]}: {s[\"title\"]}')
"
```

Expected: `SOPs with English titles: 0`

- [ ] **Step 7: Run existing tests to confirm no breakage**

```bash
pytest -v
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/translate_sops.py backend/services/sop_service.py data/data.json data/data.js
git commit -m "feat: translate English SOPs to Chinese, normalize categories to 4 standard values"
```
