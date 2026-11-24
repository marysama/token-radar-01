// main.ts
//
// Entrypoint (Node 22, standard library only). Reads the sealed snapshot,
// scores the board, and writes everything the grader reads:
//
//   /output/board.json     the ranked board, one object per protocol
//   /output/data.js        the same board, slimmed down, for the dashboard
//   /output/dashboard/    a copy of dashboard/
//   /output/screenshots/  a copy of screenshots/
//   /output/dossier.json  the judge's dossier, built by the kit's own
//                         buildDossier from vendor/makefun-board.ts
//
// Usage:
//   MAKEFUN_OUTPUT_DIR=/output node main.ts --input /input/snapshot.json

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard, describeTune, TUNE } from "./lib/model.ts";
import type { BoardRow, Snapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The dossier's limits, the same numbers the gate publishes. */
const DOSSIER_OPTS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};

function flagValue(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return null;
  return argv[i + 1];
}

/** Copy every file under a directory, keeping the tree shape. */
function copyTree(fromDir: string, toDir: string): void {
  mkdirSync(toDir, { recursive: true });
  for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
    const from = join(fromDir, entry.name);
    const to = join(toDir, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else copyFileSync(from, to);
  }
}

/** The dashboard's slim row: everything the page needs, nothing it does not. */
function slimRow(r: BoardRow): Record<string, unknown> {
  return {
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    mcap_usd: r.mcap_usd,
    listed_at: r.listed_at,
    age_days: r.age_days,
    implied_value_usd: r.implied_value_usd,
    growth_multiplier: r.model.growth_multiplier,
    maturity_multiplier: r.model.maturity_multiplier,
    chain_multiplier: r.model.chain_multiplier,
    early_multiplier: r.model.early_multiplier,
    flags: r.flags,
  };
}

function main(): void {
  const input = flagValue(process.argv.slice(2), "--input") ?? "/input/snapshot.json";
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

  const snap = JSON.parse(readFileSync(input, "utf8")) as Snapshot;
  const board = buildBoard(snap, TUNE);

  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, "board.json"), JSON.stringify({ rows: board.rows }) + "\n");

  const feed = {
    as_of: board.asOf,
    source: board.source,
    floor_usd: board.floorUsd,
    model: describeTune(TUNE),
    model_version: "radar-2",
    watchlist_size: board.counts.watchlist,
    board_size: board.counts.board,
    early_size: board.counts.early,
    rising_size: board.counts.rising,
    set_aside_size: board.counts.setAside,
    live_size: board.counts.live,
    rows: board.rows.map(slimRow),
    live: board.live,
  };
  writeFileSync(join(outDir, "data.js"), "window.RADAR=" + JSON.stringify(feed) + ";\n");

  copyTree(join(HERE, "dashboard"), join(outDir, "dashboard"));
  copyTree(join(HERE, "screenshots"), join(outDir, "screenshots"));

  writeFileSync(join(outDir, "dossier.json"), buildDossier(outDir, DOSSIER_OPTS));

  console.log(
    `board: ${board.rows.length} rows, top ${board.rows[0].name} $${board.rows[0].implied_value_usd.toLocaleString("en-US")}, ` +
      `${board.counts.rising} rising, ${board.counts.setAside} set aside, ${board.live.length} live`,
  );
}

main();
