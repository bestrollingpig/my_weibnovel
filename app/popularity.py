from collections import Counter
from datetime import date
from threading import Lock

_counts: Counter = Counter()
_lock = Lock()
_today = date.today()


def record(genre_id: str, material_id: str, genre_name: str, material_name: str) -> None:
    global _today
    now = date.today()
    with _lock:
        if now != _today:
            _counts.clear()
            _today = now
        _counts[(genre_id, material_id, genre_name, material_name)] += 1


def top(limit: int = 10) -> list[dict]:
    with _lock:
        return [
            {
                "genre": g,
                "material": m,
                "genreName": gn,
                "materialName": mn,
                "count": c,
            }
            for (g, m, gn, mn), c in _counts.most_common(limit)
        ]


def today() -> str:
    return _today.isoformat()