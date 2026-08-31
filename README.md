# Scanner Evidence Lab

**Find the setup. See the evidence.**

Scanner Evidence Lab is a market-scanning dashboard for end-of-day technical scans with historical aftermath evidence.

## Current MVP

- Full US stocks + ETFs market universe
- Yahoo Finance EOD data pipeline
- Easy Mode natural-language scan builder
- RSI, MACD, moving averages, relative volume, price-move and 52-week rules
- Historical +1D / +5D / +10D / +20D aftermath evidence
- Full-market snapshot with on-demand historical evidence shards
- Automated weekday market refreshes and scheduled deeper history rebuilds
- Responsive dark dashboard UI

## Deployment

This repository is configured to deploy to GitHub Pages using GitHub Actions. The full-market dataset is generated automatically and served with the static application.

## Next build stages

1. Verify full-market deployment end-to-end.
2. Add stronger scan ranking and liquidity controls.
3. Add saved scans and watchlists persistence.
4. Add authentication and plan controls.
5. Continue expanding the Easy Mode rule vocabulary and evidence analysis.
