import json
import re
from pathlib import Path

DATA_PATH = Path(__file__).parent / "materials.json"

with open(DATA_PATH, encoding="utf-8") as f:
    MATERIALS = json.load(f)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", "", text).lower()


def find_material(genre_id: str, material_id: str):
    for genre in MATERIALS["genres"]:
        if genre["id"] == genre_id:
            for material in genre["materials"]:
                if material["id"] == material_id:
                    return material
    return None


def match_article(article: dict, material) -> dict | None:
    title = _normalize(article.get("newsTitle", ""))
    if not title:
        return None
    matched = [term for term in material["searchTerms"] if _normalize(term) in title]
    if matched:
        return {**article, "matchedTerms": matched}
    return None
