from __future__ import annotations

import argparse
import io
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd
import yfinance as yf

DATA_DIR = Path("data/market")
HISTORY_DIR = DATA_DIR / "history"
LATEST_OUT = DATA_DIR / "latest.json"
SHARD_COUNT = 128
BATCH_SIZE = 80

NASDAQ_LISTED = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
OTHER_LISTED = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"

HISTORY_COLUMNS = [
    "rsi", "macd", "macd_prev", "macd_signal", "macd_signal_prev", "close",
    "sma20", "sma50", "sma200", "relvol", "chg1", "chg5", "from_high52", "from_low52",
    "fwd1_pct", "fwd5_pct", "fwd10_pct", "fwd20_pct",
]


def fetch_pipe_table(url: str) -> pd.DataFrame:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 ScannerEvidenceLab/1.0"})
    with urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8", errors="replace")
    lines = [line for line in text.splitlines() if line and not line.startswith("File Creation Time")]
    return pd.read_csv(io.StringIO("\n".join(lines)), sep="|")


def yahoo_symbol(symbol: str) -> str | None:
    symbol = str(symbol).strip().upper()
    if not symbol or symbol == "NAN":
        return None
    symbol = symbol.replace(".", "-")
    if not re.fullmatch(r"[A-Z0-9-]{1,15}", symbol):
        return None
    return symbol


def build_universe() -> list[dict]:
    nas = fetch_pipe_table(NASDAQ_LISTED)
    oth = fetch_pipe_table(OTHER_LISTED)
    rows: list[dict] = []

    for _, r in nas.iterrows():
        if str(r.get("Test Issue", "N")).upper() == "Y":
            continue
        sym = yahoo_symbol(r.get("Symbol", ""))
        if not sym:
            continue
        rows.append({
            "ticker": sym,
            "name": str(r.get("Security Name", "")).strip(),
            "exchange": "NASDAQ",
            "is_etf": str(r.get("ETF", "N")).upper() == "Y",
        })

    exchange_map = {"A": "NYSE American", "N": "NYSE", "P": "NYSE Arca", "Z": "Cboe BZX", "V": "IEX"}
    for _, r in oth.iterrows():
        if str(r.get("Test Issue", "N")).upper() == "Y":
            continue
        sym = yahoo_symbol(r.get("ACT Symbol", ""))
        if not sym:
            continue
        rows.append({
            "ticker": sym,
            "name": str(r.get("Security Name", "")).strip(),
            "exchange": exchange_map.get(str(r.get("Exchange", "")).strip(), str(r.get("Exchange", "")).strip()),
            "is_etf": str(r.get("ETF", "N")).upper() == "Y",
        })

    # Remove instruments that are not ordinary stocks/ADRs/ETFs/funds useful to a technical scanner.
    blocked = re.compile(r"\b(warrant|warrants|right|rights|unit|units|preferred|preference|when issued)\b", re.I)
    unique: dict[str, dict] = {}
    for r in rows:
        if blocked.search(r["name"] or "") and not r["is_etf"]:
            continue
        unique[r["ticker"]] = r
    return sorted(unique.values(), key=lambda x: x["ticker"])


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def normalise_frame(raw: pd.DataFrame, ticker: str) -> pd.DataFrame:
    if raw.empty:
        return pd.DataFrame()
    if isinstance(raw.columns, pd.MultiIndex):
        if ticker in raw.columns.get_level_values(0):
            df = raw[ticker].copy()
        elif ticker in raw.columns.get_level_values(-1):
            df = raw.xs(ticker, axis=1, level=-1).copy()
        else:
            return pd.DataFrame()
    else:
        df = raw.copy()
    df = df.rename(columns={c: str(c).title() for c in df.columns})
    needed = ["Open", "High", "Low", "Close", "Volume"]
    if any(c not in df.columns for c in needed):
        return pd.DataFrame()
    return df[needed].dropna(subset=["Close"]).copy()


def enrich(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["RSI"] = rsi(out["Close"])
    out["EMA12"] = out["Close"].ewm(span=12, adjust=False).mean()
    out["EMA26"] = out["Close"].ewm(span=26, adjust=False).mean()
    out["MACD"] = out["EMA12"] - out["EMA26"]
    out["MACD_PREV"] = out["MACD"].shift(1)
    out["MACD_SIGNAL"] = out["MACD"].ewm(span=9, adjust=False).mean()
    out["MACD_SIGNAL_PREV"] = out["MACD_SIGNAL"].shift(1)
    out["SMA20"] = out["Close"].rolling(20).mean()
    out["SMA50"] = out["Close"].rolling(50).mean()
    out["SMA200"] = out["Close"].rolling(200).mean()
    out["VOL20"] = out["Volume"].shift(1).rolling(20).mean()
    out["RELVOL"] = out["Volume"] / out["VOL20"].replace(0, np.nan)
    out["AVG_DOLLAR_VOL20"] = (out["Close"] * out["Volume"]).shift(1).rolling(20).mean()
    out["CHG1"] = out["Close"].pct_change(1) * 100
    out["CHG5"] = out["Close"].pct_change(5) * 100
    out["HIGH252"] = out["High"].rolling(252, min_periods=60).max()
    out["LOW252"] = out["Low"].rolling(252, min_periods=60).min()
    out["FROM_HIGH52"] = (out["Close"] / out["HIGH252"] - 1) * 100
    out["FROM_LOW52"] = (out["Close"] / out["LOW252"] - 1) * 100
    for n in (1, 5, 10, 20):
        out[f"FWD{n}"] = out["Close"].shift(-n) / out["Close"] - 1
    return out


def finite_or_none(x, digits=4):
    try:
        value = float(x)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(value):
        return None
    return round(value, digits)


def latest_record(meta: dict, df: pd.DataFrame) -> dict:
    x = df.iloc[-1]
    return {
        "ticker": meta["ticker"],
        "name": meta["name"],
        "exchange": meta["exchange"],
        "is_etf": meta["is_etf"],
        "asof": df.index[-1].strftime("%Y-%m-%d"),
        "close": finite_or_none(x["Close"], 4),
        "rsi": finite_or_none(x["RSI"], 2),
        "macd": finite_or_none(x["MACD"], 5),
        "macd_prev": finite_or_none(x["MACD_PREV"], 5),
        "macd_signal": finite_or_none(x["MACD_SIGNAL"], 5),
        "macd_signal_prev": finite_or_none(x["MACD_SIGNAL_PREV"], 5),
        "sma20": finite_or_none(x["SMA20"], 4),
        "sma50": finite_or_none(x["SMA50"], 4),
        "sma200": finite_or_none(x["SMA200"], 4),
        "relvol": finite_or_none(x["RELVOL"], 3),
        "avg_dollar_vol20": finite_or_none(x["AVG_DOLLAR_VOL20"], 0),
        "chg1": finite_or_none(x["CHG1"], 3),
        "chg5": finite_or_none(x["CHG5"], 3),
        "from_high52": finite_or_none(x["FROM_HIGH52"], 3),
        "from_low52": finite_or_none(x["FROM_LOW52"], 3),
    }


def compact_history(df: pd.DataFrame) -> list[list]:
    cols = [
        "RSI", "MACD", "MACD_PREV", "MACD_SIGNAL", "MACD_SIGNAL_PREV", "Close",
        "SMA20", "SMA50", "SMA200", "RELVOL", "CHG1", "CHG5", "FROM_HIGH52", "FROM_LOW52",
        "FWD1", "FWD5", "FWD10", "FWD20",
    ]
    hist = df[cols].dropna(subset=["RSI", "MACD", "MACD_PREV", "RELVOL"]).tail(760)
    rows = []
    for _, x in hist.iterrows():
        rows.append([
            finite_or_none(x["RSI"], 2), finite_or_none(x["MACD"], 5), finite_or_none(x["MACD_PREV"], 5),
            finite_or_none(x["MACD_SIGNAL"], 5), finite_or_none(x["MACD_SIGNAL_PREV"], 5), finite_or_none(x["Close"], 4),
            finite_or_none(x["SMA20"], 4), finite_or_none(x["SMA50"], 4), finite_or_none(x["SMA200"], 4),
            finite_or_none(x["RELVOL"], 3), finite_or_none(x["CHG1"], 3), finite_or_none(x["CHG5"], 3),
            finite_or_none(x["FROM_HIGH52"], 3), finite_or_none(x["FROM_LOW52"], 3),
            finite_or_none(x["FWD1"] * 100, 3), finite_or_none(x["FWD5"] * 100, 3),
            finite_or_none(x["FWD10"] * 100, 3), finite_or_none(x["FWD20"] * 100, 3),
        ])
    return rows


def fnv1a(text: str) -> int:
    h = 2166136261
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def shard_for(ticker: str) -> int:
    return fnv1a(ticker) % SHARD_COUNT


def download_batch(tickers: list[str], period: str) -> pd.DataFrame:
    for attempt in range(3):
        try:
            return yf.download(
                tickers=tickers,
                period=period,
                interval="1d",
                group_by="ticker",
                auto_adjust=False,
                threads=True,
                progress=False,
                timeout=30,
            )
        except Exception as exc:
            print(f"Batch attempt {attempt + 1} failed: {exc}")
            time.sleep(4 * (attempt + 1))
    return pd.DataFrame()


def process_universe(universe: list[dict], mode: str) -> tuple[list[dict], list[str], int]:
    meta_by_ticker = {r["ticker"]: r for r in universe}
    latest: list[dict] = []
    failed: list[str] = []
    historical_observations = 0

    if mode == "full":
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        for old in HISTORY_DIR.glob("history_*.ndjson"):
            old.unlink()

    tickers = list(meta_by_ticker)
    period = "5y" if mode == "full" else "1y"

    for start in range(0, len(tickers), BATCH_SIZE):
        batch = tickers[start:start + BATCH_SIZE]
        print(f"Downloading {start + 1}-{min(start + len(batch), len(tickers))} of {len(tickers)} ({period})")
        raw = download_batch(batch, period)
        shard_lines: dict[int, list[str]] = {}

        for ticker in batch:
            try:
                df = normalise_frame(raw, ticker)
                if len(df) < 35:
                    failed.append(ticker)
                    continue
                df = enrich(df)
                latest.append(latest_record(meta_by_ticker[ticker], df))
                if mode == "full":
                    hist = compact_history(df)
                    if hist:
                        sid = shard_for(ticker)
                        shard_lines.setdefault(sid, []).append(json.dumps([ticker, hist], separators=(",", ":")))
                        historical_observations += len(hist)
            except Exception as exc:
                failed.append(f"{ticker}: {exc}")

        if mode == "full":
            for sid, lines in shard_lines.items():
                path = HISTORY_DIR / f"history_{sid:03d}.ndjson"
                with path.open("a", encoding="utf-8") as fh:
                    fh.write("\n".join(lines) + "\n")

        time.sleep(0.4)

    latest.sort(key=lambda x: x["ticker"])
    return latest, failed, historical_observations


def previous_history_version() -> str | None:
    if not LATEST_OUT.exists():
        return None
    try:
        return json.loads(LATEST_OUT.read_text(encoding="utf-8")).get("history_version")
    except Exception:
        return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["latest", "full"], default="full")
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print("Loading current US exchange listings from Nasdaq Trader...")
    universe = build_universe()
    print(f"Universe: {len(universe)} active stock/ETF symbols")

    old_history_version = previous_history_version()
    latest, failed, historical_observations = process_universe(universe, args.mode)
    now = datetime.now(timezone.utc).isoformat()
    history_version = now if args.mode == "full" else old_history_version

    stocks = sum(1 for x in latest if not x["is_etf"])
    etfs = sum(1 for x in latest if x["is_etf"])
    payload = {
        "source": "Yahoo Finance via yfinance; listings from Nasdaq Trader Symbol Directory",
        "generated_at": now,
        "history_version": history_version,
        "history_shards": SHARD_COUNT,
        "history_mode": "full market on-demand shards",
        "universe_size": len(universe),
        "processed_symbols": len(latest),
        "processed_stocks": stocks,
        "processed_etfs": etfs,
        "failed_count": len(failed),
        "failed_symbols": failed[:300],
        "historical_observations_built": historical_observations,
        "schema": {"history_columns": HISTORY_COLUMNS},
        "capabilities": [
            "Full current US exchange-listed stock and ETF snapshot",
            "RSI above/below a threshold",
            "MACD rising/falling, positive/negative, or signal-line cross",
            "Price above/below 20, 50, or 200-day moving average",
            "Relative volume above/below a threshold",
            "1-day or 5-day price move above/below a percentage",
            "Distance from 52-week high or low",
        ],
        "default_query": "RSI below 45, MACD rising, price above the 200-day moving average and relative volume above 1.5x",
        "latest": latest,
    }
    LATEST_OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {LATEST_OUT}: {len(latest)} symbols; failed {len(failed)}")
    if args.mode == "full":
        print(f"Historical observations: {historical_observations}; shards: {SHARD_COUNT}")


if __name__ == "__main__":
    main()
