#!/usr/bin/env python3
"""TAB-only historical thoroughbred result collector.

Source of record: TAB Australia historical-results-service.
No fallback racing/result provider is permitted.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = "https://api.beta.tab.com.au/v1/historical-results-service"
INFO_BASE = "https://api.beta.tab.com.au/v1/tab-info-service"

@dataclass(frozen=True)
class Target:
    date: str
    jurisdiction: str
    venue: str
    race: int
    horse: str
    advised_rank: int
    number: str = ""

VALIDATION_TARGETS = [
    Target("2026-10-05", "NSW", "WARWICK FARM", 2, "Crescent King", 1, "1"),
    Target("2026-10-05", "QLD", "DOOMBEN", 4, "Astern Effort", 2, ""),
    Target("2026-10-05", "NSW", "WARWICK FARM", 7, "Ice Kool", 3, "9"),
    Target("2026-10-05", "VIC", "PAKENHAM", 5, "Vantaa", 4, "10"),
    Target("2026-10-05", "NSW", "MUSWELLBROOK", 3, "Triple Yes", 5, ""),
    Target("2026-10-05", "NSW", "MUSWELLBROOK", 4, "Nova Centauri", 6, "4"),
]

def get_json(url: str, token: str | None = None) -> Any:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
        "Accept-Language": "en-AU,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(url, headers=headers)
    with urlopen(req, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))

def discover_meetings(date: str, jurisdiction: str, token: str | None = None) -> Any:
    # TAB's public/approved API can expose discoverable hypermedia/resources.
    candidates = [
        f"https://api.beta.tab.com.au/v1/tab-info-service/racing/dates/{date}/meetings?jurisdiction={jurisdiction}",
        f"{BASE}/{jurisdiction}/racing/{date}",
    ]
    errors = []
    for url in candidates:
        try:
            return get_json(url, token)
        except Exception as exc:
            errors.append(f"{url}: {exc}")
    raise RuntimeError("TAB meeting discovery failed. " + " | ".join(errors))

def collect_race(jurisdiction: str, date: str, venue_code: str, race: int, token: str | None = None) -> Any:
    url = f"{BASE}/{quote(jurisdiction)}/racing/{date}/{quote(venue_code)}/R/races/{race}"
    return get_json(url, token)

def walk(obj: Any):
    if isinstance(obj, dict):
        yield obj
        for value in obj.values():
            yield from walk(value)
    elif isinstance(obj, list):
        for value in obj:
            yield from walk(value)

def norm(value: Any) -> str:
    return " ".join(str(value or "").casefold().split())

def fetch_tab_info_race(date, jurisdiction, venue_code, race_no):
    url = f"{INFO_BASE}/racing/dates/{date}/meetings/R/{venue_code}/races/{race_no}?jurisdiction={jurisdiction}"
    req = urllib.request.Request(url, headers=headers())
    with urllib.request.urlopen(req, timeout=20) as response:
        raw = response.read()
        ctype = response.headers.get("Content-Type", "")
        if "json" not in ctype.lower():
            raise RuntimeError(f"TAB tab-info non-JSON HTTP {response.status} content-type={ctype} prefix={raw[:160]!r}")
        return json.loads(raw.decode("utf-8")), url


def find_runner(payload: Any, horse: str) -> dict[str, Any] | None:
    wanted = norm(horse)
    for item in walk(payload):
        names = [item.get(k) for k in ("runnerName", "horseName", "name", "runner")]
        if any(norm(x) == wanted for x in names if x is not None):
            return item
    return None

def field(item: dict[str, Any], *names: str):
    for name in names:
        if name in item and item[name] not in (None, ""):
            return item[name]
    return None

def row_from_runner(target: Target, runner: dict[str, Any], source_url: str) -> dict[str, Any]:
    return {
        "date": target.date,
        "advised_rank": target.advised_rank,
        "horse": target.horse,
        "number": field(runner, "runnerNumber", "number", "saddlecloth") or target.number,
        "meeting": target.venue,
        "race": target.race,
        "finish_position": field(runner, "finishPosition", "finishingPosition", "position", "place"),
        "sp": field(runner, "startingPrice", "sp", "finalFixedPrice"),
        "tote_win": field(runner, "winDividend", "toteWin", "winPrice"),
        "tote_place": field(runner, "placeDividend", "totePlace", "placePrice"),
        "barrier": field(runner, "barrier", "barrierNumber"),
        "jockey": field(runner, "jockeyName", "jockey"),
        "trainer": field(runner, "trainerName", "trainer"),
        "source": "TAB",
        "source_url": source_url,
        "verified": True,
    }

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--validate-2026-10-05", action="store_true")
    p.add_argument("--venue-map", type=Path, help="JSON mapping e.g. {'WARWICK FARM':'W'}")
    p.add_argument("--out", type=Path, default=Path("tab_results.csv"))
    args = p.parse_args()

    targets = VALIDATION_TARGETS if args.validate_2026_10_05 else []
    if not targets:
        p.error("Use --validate-2026-10-05 (generic target-file support can be added next).")

    # Venue mnemonics should come from TAB meeting discovery; static map is fallback only.
    venue_map = {}
    if args.venue_map and args.venue_map.exists():
        venue_map = {k.upper(): str(v) for k, v in json.loads(args.venue_map.read_text()).items()}

    token = os.getenv("TAB_API_TOKEN")
    rows, failures = [], []

    # TAB info-service diagnostic. Discover the meeting first so TAB supplies its own venueMnemonic.
    import urllib.request
    import urllib.parse

    def tab_json(url):
        req = urllib.request.Request(url, headers={
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "identity",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
            "Origin": "https://www.tab.com.au",
            "Referer": "https://www.tab.com.au/",
        })
        with urllib.request.urlopen(req, timeout=12) as resp:
            raw = resp.read().decode("utf-8", "replace")
            print("TAB_INFO_HTTP", resp.status, resp.headers.get("content-type"), url, "CHARS", len(raw))
            return json.loads(raw)

    try:
        meetings_url = "https://api.beta.tab.com.au/v1/tab-info-service/racing/dates/2026-10-05/meetings?jurisdiction=QLD"
        data = tab_json(meetings_url)
        meetings = data.get("meetings", data if isinstance(data, list) else [])
        print("TAB_MEETINGS_COUNT", len(meetings))
        doomben = None
        for m in meetings:
            name = str(m.get("meetingName") or m.get("venueName") or m.get("name") or "")
            if "DOOMBEN" in name.upper():
                doomben = m
                break
        print("TAB_DOOMBEN_MEETING", json.dumps(doomben, default=str)[:5000])
        if not doomben:
            failures.append({"error": "Doomben not found in TAB meeting discovery"})
        else:
            mnemonic = doomben.get("venueMnemonic") or doomben.get("venueCode") or doomben.get("venue")
            race_type = doomben.get("raceType") or "R"
            print("TAB_DISCOVERED", race_type, mnemonic)
            race_url = (
                "https://api.beta.tab.com.au/v1/tab-info-service/racing/dates/2026-10-05/meetings/"
                + urllib.parse.quote(str(race_type), safe="")
                + "/" + urllib.parse.quote(str(mnemonic), safe="")
                + "/races/5?jurisdiction=QLD"
            )
            race = tab_json(race_url)
            print("TAB_R5_KEYS", list(race.keys()) if isinstance(race, dict) else type(race).__name__)
            print("TAB_R5_RESULTS", json.dumps(race.get("results"), default=str)[:3000] if isinstance(race, dict) else "")
            print("TAB_R5_DIVIDENDS", json.dumps(race.get("dividends"), default=str)[:5000] if isinstance(race, dict) else "")
            print("TAB_R5_RUNNERS", json.dumps(race.get("runners"), default=str)[:12000] if isinstance(race, dict) else "")
            args.out.parent.mkdir(parents=True, exist_ok=True)
            (args.out.parent / "doomben_r5.json").write_text(json.dumps(race, indent=2, default=str), encoding="utf-8")
    except Exception as exc:
        failures.append({"error": "TAB info-service discovery failed", "detail": repr(exc)})
        print("TAB_INFO_ERROR", repr(exc))

    columns = [
        "date","advised_rank","horse","number","meeting","race","finish_position",
        "sp","tote_win","tote_place","barrier","jockey","trainer","source","source_url","verified"
    ]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)

    failure_path = args.out.with_suffix(".failures.json")
    failure_path.write_text(json.dumps(failures, indent=2), encoding="utf-8")
    print(json.dumps({"verified_rows": len(rows), "failures": len(failures), "output": str(args.out)}, indent=2))
    return 0 if not failures else 2

if __name__ == "__main__":
    raise SystemExit(main())
