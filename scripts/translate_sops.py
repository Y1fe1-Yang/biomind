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
    text = text.strip()
    # Replace Unicode curly-quotes with escaped forms so they don't break JSON
    text = text.replace("\u201c", "\\u201c").replace("\u201d", "\\u201d")
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Fallback: fix unescaped ASCII double-quotes inside JSON string values.
    # Strategy: for each "key": "value" pair, re-escape any bare " inside the value.
    def _fix_inner_quotes(s: str) -> str:
        """Replace bare " inside JSON string values with \". """
        out = []
        in_string = False
        escaped = False
        i = 0
        while i < len(s):
            c = s[i]
            if escaped:
                out.append(c)
                escaped = False
            elif c == "\\":
                out.append(c)
                escaped = True
            elif c == '"':
                if not in_string:
                    in_string = True
                    out.append(c)
                else:
                    # Peek: is this a closing quote? Check if followed by :, ,, } or ]
                    # (with optional whitespace). If yes, it's a structural quote.
                    rest = s[i + 1:].lstrip()
                    if rest and rest[0] in (':', ',', '}', ']', '\n'):
                        in_string = False
                        out.append(c)
                    else:
                        # Inner unescaped quote — escape it
                        out.append('\\"')
            else:
                out.append(c)
            i += 1
        return "".join(out)

    fixed = _fix_inner_quotes(text)
    return json.loads(fixed)


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
