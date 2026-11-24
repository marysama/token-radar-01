// lib/model.ts
//
// Radar-2: rank pre-token protocols by implied value and draft an eight-step
// farm plan for each one. Pure functions over the frozen snapshot — no file
// access, no network, no dates taken from the clock. main.ts owns reading the
// snapshot and writing the board out.
//
// The score answers one question: if this protocol launched a token tomorrow,
// roughly how big would it be? Start from locked value, then bend it by how
// fast the protocol is growing, how long it has been around, how many chains
// it sits on, and a small boost for young protocols that are already moving.

export interface Tune {
  /** Fraction of TVL the model treats as a starting point. */
  baseMultiple: number;
  /** How much of the 7-day growth rate feeds the score. */
  growthWeight: number;
  /** 7-day growth is never read below this percent. */
  growthFloor: number;
  /** 7-day growth is never read above this percent. */
  growthCap: number;
  /** Maturity factor for a protocol listed yesterday. */
  maturityFloor: number;
  /** Extra maturity a protocol gains by lasting the full window. */
  maturityRange: number;
  /** Days over which the maturity factor climbs to its top. */
  maturityDays: number;
  /** Age assumed when a protocol has no listing date. */
  unknownAgeDays: number;
  /** Extra factor per chain beyond the first. */
  chainStep: number;
  /** Most extra chains that can add to the factor. */
  chainMaxExtra: number;
  /** A protocol younger than this many days can count as early. */
  earlyAgeDays: number;
  /** 7-day growth above this percent counts as early momentum. */
  earlyGrowthPct: number;
  /** Factor applied to early, fast-growing protocols. */
  earlyMultiplier: number;
}

export const TUNE: Tune = {
  baseMultiple: 0.25,
  growthWeight: 0.5,
  growthFloor: -60,
  growthCap: 120,
  maturityFloor: 0.6,
  maturityRange: 0.4,
  maturityDays: 1095,
  unknownAgeDays: 365,
  chainStep: 0.04,
  chainMaxExtra: 5,
  earlyAgeDays: 365,
  earlyGrowthPct: 20,
  earlyMultiplier: 1.1,
};

/** The tuning knobs in the shape the dashboard's data file carries them. */
export function describeTune(t: Tune): Record<string, number> {
  return {
    base_multiple: t.baseMultiple,
    growth_weight: t.growthWeight,
    growth_floor: t.growthFloor,
    growth_cap: t.growthCap,
    maturity_floor: t.maturityFloor,
    maturity_range: t.maturityRange,
    maturity_days: t.maturityDays,
    unknown_age_days: t.unknownAgeDays,
    chain_step: t.chainStep,
    chain_max_extra: t.chainMaxExtra,
    early_age_days: t.earlyAgeDays,
    early_growth_pct: t.earlyGrowthPct,
    early_multiplier: t.earlyMultiplier,
  };
}

/** One protocol as the snapshot lists it. */
export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

export interface ModelBreakdown {
  base_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  early_multiplier: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  flags: string[];
  farm_steps: string[];
}

export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

export interface Board {
  asOf: string;
  source: string;
  floorUsd: number;
  rows: BoardRow[];
  live: LiveEntry[];
  counts: {
    watchlist: number;
    board: number;
    early: number;
    rising: number;
    setAside: number;
    live: number;
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Drop trademark marks and squash runs of whitespace in a display name. */
function tidy(raw: string): string {
  return raw.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

/** Whole days from a `YYYY-MM-DD` listing date to the snapshot date. */
function daysBetween(listed: string, asOf: string): number {
  const [y, m, d] = listed.split("-").map(Number);
  const [ay, am, ad] = asOf.split("-").map(Number);
  const ms = Date.UTC(ay, am - 1, ad) - Date.UTC(y, m - 1, d);
  return Math.round(ms / 86_400_000);
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Round to four decimals the way JavaScript rounds (halves go up). */
function fourDp(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

// ---------------------------------------------------------------------------
// Which protocols can be ranked at all
// ---------------------------------------------------------------------------

/** A protocol has no token to buy when it carries neither a market cap nor a ticker. */
function hasNoToken(p: Proto): boolean {
  return p.mcap_usd === null && p.symbol === null;
}

/** Categories that are bridges, staking wrappers or exchanges, not farmable apps. */
const SET_ASIDE_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

const EXCHANGE_NAMES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

function mentionsWrappedOrStaked(name: string): boolean {
  return /\b(wrapped|staked|staking)\b/i.test(name);
}

function isExchangeBranded(name: string): boolean {
  return EXCHANGE_NAMES.some((x) => name.startsWith(x));
}

function isVersionedCopy(name: string): boolean {
  return /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(name);
}

/** True for a no-token protocol the board sets aside instead of ranking. */
function isSetAside(p: Proto, name: string): boolean {
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) return true;
  if (mentionsWrappedOrStaked(name)) return true;
  if (isExchangeBranded(name)) return true;
  if (isVersionedCopy(name)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface Score {
  ageDays: number | null;
  growthPct: number;
  clippedPct: number;
  growth: number;
  maturity: number;
  chain: number;
  early: number;
  implied: number;
  rising: boolean;
}

function scoreOne(p: Proto, asOf: string, t: Tune): Score {
  const growthPct = p.change_7d ?? 0;
  const clipped = clampNum(growthPct, t.growthFloor, t.growthCap);
  const growth = 1 + (clipped / 100) * t.growthWeight;
  const ageDays = p.listed_at === null ? null : daysBetween(p.listed_at, asOf);
  const ageForMaturity = ageDays ?? t.unknownAgeDays;
  const maturity =
    t.maturityFloor +
    (Math.min(ageForMaturity, t.maturityDays) / t.maturityDays) * t.maturityRange;
  const chain = 1 + t.chainStep * Math.min(p.chains.length - 1, t.chainMaxExtra);
  const rising =
    ageDays !== null && ageDays < t.earlyAgeDays && growthPct > t.earlyGrowthPct;
  const early = rising ? t.earlyMultiplier : 1;
  const implied = Math.round(p.tvl_usd * t.baseMultiple * growth * maturity * chain * early);
  return { ageDays, growthPct, clippedPct: clipped, growth, maturity, chain, early, implied, rising };
}

// ---------------------------------------------------------------------------
// Farm plans
// ---------------------------------------------------------------------------

const GAS_TOKENS: Record<string, string> = {
  Aptos: "APT",
  Arbitrum: "ETH",
  Avalanche: "AVAX",
  Base: "ETH",
  Berachain: "BERA",
  Binance: "BNB",
  Bitcoin: "BTC",
  Ethereum: "ETH",
  Monad: "MON",
  Polygon: "POL",
  Solana: "SOL",
  Starknet: "STRK",
  Sui: "SUI",
  Tron: "TRX",
  "zkSync Era": "ETH",
};

/** What the gas is paid in on a chain the table does not know. */
const NATIVE_TOKEN = "the chain\u2019s native token";

function gasToken(chain: string): string {
  return GAS_TOKENS[chain] ?? NATIVE_TOKEN;
}

/** How much capital the plan asks for, by how big the protocol already is. */
function stakeSize(tvl: number): number {
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/** How long the plan asks the position to sit, by how old the protocol is. */
function holdDays(ageDays: number | null): number {
  if (ageDays === null || ageDays >= 365) return 30;
  if (ageDays >= 180) return 45;
  return 60;
}

type OpeningKey =
  | "vault"
  | "liquidity"
  | "supply"
  | "margin"
  | "yield"
  | "stake"
  | "market"
  | "stable"
  | "bridge"
  | "cover"
  | "deposit";

/** Which opening move a category calls for; anything unlisted takes a plain deposit. */
const OPENING_BY_CATEGORY: Array<[string[], OpeningKey]> = [
  [["Risk Curators", "Onchain Capital Allocator", "Yield", "Yield Aggregator"], "vault"],
  [["Dexs", "Indexes", "Leveraged Farming"], "liquidity"],
  [["CDP", "CDP Manager", "Collateral Markets", "Lending", "Uncollateralized Lending"], "supply"],
  [["Derivatives", "Interest Rate Derivatives"], "margin"],
  [["RWA"], "yield"],
  [["Restaking", "Staking Pool"], "stake"],
  [["Prediction Market"], "market"],
  [["Dual-Token Stablecoin", "Stablecoin Wrapper"], "stable"],
  [["Cross Chain Bridge"], "bridge"],
  [["Insurance"], "cover"],
];

function openingKey(category: string | null): OpeningKey {
  for (const [cats, key] of OPENING_BY_CATEGORY) {
    if (category !== null && cats.includes(category)) return key;
  }
  return "deposit";
}

interface PlanCtx {
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  ageDays: number | null;
}

const STEP_ONE =
  "Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.";
const STEP_WEEKLY =
  "Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote. Cost: about $2 of gas a week. Time: 10 minutes a week.";
const STEP_POINTS =
  "Check the protocol's own points or rewards page once a week and note the balance in the farm log. Cost: no fee to check. Time: 5 minutes a week.";
const STEP_CLAIM =
  "Before you withdraw or claim, open the protocol's own page and claim only from the link it publishes: never pay to claim, and never follow a claim link from a chat or a search ad. Cost: no fee to check, and never pay to claim. Time: 10 minutes.";
const STEP_LOG =
  "Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.";

function openingStep(ctx: PlanCtx, amt: number, tok: string): string {
  const chain = ctx.chains[0];
  const cost = `Cost: $${amt} of capital and about $${amt === 150 ? 8 : 4} of gas in ${tok}. Time: 15 minutes to set up.`;
  switch (openingKey(ctx.category)) {
    case "vault":
      return `Deposit $${amt} into a ${ctx.name} vault on ${chain} and keep the shares. ${cost}`;
    case "liquidity":
      return `Provide $${amt} of liquidity to ${ctx.name}'s main pool on ${chain} and keep the position open. ${cost}`;
    case "supply":
      return `Supply $${amt} of USDC to ${ctx.name} on ${chain} and keep the position open. ${cost}`;
    case "margin":
      return `Deposit $${amt} of USDC as margin on ${ctx.name} and open one small hedge. ${cost}`;
    case "yield":
      return `Mint $${amt} of the protocol's yield asset on ${chain} and hold it. ${cost}`;
    case "stake":
      return `Stake $${amt} of the chain's staking asset through ${ctx.name} and keep the receipt. ${cost}`;
    case "market":
      return `Fund $${amt} and place one market position on ${ctx.name}. ${cost}`;
    case "stable":
      return `Mint or deposit $${amt} of the stable asset through ${ctx.name} on ${chain}. ${cost}`;
    case "bridge":
      return `Bridge $${amt} of USDC to ${chain} through ${ctx.name} and use the bridged funds in its app. ${cost}`;
    case "cover":
      return `Buy $${amt} of cover from ${ctx.name} on ${chain} and keep the policy. ${cost}`;
    default:
      return `Deposit $${amt} of USDC into ${ctx.name} on ${chain} and keep the position open. ${cost}`;
  }
}

function secondChainStep(ctx: PlanCtx, amt: number, tok: string): string {
  if (ctx.chains.length >= 2) {
    const half = amt / 2;
    const gas = half === 75 ? 6 : 3;
    return `Repeat a $${half} position on ${ctx.chains[1]} so the activity is not on one chain only. Cost: about $${gas} of gas in ${tok}. Time: 10 minutes a week.`;
  }
  const cat = ctx.category;
  const secondPool =
    cat !== null && ["Dexs", "Indexes", "Yield", "Yield Aggregator"].includes(cat);
  const borrowSide =
    cat !== null && ["CDP", "Lending", "Uncollateralized Lending"].includes(cat);
  const restakeSide = cat !== null && ["Restaking", "Staking Pool"].includes(cat);
  const cost = `Cost: about $3 of gas in ${tok}. Time: 10 minutes a week.`;
  if (secondPool) {
    return `Swap a small amount through a second pool on the same protocol so more than one pool sees the wallet. ${cost}`;
  }
  if (borrowSide) {
    return `Borrow a small amount against the deposit and repay it, so the wallet shows both sides of the protocol. ${cost}`;
  }
  if (restakeSide) {
    return `Restake or compound the receipt once so the wallet's stake grows instead of sitting still. ${cost}`;
  }
  return `Use a second feature of the protocol, such as its swap, vote or rewards page, once a week. ${cost}`;
}

function holdStep(amt: number, days: number): string {
  return `Hold the position for at least ${days} days so the activity is counted in more than one snapshot. Cost: the $${amt} stays in the position. Time: ${days} days.`;
}

/** The eight steps for one protocol, in the order a farmer would follow them. */
function planSteps(ctx: PlanCtx): string[] {
  const amt = stakeSize(ctx.tvl);
  const tok = gasToken(ctx.chains[0]);
  return [
    STEP_ONE,
    openingStep(ctx, amt, tok),
    STEP_WEEKLY,
    secondChainStep(ctx, amt, tok),
    holdStep(amt, holdDays(ctx.ageDays)),
    STEP_POINTS,
    STEP_CLAIM,
    STEP_LOG,
  ];
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export function buildBoard(snap: Snapshot, tune: Tune = TUNE): Board {
  const watch = new Set(snap.watchlist);
  const rows: BoardRow[] = [];
  let setAside = 0;

  for (const p of snap.protocols) {
    if (!hasNoToken(p)) continue;
    const name = tidy(p.name);
    if (isSetAside(p, name)) {
      setAside += 1;
      continue;
    }
    const s = scoreOne(p, snap.as_of, tune);
    const flags: string[] = [];
    if (watch.has(p.slug)) flags.push("watchlist");
    if (p.tvl_usd < snap.floor_usd) flags.push("early");
    if (s.rising) flags.push("rising");
    rows.push({
      rank: 0,
      slug: p.slug,
      name,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: "pre-token",
      age_days: s.ageDays,
      implied_value_usd: s.implied,
      model: {
        base_multiple: tune.baseMultiple,
        growth_pct: s.clippedPct,
        growth_multiplier: fourDp(s.growth),
        maturity_multiplier: fourDp(s.maturity),
        chain_multiplier: fourDp(s.chain),
        early_multiplier: s.early,
        age_days: s.ageDays,
      },
      flags,
      farm_steps: planSteps({
        name,
        category: p.category,
        chains: p.chains,
        tvl: p.tvl_usd,
        ageDays: s.ageDays,
      }),
    });
  }

  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const live: LiveEntry[] = snap.protocols
    .filter((p) => p.mcap_usd !== null && p.category !== "CEX")
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: tidy(p.name),
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
    }));

  return {
    asOf: snap.as_of,
    source: snap.source,
    floorUsd: snap.floor_usd,
    rows,
    live,
    counts: {
      watchlist: snap.watchlist.length,
      board: rows.length,
      early: rows.length - snap.watchlist.length,
      rising: rows.filter((r) => r.flags.includes("rising")).length,
      setAside,
      live: live.length,
    },
  };
}
