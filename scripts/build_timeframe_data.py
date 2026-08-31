from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

from build_scan_data import build_universe, normalise_frame, rsi, finite_or_none, fnv1a

SHARD_COUNT = 128
BATCH_SIZE = 80
HISTORY_COLUMNS = [
    "rsi", "macd", "macd_prev", "macd_signal", "macd_signal_prev", "close",
    "sma20", "sma50", "sma200", "relvol", "chg1", "chg5", "from_high52", "from_low52",
    "fwd1_pct", "fwd5_pct", "fwd10_pct", "fwd20_pct",
]

CONFIG = {
    "weekly": {"interval": "1wk", "period": "10y", "high_lookback": 52, "history_tail": 420, "label": "Weekly"},
    "monthly": {"interval": "1mo", "period": "20y", "high_lookback": 12, "history_tail": 240, "label": "Monthly"},
}


def enrich(df: pd.DataFrame, high_lookback: int) -> pd.DataFrame:
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
    out["HIGH52"] = out["High"].rolling(high_lookback, min_periods=max(6, high_lookback // 2)).max()
    out["LOW52"] = out["Low"].rolling(high_lookback, min_periods=max(6, high_lookback // 2)).min()
    out["FROM_HIGH52"] = (out["Close"] / out["HIGH52"] - 1) * 100
    out["FROM_LOW52"] = (out["Close"] / out["LOW52"] - 1) * 100
    for n in (1, 5, 10, 20):
        out[f"FWD{n}"] = out["Close"].shift(-n) / out["Close"] - 1
    return out


def latest_record(meta: dict, df: pd.DataFrame) -> dict:
    x = df.iloc[-1]
    return {
        "ticker": meta["ticker"], "name": meta["name"], "exchange": meta["exchange"], "is_etf": meta["is_etf"],
        "asof": df.index[-1].strftime("%Y-%m-%d"), "close": finite_or_none(x["Close"], 4),
        "rsi": finite_or_none(x["RSI"], 2), "macd": finite_or_none(x["MACD"], 5),
        "macd_prev": finite_or_none(x["MACD_PREV"], 5), "macd_signal": finite_or_none(x["MACD_SIGNAL"], 5),
        "macd_signal_prev": finite_or_none(x["MACD_SIGNAL_PREV"], 5), "sma20": finite_or_none(x["SMA20"], 4),
        "sma50": finite_or_none(x["SMA50"], 4), "sma200": finite_or_none(x["SMA200"], 4),
        "relvol": finite_or_none(x["RELVOL"], 3), "avg_dollar_vol20": finite_or_none(x["AVG_DOLLAR_VOL20"], 0),
        "chg1": finite_or_none(x["CHG1"], 3), "chg5": finite_or_none(x["CHG5"], 3),
        "from_high52": finite_or_none(x["FROM_HIGH52"], 3), "from_low52": finite_or_none(x["FROM_LOW52"], 3),
    }


def compact_history(df: pd.DataFrame, tail: int) -> list[list]:
    cols = ["RSI","MACD","MACD_PREV","MACD_SIGNAL","MACD_SIGNAL_PREV","Close","SMA20","SMA50","SMA200","RELVOL","CHG1","CHG5","FROM_HIGH52","FROM_LOW52","FWD1","FWD5","FWD10","FWD20"]
    hist = df[cols].dropna(subset=["RSI","MACD","MACD_PREV","RELVOL"]).tail(tail)
    rows = []
    for _, x in hist.iterrows():
        rows.append([
            finite_or_none(x["RSI"],2), finite_or_none(x["MACD"],5), finite_or_none(x["MACD_PREV"],5),
            finite_or_none(x["MACD_SIGNAL"],5), finite_or_none(x["MACD_SIGNAL_PREV"],5), finite_or_none(x["Close"],4),
            finite_or_none(x["SMA20"],4), finite_or_none(x["SMA50"],4), finite_or_none(x["SMA200"],4),
            finite_or_none(x["RELVOL"],3), finite_or_none(x["CHG1"],3), finite_or_none(x["CHG5"],3),
            finite_or_none(x["FROM_HIGH52"],3), finite_or_none(x["FROM_LOW52"],3),
            finite_or_none(x["FWD1"]*100,3), finite_or_none(x["FWD5"]*100,3), finite_or_none(x["FWD10"]*100,3), finite_or_none(x["FWD20"]*100,3),
        ])
    return rows


def shard_for(ticker: str) -> int:
    return fnv1a(ticker) % SHARD_COUNT


def download_batch(tickers: list[str], period: str, interval: str) -> pd.DataFrame:
    for attempt in range(3):
        try:
            return yf.download(tickers=tickers, period=period, interval=interval, group_by="ticker", auto_adjust=False, threads=True, progress=False, timeout=30)
        except Exception as exc:
            print(f"Batch attempt {attempt + 1} failed: {exc}")
            time.sleep(4 * (attempt + 1))
    return pd.DataFrame()


def build_one(timeframe: str, universe: list[dict]) -> None:
    cfg = CONFIG[timeframe]
    base = Path("data/market") / timeframe
    history_dir = base / "history"
    latest_out = base / "latest.json"
    history_dir.mkdir(parents=True, exist_ok=True)
    for old in history_dir.glob("history_*.ndjson"):
        old.unlink()

    meta = {r["ticker"]: r for r in universe}
    tickers = list(meta)
    latest = []
    failed = []
    observations = 0

    for start in range(0, len(tickers), BATCH_SIZE):
        batch = tickers[start:start+BATCH_SIZE]
        print(f"{cfg['label']}: {start+1}-{min(start+len(batch), len(tickers))} of {len(tickers)}")
        raw = download_batch(batch, cfg["period"], cfg["interval"])
        shard_lines: dict[int, list[str]] = {}
        for ticker in batch:
            try:
                df = normalise_frame(raw, ticker)
                if len(df) < 35:
                    failed.append(ticker); continue
                df = enrich(df, cfg["high_lookback"])
                latest.append(latest_record(meta[ticker], df))
                hist = compact_history(df, cfg["history_tail"])
                if hist:
                    sid = shard_for(ticker)
                    shard_lines.setdefault(sid, []).append(json.dumps([ticker, hist], separators=(",", ":")))
                    observations += len(hist)
            except Exception as exc:
                failed.append(f"{ticker}: {exc}")
        for sid, lines in shard_lines.items():
            with (history_dir / f"history_{sid:03d}.ndjson").open("a", encoding="utf-8") as fh:
                fh.write("\n".join(lines) + "\n")
        time.sleep(0.35)

    latest.sort(key=lambda x: x["ticker"])
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "source": f"Yahoo Finance via yfinance ({cfg['interval']}); listings from Nasdaq Trader Symbol Directory",
        "timeframe": cfg["label"], "generated_at": now, "history_version": now,
        "history_shards": SHARD_COUNT, "history_base": f"data/market/{timeframe}/history",
        "universe_size": len(universe), "processed_symbols": len(latest),
        "processed_stocks": sum(1 for x in latest if not x["is_etf"]), "processed_etfs": sum(1 for x in latest if x["is_etf"]),
        "failed_count": len(failed), "failed_symbols": failed[:300], "historical_observations_built": observations,
        "schema": {"history_columns": HISTORY_COLUMNS}, "latest": latest,
    }
    latest_out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {latest_out}: {len(latest)} symbols; history {observations}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeframe", choices=["weekly", "monthly", "all"], default="all")
    args = parser.parse_args()
    universe = build_universe()
    targets = ["weekly", "monthly"] if args.timeframe == "all" else [args.timeframe]
    for tf in targets:
        build_one(tf, universe)


if __name__ == "__main__":
    main()
