"""News article storage backed by data/news.json."""
from __future__ import annotations

import json
import time
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
NEWS_PATH = ROOT / "data" / "news.json"
IMAGES_DIR = ROOT / "data" / "news-images"


def _ensure_images_dir() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)


def load_news() -> list[dict]:
    _ensure_images_dir()
    if not NEWS_PATH.exists():
        return []
    return json.loads(NEWS_PATH.read_text(encoding="utf-8"))


def save_news(articles: list[dict]) -> None:
    articles_sorted = sorted(articles, key=lambda a: a.get("date", ""), reverse=True)
    NEWS_PATH.write_text(
        json.dumps(articles_sorted, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_article(article_id: str) -> dict | None:
    return next((a for a in load_news() if a["id"] == article_id), None)


def create_article(article: dict) -> dict:
    articles = load_news()
    articles.append(article)
    save_news(articles)
    return article


def update_article(article_id: str, updates: dict) -> dict | None:
    articles = load_news()
    for i, a in enumerate(articles):
        if a["id"] == article_id:
            articles[i] = {**a, **updates, "updatedAt": time.time()}
            save_news(articles)
            return articles[i]
    return None


def delete_article(article_id: str) -> bool:
    articles = load_news()
    filtered = [a for a in articles if a["id"] != article_id]
    if len(filtered) == len(articles):
        return False
    save_news(filtered)
    return True
