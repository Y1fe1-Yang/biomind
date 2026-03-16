"""AI provider configuration storage backed by data/ai_config.json."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
AI_CONFIG_PATH = ROOT / "data" / "ai_config.json"

_DEFAULTS: dict = {
    "provider": "zhipu",
    "keys": {"zhipu": "", "claude": "", "kimi": ""},
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _ensure_file() -> None:
    if not AI_CONFIG_PATH.exists():
        AI_CONFIG_PATH.write_text(
            json.dumps(_DEFAULTS, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_config() -> dict:
    """Return raw config dict (creates with defaults if missing)."""
    _ensure_file()
    data = json.loads(AI_CONFIG_PATH.read_text(encoding="utf-8"))
    # Ensure keys sub-dict has all expected fields
    keys = data.setdefault("keys", {})
    for k in ("zhipu", "claude", "kimi"):
        keys.setdefault(k, "")
    return data


def update_config(updates: dict) -> dict:
    """Update provider and/or keys.

    Rules:
    - If 'provider' is in updates, overwrite it.
    - If 'keys' is in updates, merge key-by-key:
        - key present with value ""  → clear that key (set to "")
        - key present with a value   → update to that value
        - key absent from updates    → keep existing value
    """
    config = get_config()

    if "provider" in updates:
        config["provider"] = updates["provider"]

    if "keys" in updates:
        for provider_name, val in updates["keys"].items():
            config["keys"][provider_name] = val  # "" clears, non-empty updates

    AI_CONFIG_PATH.write_text(
        json.dumps(config, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return config


def get_masked_config() -> dict:
    """Return config with API keys masked: non-empty → '****' + last4, empty → ''."""
    config = get_config()
    masked_keys = {}
    for k, v in config.get("keys", {}).items():
        if v:
            masked_keys[k] = "****" + v[-4:] if len(v) >= 4 else "****"
        else:
            masked_keys[k] = ""
    return {**config, "keys": masked_keys}
