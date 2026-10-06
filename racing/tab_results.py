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

    # Browser diagnostic: render the exact public TAB race page with local Edge.
    # This avoids the obsolete historical API calls and lets TAB's JavaScript load.
    import subprocess
    import tempfile
    import time

    public_url = "https://www.tab.com.au/racing/2026-10-05/DOOMBEN/B/R/5"
    edge_candidates = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
    ]
    edge = next((p for p in edge_candidates if os.path.exists(p)), None)
    if not edge:
        failures.append({"error": "Microsoft Edge not found on Australian runner"})
    else:
        try:
            with tempfile.TemporaryDirectory(prefix="tab-edge-") as profile:
                cmd = [
                    edge, "--headless=new", "--disable-gpu", "--no-first-run",
                    "--disable-default-apps", "--disable-extensions",
                    "--virtual-time-budget=15000",
                    f"--user-data-dir={profile}",
                    "--dump-dom", public_url,
                ]
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=40, encoding="utf-8", errors="replace")
                rendered = proc.stdout
                print("EDGE_EXIT", proc.returncode, "DOM_CHARS", len(rendered))
                print("EDGE_STDERR", proc.stderr[-1000:])
                outdir = args.out.parent
                outdir.mkdir(parents=True, exist_ok=True)
                (outdir / "doomben_r5_rendered.html").write_text(rendered, encoding="utf-8")
                needles = ["Astern Effort", "results", "dividend", "runner", "DOOMBEN", "Race 5"]
                for needle in needles:
                    pos = rendered.casefold().find(needle.casefold())
                    print("EDGE_DOM_MATCH", needle, pos, rendered[max(0,pos-400):pos+1200] if pos >= 0 else "")
                if not rendered:
                    failures.append({"error": "Edge returned empty rendered DOM", "stderr": proc.stderr[-2000:]})
        except Exception as exc:
            failures.append({"error": "Edge TAB render failed", "detail": repr(exc)})

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
