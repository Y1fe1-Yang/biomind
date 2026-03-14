"""One-time script: copy keyword-classified directions from data.json into meta_cache.json."""
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
data = json.loads((ROOT / "data" / "data.json").read_text(encoding="utf-8"))
cache = json.loads((ROOT / "data" / "meta_cache.json").read_text(encoding="utf-8"))

updated = 0
for p in data["papers"]:
    key = (p.get("file") or "").replace("\\", "/")
    if key and p.get("directions") and key in cache:
        if not cache[key].get("directions"):
            cache[key]["directions"] = p["directions"]
            updated += 1

(ROOT / "data" / "meta_cache.json").write_text(
    json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(f"Updated {updated} cache entries with directions")
