# TAB Racing Results Collector

This module is deliberately **TAB-only**. It does not use TABtouch, Racenet, Breednet, Racing & Sports or any other result provider as a fallback.

## Source

TAB documents that Previous Results provides complete parimutuel results for NSW and VIC for the previous 12 months, including scratchings, first four placings, dividends and final tote prices. TAB Studio documents its API at `https://api.beta.tab.com.au/`.

## Safety/integrity rules

- A row is written as verified only when returned by TAB.
- Missing TAB access or venue mapping produces a failure record, never a guessed result.
- The source URL is retained on every verified row.
- API credentials, if TAB requires them, are read only from `TAB_API_TOKEN`; never commit credentials.

## 5 October 2026 validation set

The built-in validation set is the six advised final selections:
Crescent King, Astern Effort, Ice Kool, Vantaa, Triple Yes and Nova Centauri.

Create `racing/tab_venue_codes.json` with TAB's venue codes, then run:

```bash
python racing/tab_results.py --validate-2026-10-05 --venue-map racing/tab_venue_codes.json --out racing/data/2026-10-05.csv
```

If TAB requires approved API authentication, set `TAB_API_TOKEN` in the runtime environment. Do not put the token in GitHub.
