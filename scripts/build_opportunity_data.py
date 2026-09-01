from __future__ import annotations

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
CONFIG = {
    "daily": {"interval": "1d", "period": "5y", "tail": 760, "lookback": 252, "label": "Daily"},
    "weekly": {"interval": "1wk", "period": "10y", "tail": 420, "lookback": 52, "label": "Weekly"},
    "monthly": {"interval": "1mo", "period": "20y", "tail": 240, "lookback": 12, "label": "Monthly"},
}

# First 18 columns deliberately match the core scanner history schema.
# 18-25 match the EMA evidence schema so current rules can be re-evaluated here too.
HISTORY_COLUMNS = [
    "rsi","macd","macd_prev","macd_signal","macd_signal_prev","close",
    "sma20","sma50","sma200","relvol","chg1","chg5","from_high52","from_low52",
    "fwd1_pct","fwd5_pct","fwd10_pct","fwd20_pct",
    "ema20","ema20_prev","ema50","ema50_prev","ema100","ema100_prev","ema200","ema200_prev",
    "mfe20_pct","mae20_pct","hit_up2","hit_up5","hit_up10","hit_down2","hit_down5","hit_down10",
    "peak_period","trough_period","fwd3_pct",
]


def first_hit(values: np.ndarray, predicate) -> float:
    for i, value in enumerate(values, start=1):
        if np.isfinite(value) and predicate(value):
            return float(i)
    return np.nan


def enrich(df: pd.DataFrame, lookback: int) -> pd.DataFrame:
    out = df.copy()
    c = out["Close"]
    out["RSI"] = rsi(c)
    out["EMA12"] = c.ewm(span=12, adjust=False).mean()
    out["EMA26"] = c.ewm(span=26, adjust=False).mean()
    out["MACD"] = out["EMA12"] - out["EMA26"]
    out["MACD_PREV"] = out["MACD"].shift(1)
    out["MACD_SIGNAL"] = out["MACD"].ewm(span=9, adjust=False).mean()
    out["MACD_SIGNAL_PREV"] = out["MACD_SIGNAL"].shift(1)
    out["SMA20"] = c.rolling(20).mean(); out["SMA50"] = c.rolling(50).mean(); out["SMA200"] = c.rolling(200).mean()
    for n in (20, 50, 100, 200):
        out[f"EMA{n}"] = c.ewm(span=n, adjust=False).mean()
        out[f"EMA{n}_PREV"] = out[f"EMA{n}"].shift(1)
    out["VOL20"] = out["Volume"].shift(1).rolling(20).mean()
    out["RELVOL"] = out["Volume"] / out["VOL20"].replace(0, np.nan)
    out["CHG1"] = c.pct_change(1) * 100; out["CHG5"] = c.pct_change(5) * 100
    hi = out["High"].rolling(lookback, min_periods=max(6, min(60, lookback // 2))).max()
    lo = out["Low"].rolling(lookback, min_periods=max(6, min(60, lookback // 2))).min()
    out["FROM_HIGH52"] = (c / hi - 1) * 100; out["FROM_LOW52"] = (c / lo - 1) * 100
    for n in (1, 3, 5, 10, 20):
        out[f"FWD{n}"] = c.shift(-n) / c - 1

    count = len(out)
    mfe = np.full(count, np.nan); mae = np.full(count, np.nan)
    up2 = np.full(count, np.nan); up5 = np.full(count, np.nan); up10 = np.full(count, np.nan)
    dn2 = np.full(count, np.nan); dn5 = np.full(count, np.nan); dn10 = np.full(count, np.nan)
    peak = np.full(count, np.nan); trough = np.full(count, np.nan)
    highs = out["High"].to_numpy(dtype=float); lows = out["Low"].to_numpy(dtype=float); closes = c.to_numpy(dtype=float)
    for i in range(count - 1):
        base = closes[i]
        if not np.isfinite(base) or base <= 0: continue
        end = min(count, i + 21)
        fh = highs[i + 1:end]; fl = lows[i + 1:end]
        if not len(fh): continue
        hp = (fh / base - 1) * 100; lp = (fl / base - 1) * 100
        if np.isfinite(hp).any():
            mfe[i] = np.nanmax(hp); peak[i] = float(np.nanargmax(hp) + 1)
            up2[i] = first_hit(hp, lambda x: x >= 2); up5[i] = first_hit(hp, lambda x: x >= 5); up10[i] = first_hit(hp, lambda x: x >= 10)
        if np.isfinite(lp).any():
            mae[i] = np.nanmin(lp); trough[i] = float(np.nanargmin(lp) + 1)
            dn2[i] = first_hit(lp, lambda x: x <= -2); dn5[i] = first_hit(lp, lambda x: x <= -5); dn10[i] = first_hit(lp, lambda x: x <= -10)
    out["MFE20"] = mfe; out["MAE20"] = mae
    out["HIT_UP2"] = up2; out["HIT_UP5"] = up5; out["HIT_UP10"] = up10
    out["HIT_DOWN2"] = dn2; out["HIT_DOWN5"] = dn5; out["HIT_DOWN10"] = dn10
    out["PEAK_PERIOD"] = peak; out["TROUGH_PERIOD"] = trough
    return out


def compact(df: pd.DataFrame, tail: int) -> list[list]:
    cols = [
        "RSI","MACD","MACD_PREV","MACD_SIGNAL","MACD_SIGNAL_PREV","Close","SMA20","SMA50","SMA200","RELVOL","CHG1","CHG5","FROM_HIGH52","FROM_LOW52",
        "FWD1","FWD5","FWD10","FWD20","EMA20","EMA20_PREV","EMA50","EMA50_PREV","EMA100","EMA100_PREV","EMA200","EMA200_PREV",
        "MFE20","MAE20","HIT_UP2","HIT_UP5","HIT_UP10","HIT_DOWN2","HIT_DOWN5","HIT_DOWN10","PEAK_PERIOD","TROUGH_PERIOD","FWD3",
    ]
    hist = df[cols].dropna(subset=["RSI","MACD","MACD_PREV","RELVOL"]).tail(tail)
    rows = []
    digits = [2,5,5,5,5,4,4,4,4,3,3,3,3,3,3,3,3,3,4,4,4,4,4,4,4,4,3,3,0,0,0,0,0,0,0,0,3]
    for _, x in hist.iterrows():
        vals = []
        for j, col in enumerate(cols):
            value = x[col]
            if col.startswith("FWD"):
                value = value * 100
            vals.append(finite_or_none(value, digits[j]))
        rows.append(vals)
    return rows


def shard_for(ticker: str) -> int:
    return fnv1a(ticker) % SHARD_COUNT


def download_batch(tickers: list[str], cfg: dict) -> pd.DataFrame:
    for attempt in range(3):
        try:
            return yf.download(tickers=tickers, period=cfg["period"], interval=cfg["interval"], group_by="ticker", auto_adjust=False, threads=True, progress=False, timeout=30)
        except Exception as exc:
            print(f"Attempt {attempt+1} failed: {exc}"); time.sleep(4 * (attempt + 1))
    return pd.DataFrame()


def build_timeframe(name: str, universe: list[dict]) -> None:
    cfg = CONFIG[name]; base = Path("data/market/opportunity") / name; history = base / "history"; history.mkdir(parents=True, exist_ok=True)
    for old in history.glob("history_*.ndjson"): old.unlink()
    meta = {x["ticker"]: x for x in universe}; tickers = list(meta); failed = []; observations = 0
    for start in range(0, len(tickers), BATCH_SIZE):
        batch = tickers[start:start+BATCH_SIZE]; print(f"{cfg['label']} opportunity {start+1}-{min(start+len(batch),len(tickers))} of {len(tickers)}")
        raw = download_batch(batch, cfg); shard_lines: dict[int, list[str]] = {}
        for ticker in batch:
            try:
                df = normalise_frame(raw, ticker)
                if len(df) < 35: failed.append(ticker); continue
                rows = compact(enrich(df, cfg["lookback"]), cfg["tail"])
                if rows:
                    sid = shard_for(ticker); shard_lines.setdefault(sid, []).append(json.dumps([ticker, rows], separators=(",", ":"))); observations += len(rows)
            except Exception as exc:
                failed.append(f"{ticker}: {exc}")
        for sid, lines in shard_lines.items():
            with (history / f"history_{sid:03d}.ndjson").open("a", encoding="utf-8") as fh: fh.write("\n".join(lines) + "\n")
        time.sleep(.35)
    now = datetime.now(timezone.utc).isoformat()
    payload = {"source": f"Yahoo Finance via yfinance ({cfg['interval']})", "timeframe": cfg["label"], "generated_at": now, "history_version": now,
               "history_shards": SHARD_COUNT, "history_base": f"data/market/opportunity/{name}/history", "processed_symbols": len(tickers)-len(failed),
               "failed_count": len(failed), "historical_observations_built": observations, "window_periods": 20, "schema": {"history_columns": HISTORY_COLUMNS}}
    (base / "latest.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    universe = build_universe()
    for name in ("daily", "weekly", "monthly"):
        build_timeframe(name, universe)


if __name__ == "__main__":
    main()
