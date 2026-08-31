# Scanner Evidence Lab

**Find the setup. See the evidence.**

Scanner Evidence Lab is a market-scanning dashboard for end-of-day technical scans with historical aftermath evidence.

## Current MVP

- Market universe: US Stocks + ETFs
- Timeframes: Daily / Weekly / Monthly
- Benchmark: SPY by default
- Easy Mode natural-language scan builder
- Results table with technical evidence
- Historical aftermath evidence panel
- Saved scans, watchlists and account navigation placeholders
- Responsive dark dashboard UI

## Deployment

This repository is configured to deploy the static MVP to GitHub Pages using GitHub Actions.

## Next build stages

1. Connect the scanner to live market data.
2. Convert Easy Mode rules into structured scanner conditions.
3. Add historical event-study calculations after each matched setup.
4. Add saved scans and watchlists persistence.
5. Add authentication and plan controls.
