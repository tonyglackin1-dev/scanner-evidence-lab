from __future__ import annotations

import json
from pathlib import Path
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf

# Broad liquid US large-cap + ETF starter universe. This is intentionally explicit
# so the daily job is deterministic and easy to extend.
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
    out["SMA200"] = out["Close"].rolling(200).mean()
    out["VOL20"] = out["Volume"].shift(1).rolling(20).mean()
    out["RELVOL"] = out["Volume"] / out["VOL20"].replace(0, np.nan)
    out["MACD_RISING"] = out["MACD"] > out["MACD"].shift(1)
    out["MATCH"] = (
        (out["RSI"] < 45)
        & out["MACD_RISING"]
        & (out["Close"] > out["SMA200"])
        & (out["RELVOL"] > 1.5)
    )
    for n in (1, 5, 10, 20):
        out[f"FWD{n}"] = out["Close"].shift(-n) / out["Close"] - 1
    return out


def evidence_stats(df: pd.DataFrame) -> dict:
    hist = df.loc[df["MATCH"]].copy()
    # Exclude the last 20 rows so every evidence event has a complete +20D outcome.
    if len(df) > 20:
        cutoff = df.index[-21]
        hist = hist.loc[hist.index <= cutoff]
    vals = {}
    for n in (1, 5, 10, 20):
        s = hist[f"FWD{n}"].dropna() * 100
        vals[str(n)] = {
            "median": round(float(s.median()), 2) if len(s) else None,
            "win_rate": round(float((s > 0).mean() * 100), 1) if len(s) else None,
            "sample": int(len(s)),
        }
    return vals


def fmt_price(x: float) -> str:
    return f"${x:,.2f}"


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

    matches = []
    processed = 0
    failed = []

    for ticker in TICKERS:
        try:
            df = normalise_frame(raw, ticker)
            if len(df) < 220:
                failed.append(ticker)
                continue
            df = enrich(df)
            processed += 1
            latest = df.iloc[-1]
            if not bool(latest["MATCH"]):
                continue

            ev = evidence_stats(df)
            evidence = [ev[str(n)]["median"] for n in (1, 5, 10, 20)]
            rules = [
                f"RSI {latest['RSI']:.1f} < 45",
                "MACD rising vs prior session",
                f"Close {fmt_price(latest['Close'])} > 200 DMA {fmt_price(latest['SMA200'])}",
                f"Relative volume {latest['RELVOL']:.2f}x > 1.5x",
            ]
            matches.append({
                "ticker": ticker,
                "price": fmt_price(float(latest["Close"])),
                "price_value": round(float(latest["Close"]), 4),
                "rsi": round(float(latest["RSI"]), 1),
                "rv": f"{float(latest['RELVOL']):.2f}x",
                "rv_value": round(float(latest["RELVOL"]), 3),
                "trend": "Above 200 DMA",
                "d5": None if ev["5"]["median"] is None else f"{ev['5']['median']:+.2f}%",
                "evidence": evidence,
                "evidence_detail": ev,
                "rules": rules,
                "asof": df.index[-1].strftime("%Y-%m-%d"),
            })
        except Exception as exc:
            failed.append(f"{ticker}: {exc}")

    matches.sort(key=lambda x: x["rv_value"], reverse=True)

    all_5d = []
    all_10d_wins = []
    total_samples = 0
    for row in matches:
        d5 = row["evidence_detail"]["5"]
        d10 = row["evidence_detail"]["10"]
        if d5["median"] is not None:
            all_5d.append(d5["median"])
        if d10["win_rate"] is not None:
            all_10d_wins.append(d10["win_rate"])
        total_samples += d5["sample"]

    payload = {
        "source": "Yahoo Finance via yfinance",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "rule_set": {
            "rsi": "RSI(14) < 45",
            "macd": "MACD rising vs prior session",
            "trend": "Close > SMA(200)",
            "relative_volume": "Volume / prior 20-day average volume > 1.5",
        },
        "universe_size": len(TICKERS),
        "processed_symbols": processed,
        "failed_symbols": failed,
        "matches": matches,
        "metrics": {
            "matches": len(matches),
            "median_5d": round(float(np.median(all_5d)), 2) if all_5d else None,
            "win_rate_10d": round(float(np.mean(all_10d_wins)), 1) if all_10d_wins else None,
            "sample_size": int(total_samples),
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {OUT} with {len(matches)} current matches from {processed} processed symbols.")


if __name__ == "__main__":
    main()
