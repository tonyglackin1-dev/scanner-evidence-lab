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
CONFIG = {
    "daily": {"interval": "1d", "period": "5y", "tail": 760},
    "weekly": {"interval": "1wk", "period": "10y", "tail": 420},
    "monthly": {"interval": "1mo", "period": "20y", "tail": 240},
}
HISTORY_COLUMNS = [
    "rsi","macd","macd_prev","macd_signal","macd_signal_prev","close",
    "sma20","sma50","sma200","relvol","chg1","chg5","from_high52","from_low52",
    "fwd1_pct","fwd5_pct","fwd10_pct","fwd20_pct",
    "ema20","ema20_prev","ema50","ema50_prev","ema100","ema100_prev","ema200","ema200_prev",
]


def enrich(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    out = df.copy()
    out["RSI"] = rsi(out["Close"])
    out["EMA12"] = out["Close"].ewm(span=12, adjust=False).mean()
    out["EMA26"] = out["Close"].ewm(span=26, adjust=False).mean()
    out["MACD"] = out["EMA12"] - out["EMA26"]
    out["MACD_PREV"] = out["MACD"].shift(1)
    out["MACD_SIGNAL"] = out["MACD"].ewm(span=9, adjust=False).mean()
    out["MACD_SIGNAL_PREV"] = out["MACD_SIGNAL"].shift(1)
    for n in (20,50,100,200):
        out[f"EMA{n}"] = out["Close"].ewm(span=n, adjust=False).mean()
        out[f"EMA{n}_PREV"] = out[f"EMA{n}"].shift(1)
    out["SMA20"] = out["Close"].rolling(20).mean()
    out["SMA50"] = out["Close"].rolling(50).mean()
    out["SMA200"] = out["Close"].rolling(200).mean()
    out["VOL20"] = out["Volume"].shift(1).rolling(20).mean()
    out["RELVOL"] = out["Volume"] / out["VOL20"].replace(0,np.nan)
    out["AVG_DOLLAR_VOL20"] = (out["Close"]*out["Volume"]).shift(1).rolling(20).mean()
    out["CHG1"] = out["Close"].pct_change(1)*100
    out["CHG5"] = out["Close"].pct_change(5)*100
    lookback = 252 if timeframe == "daily" else (52 if timeframe == "weekly" else 12)
    minp = 60 if timeframe == "daily" else max(6,lookback//2)
    hi = out["High"].rolling(lookback,min_periods=minp).max()
    lo = out["Low"].rolling(lookback,min_periods=minp).min()
    out["FROM_HIGH52"] = (out["Close"]/hi-1)*100
    out["FROM_LOW52"] = (out["Close"]/lo-1)*100
    for n in (1,5,10,20): out[f"FWD{n}"] = out["Close"].shift(-n)/out["Close"]-1
    return out


def latest_record(meta: dict, df: pd.DataFrame) -> dict:
    x=df.iloc[-1]
    rec={"ticker":meta["ticker"]}
    for n in (20,50,100,200):
        rec[f"ema{n}"]=finite_or_none(x[f"EMA{n}"],4)
        rec[f"ema{n}_prev"]=finite_or_none(x[f"EMA{n}_PREV"],4)
    return rec


def compact_history(df: pd.DataFrame, tail: int) -> list[list]:
    cols=["RSI","MACD","MACD_PREV","MACD_SIGNAL","MACD_SIGNAL_PREV","Close","SMA20","SMA50","SMA200","RELVOL","CHG1","CHG5","FROM_HIGH52","FROM_LOW52","FWD1","FWD5","FWD10","FWD20","EMA20","EMA20_PREV","EMA50","EMA50_PREV","EMA100","EMA100_PREV","EMA200","EMA200_PREV"]
    hist=df[cols].dropna(subset=["RSI","MACD","MACD_PREV","RELVOL"]).tail(tail)
    rows=[]
    for _,x in hist.iterrows():
        row=[]
        for i,c in enumerate(cols):
            v=x[c]
            if c.startswith("FWD"): v=v*100
            digits=5 if "MACD" in c else (2 if c=="RSI" else (3 if c in {"RELVOL","CHG1","CHG5","FROM_HIGH52","FROM_LOW52"} or c.startswith("FWD") else 4))
            row.append(finite_or_none(v,digits))
        rows.append(row)
    return rows


def shard_for(ticker: str) -> int: return fnv1a(ticker)%SHARD_COUNT


def download_batch(tickers,period,interval):
    for attempt in range(3):
        try:
            return yf.download(tickers=tickers,period=period,interval=interval,group_by="ticker",auto_adjust=False,threads=True,progress=False,timeout=30)
        except Exception as exc:
            print(f"Attempt {attempt+1} failed: {exc}"); time.sleep(4*(attempt+1))
    return pd.DataFrame()


def build_one(timeframe: str, universe: list[dict]):
    cfg=CONFIG[timeframe]
    base=Path("data/market/ema")/timeframe
    histdir=base/"history"; histdir.mkdir(parents=True,exist_ok=True)
    for p in histdir.glob("history_*.ndjson"): p.unlink()
    meta={r["ticker"]:r for r in universe}; tickers=list(meta)
    latest=[]; failed=[]; observations=0
    for start in range(0,len(tickers),BATCH_SIZE):
        batch=tickers[start:start+BATCH_SIZE]
        print(f"EMA {timeframe}: {start+1}-{min(start+len(batch),len(tickers))} of {len(tickers)}")
        raw=download_batch(batch,cfg["period"],cfg["interval"]); shard_lines={}
        for ticker in batch:
            try:
                df=normalise_frame(raw,ticker)
                if len(df)<35: failed.append(ticker); continue
                df=enrich(df,timeframe); latest.append(latest_record(meta[ticker],df))
                hist=compact_history(df,cfg["tail"])
                if hist:
                    sid=shard_for(ticker); shard_lines.setdefault(sid,[]).append(json.dumps([ticker,hist],separators=(",",":"))); observations+=len(hist)
            except Exception as exc: failed.append(f"{ticker}: {exc}")
        for sid,lines in shard_lines.items():
            with (histdir/f"history_{sid:03d}.ndjson").open("a",encoding="utf-8") as fh: fh.write("\n".join(lines)+"\n")
        time.sleep(.35)
    latest.sort(key=lambda x:x["ticker"]); now=datetime.now(timezone.utc).isoformat()
    payload={"source":f"Yahoo Finance EMA evidence ({cfg['interval']})","timeframe":timeframe.title(),"generated_at":now,"history_version":now,"history_shards":SHARD_COUNT,"history_base":f"data/market/ema/{timeframe}/history","processed_symbols":len(latest),"failed_count":len(failed),"failed_symbols":failed[:300],"historical_observations_built":observations,"schema":{"history_columns":HISTORY_COLUMNS},"latest":latest}
    (base/"latest.json").write_text(json.dumps(payload,separators=(",",":")),encoding="utf-8")
    print(f"Wrote EMA {timeframe}: {len(latest)} symbols; {observations} history rows")


def main():
    p=argparse.ArgumentParser(); p.add_argument("--timeframe",choices=["daily","weekly","monthly","all"],default="all"); a=p.parse_args()
    universe=build_universe(); targets=list(CONFIG) if a.timeframe=="all" else [a.timeframe]
    for tf in targets: build_one(tf,universe)

if __name__=="__main__": main()
