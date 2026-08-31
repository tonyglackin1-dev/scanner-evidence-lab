from __future__ import annotations

import json
from pathlib import Path
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf

TICKERS = [
    "AAPL","MSFT","NVDA","AMZN","GOOGL","META","AVGO","TSLA","BRK-B","LLY",
    "JPM","V","MA","WMT","XOM","COST","NFLX","ORCL","HD","PG","JNJ","ABBV",
    "BAC","KO","CRM","AMD","CSCO","PM","IBM","CVX","MCD","GE","ABT","CAT",
    "AXP","NOW","ISRG","QCOM","INTU","GS","DIS","TXN","PEP","TMO","AMGN",
    "BKNG","PFE","SPGI","RTX","UNH","DHR","BLK","HON","LOW","ADBE","AMAT",
    "LRCX","PANW","MU","PLTR","INTC","UBER","PYPL","SHOP","SNOW","CRWD",
    "SPY","QQQ","IWM","DIA","XLK","XLF","XLE","XLV","XLY","XLP","XLI","XLU",
    "SMH","SOXX","ARKK","TLT","GLD","SLV","USO","XBI","KRE","HYG","EEM","EFA"
]

OUT = Path("data/scan_data.json")


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
    out["CHG1"] = out["Close"].pct_change(1) * 100
    out["CHG5"] = out["Close"].pct_change(5) * 100
    out["HIGH252"] = out["High"].rolling(252).max()
    out["LOW252"] = out["Low"].rolling(252).min()
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


def latest_record(ticker: str, df: pd.DataFrame) -> dict:
    x = df.iloc[-1]
    return {
        "ticker": ticker,
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
        "chg1": finite_or_none(x["CHG1"], 3),
        "chg5": finite_or_none(x["CHG5"], 3),
        "from_high52": finite_or_none(x["FROM_HIGH52"], 3),
        "from_low52": finite_or_none(x["FROM_LOW52"], 3),
    }


def compact_history(df: pd.DataFrame) -> list[list]:
    cols = [
        "RSI","MACD","MACD_PREV","MACD_SIGNAL","MACD_SIGNAL_PREV","Close",
        "SMA20","SMA50","SMA200","RELVOL","CHG1","CHG5","FROM_HIGH52","FROM_LOW52",
        "FWD1","FWD5","FWD10","FWD20"
    ]
    required = ["RSI","MACD","MACD_PREV","MACD_SIGNAL","MACD_SIGNAL_PREV","Close","SMA20","SMA50","SMA200","RELVOL"]
    hist = df[cols].dropna(subset=required).tail(760)
    rows = []
    for _, x in hist.iterrows():
        rows.append([
            finite_or_none(x["RSI"], 2),
            finite_or_none(x["MACD"], 5),
            finite_or_none(x["MACD_PREV"], 5),
            finite_or_none(x["MACD_SIGNAL"], 5),
            finite_or_none(x["MACD_SIGNAL_PREV"], 5),
            finite_or_none(x["Close"], 4),
            finite_or_none(x["SMA20"], 4),
            finite_or_none(x["SMA50"], 4),
            finite_or_none(x["SMA200"], 4),
            finite_or_none(x["RELVOL"], 3),
            finite_or_none(x["CHG1"], 3),
            finite_or_none(x["CHG5"], 3),
            finite_or_none(x["FROM_HIGH52"], 3),
            finite_or_none(x["FROM_LOW52"], 3),
            finite_or_none(x["FWD1"] * 100, 3),
            finite_or_none(x["FWD5"] * 100, 3),
            finite_or_none(x["FWD10"] * 100, 3),
            finite_or_none(x["FWD20"] * 100, 3),
        ])
    return rows


def default_match(x: dict) -> bool:
    required = [x.get("rsi"), x.get("macd"), x.get("macd_prev"), x.get("close"), x.get("sma200"), x.get("relvol")]
    if any(v is None for v in required):
        return False
    return x["rsi"] < 45 and x["macd"] > x["macd_prev"] and x["close"] > x["sma200"] and x["relvol"] > 1.5


def main() -> None:
    print(f"Downloading {len(TICKERS)} symbols from Yahoo Finance...")
    raw = yf.download(
        tickers=TICKERS,
        period="5y",
        interval="1d",
        group_by="ticker",
        auto_adjust=False,
        threads=True,
        progress=False,
    )

    latest = []
    history = {}
    processed = 0
    failed = []

    for ticker in TICKERS:
        try:
            df = normalise_frame(raw, ticker)
            if len(df) < 270:
                failed.append(ticker)
                continue
            df = enrich(df)
            processed += 1
            latest.append(latest_record(ticker, df))
            history[ticker] = compact_history(df)
        except Exception as exc:
            failed.append(f"{ticker}: {exc}")

    latest.sort(key=lambda x: x["ticker"])
    default_matches = [x["ticker"] for x in latest if default_match(x)]

    payload = {
        "source": "Yahoo Finance via yfinance",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "universe_size": len(TICKERS),
        "processed_symbols": processed,
        "failed_symbols": failed,
        "schema": {
            "history_columns": [
                "rsi","macd","macd_prev","macd_signal","macd_signal_prev","close",
                "sma20","sma50","sma200","relvol","chg1","chg5","from_high52","from_low52",
                "fwd1_pct","fwd5_pct","fwd10_pct","fwd20_pct"
            ]
        },
        "capabilities": [
            "RSI above/below a threshold",
            "MACD rising/falling, positive/negative, or signal-line cross",
            "Price above/below 20, 50, or 200-day moving average",
            "Relative volume above/below a threshold",
            "1-day or 5-day price move above/below a percentage",
            "Within a percentage of the 52-week high",
            "At least a percentage above the 52-week low",
        ],
        "default_query": "RSI below 45, MACD rising, price above the 200-day moving average and relative volume above 1.5x",
        "default_matches": default_matches,
        "latest": latest,
        "history": history,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT}: {processed} symbols, {sum(len(v) for v in history.values())} historical observations.")


if __name__ == "__main__":
    main()
