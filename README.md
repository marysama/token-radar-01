# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/marysama/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/marysama/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

The best token launch radar: a program that reads a frozen DefiLlama snapshot of the protocol
universe and writes a dashboard ranking every pre-token protocol by implied value, with a farm
plan for each one.

## What it does

- **Coverage first:** 198 rows — every rankable pre-token protocol in the snapshot (the 40
  watchlist protocols, the 12 other rankable ones at or above the $50M floor, and all 146
  rankable ones below it). The watchlist is the floor, never the ceiling.
- **No wrapped products:** 91 wrapped, staked or bridged products of tokens that already trade
  (WBTC, staked ETH, bridges) are set aside with the live tokens, not ranked — they are not
  launches waiting to happen. The rule is the field guide's own.
- **Value model radar-2:** implied value follows only from the snapshot's own figures — TVL,
  seven-day growth, age with no token, chain reach, and an early multiplier for young,
  fast-growing protocols. No protocol name is special-cased. The dashboard states the formula
  and lets the reader re-rank the board live in a model sandbox.
- **Farm plans:** eight concrete steps per protocol, derived from its category, chains, TVL and
  age — each with a cost and a time, including a second-chain or second-feature action, a hold
  window, a points-page check and claim safety.
- **Rising:** protocols under a year old growing over 20% in seven days are flagged as the
  early signal — where a token that does not exist yet is found first.
- **Live tokens set aside:** the 24 largest protocols whose token already trades are shown with
  their market caps, never mixed into the pre-token ranking.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22+, standard library only. Writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` to the output directory. Deterministic: two runs write the
same bytes.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, scores the board, writes the output.
- `lib/model.ts` — the radar-2 model, the farm plans and the board checks.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte as the kit ships it.
- `dashboard/` — the static page (no framework, no network): `index.html`, `app.css`, `app.js`.
- `screenshots/` — the board, a detail view and a filtered view, rendered from this dashboard.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ys1a7ngv&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
