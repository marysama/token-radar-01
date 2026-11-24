// app.js — Token Radar dashboard.
//
// Reads window.RADAR, the feed main.ts writes beside this page, and turns it
// into the board: filters, tabs, a sortable table, a detail dialog with the
// model breakdown and the eight-step farm plan, a model sandbox, and the
// set-aside live-token list. Everything runs in the page; nothing is sent
// anywhere and nothing is loaded from the network.

(function () {
  "use strict";

  var DATA = window.RADAR;
  if (!DATA || !DATA.rows) {
    document.getElementById("board").textContent =
      "The radar data did not load. Open this page beside its data.js file.";
    return;
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  function money(v) {
    if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return "$" + Math.round(v / 1e3) + "K";
    return "$" + Math.round(v);
  }

  function pct(v) {
    if (v === null || v === undefined) return "n/a";
    return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
  }

  function ageText(days) {
    if (days === null || days === undefined) return "n/a";
    if (days >= 365) return (days / 365).toFixed(1) + "y";
    return days + "d";
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------------------------------------------------------------------------
  // Scoring (mirrors the model, so the sandbox and the dialog recompute live)
  // ---------------------------------------------------------------------------

  function rescore(row, tune) {
    var m = DATA.model;
    var growthPct = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var clipped = Math.min(Math.max(growthPct, m.growth_floor), m.growth_cap);
    var growth = 1 + (clipped / 100) * tune.growthWeight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity =
      m.maturity_floor + (Math.min(age, m.maturity_days) / m.maturity_days) * m.maturity_range;
    var chain = 1 + m.chain_step * Math.min(row.chains.length - 1, m.chain_max_extra);
    var rising =
      row.age_days !== null &&
      row.age_days !== undefined &&
      row.age_days < m.early_age_days &&
      growthPct > m.early_growth_pct;
    var early = rising ? tune.earlyMultiplier : 1;
    return {
      growthPct: growthPct,
      growth: growth,
      maturity: maturity,
      chain: chain,
      early: early,
      rising: rising,
      implied: Math.round(row.tvl_usd * tune.base * growth * maturity * chain * early),
    };
  }

  var DEFAULT_TUNE = {
    base: DATA.model.base_multiple,
    growthWeight: DATA.model.growth_weight,
    earlyMultiplier: DATA.model.early_multiplier,
  };

  // ---------------------------------------------------------------------------
  // Farm plans (same rules as the model: the plan follows the row's own data)
  // ---------------------------------------------------------------------------

  var GAS = {
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

  function gasFor(chain) {
    return GAS[chain] || "the chain\u2019s native token";
  }

  function stakeSize(tvl) {
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    return 50;
  }

  function holdDays(age) {
    if (age === null || age === undefined || age >= 365) return 30;
    if (age >= 180) return 45;
    return 60;
  }

  var OPENING_BY_CATEGORY = [
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

  function openingKey(category) {
    for (var i = 0; i < OPENING_BY_CATEGORY.length; i++) {
      if (category !== null && OPENING_BY_CATEGORY[i][0].indexOf(category) !== -1) {
        return OPENING_BY_CATEGORY[i][1];
      }
    }
    return "deposit";
  }

  function openingStep(row, amt, tok) {
    var chain = row.chains[0];
    var cost =
      "Cost: $" + amt + " of capital and about $" + (amt === 150 ? 8 : 4) +
      " of gas in " + tok + ". Time: 15 minutes to set up.";
    switch (openingKey(row.category)) {
      case "vault":
        return "Deposit $" + amt + " into a " + row.name + " vault on " + chain + " and keep the shares. " + cost;
      case "liquidity":
        return "Provide $" + amt + " of liquidity to " + row.name + "'s main pool on " + chain + " and keep the position open. " + cost;
      case "supply":
        return "Supply $" + amt + " of USDC to " + row.name + " on " + chain + " and keep the position open. " + cost;
      case "margin":
        return "Deposit $" + amt + " of USDC as margin on " + row.name + " and open one small hedge. " + cost;
      case "yield":
        return "Mint $" + amt + " of the protocol's yield asset on " + chain + " and hold it. " + cost;
      case "stake":
        return "Stake $" + amt + " of the chain's staking asset through " + row.name + " and keep the receipt. " + cost;
      case "market":
        return "Fund $" + amt + " and place one market position on " + row.name + ". " + cost;
      case "stable":
        return "Mint or deposit $" + amt + " of the stable asset through " + row.name + " on " + chain + ". " + cost;
      case "bridge":
        return "Bridge $" + amt + " of USDC to " + chain + " through " + row.name + " and use the bridged funds in its app. " + cost;
      case "cover":
        return "Buy $" + amt + " of cover from " + row.name + " on " + chain + " and keep the policy. " + cost;
      default:
        return "Deposit $" + amt + " of USDC into " + row.name + " on " + chain + " and keep the position open. " + cost;
    }
  }

  function secondChainStep(row, amt, tok) {
    if (row.chains.length >= 2) {
      var half = amt / 2;
      var gas = half === 75 ? 6 : 3;
      return (
        "Repeat a $" + half + " position on " + row.chains[1] +
        " so the activity is not on one chain only. Cost: about $" + gas +
        " of gas in " + tok + ". Time: 10 minutes a week."
      );
    }
    var cat = row.category;
    var cost = "Cost: about $3 of gas in " + tok + ". Time: 10 minutes a week.";
    if (cat !== null && ["Dexs", "Indexes", "Yield", "Yield Aggregator"].indexOf(cat) !== -1) {
      return "Swap a small amount through a second pool on the same protocol so more than one pool sees the wallet. " + cost;
    }
    if (cat !== null && ["CDP", "Lending", "Uncollateralized Lending"].indexOf(cat) !== -1) {
      return "Borrow a small amount against the deposit and repay it, so the wallet shows both sides of the protocol. " + cost;
    }
    if (cat !== null && ["Restaking", "Staking Pool"].indexOf(cat) !== -1) {
      return "Restake or compound the receipt once so the wallet's stake grows instead of sitting still. " + cost;
    }
    return "Use a second feature of the protocol, such as its swap, vote or rewards page, once a week. " + cost;
  }

  function farmPlan(row) {
    var amt = stakeSize(row.tvl_usd);
    var tok = gasFor(row.chains[0]);
    var days = holdDays(row.age_days);
    return [
      "Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.",
      openingStep(row, amt, tok),
      "Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote. Cost: about $2 of gas a week. Time: 10 minutes a week.",
      secondChainStep(row, amt, tok),
      "Hold the position for at least " + days + " days so the activity is counted in more than one snapshot. Cost: the $" + amt + " stays in the position. Time: " + days + " days.",
      "Check the protocol's own points or rewards page once a week and note the balance in the farm log. Cost: no fee to check. Time: 5 minutes a week.",
      "Before you withdraw or claim, open the protocol's own page and claim only from the link it publishes: never pay to claim, and never follow a claim link from a chat or a search ad. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
      "Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.",
    ];
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  var state = {
    tab: "all",
    query: "",
    category: "",
    chain: "",
    show: "all",
    sortKey: "implied",
    sortDir: -1,
    sandbox: null, // null = published board; otherwise {base, growthWeight, earlyMultiplier}
    dialogSlug: null,
  };

  function activeTune() {
    return state.sandbox || DEFAULT_TUNE;
  }

  function sandboxOn() {
    return state.sandbox !== null;
  }

  function hasFlag(row, flag) {
    return row.flags.indexOf(flag) !== -1;
  }

  function tabCount(tab) {
    if (tab === "all") return DATA.rows.length;
    return DATA.rows.filter(function (r) {
      return hasFlag(r, tab);
    }).length;
  }

  // Rows after every filter, each carrying its displayed value and rank.
  function visibleRows() {
    var tune = activeTune();
    var list = DATA.rows.map(function (r) {
      return { row: r, score: rescore(r, tune) };
    });
    if (sandboxOn()) {
      list.sort(function (a, b) {
        return b.score.implied - a.score.implied;
      });
      list.forEach(function (item, i) {
        item.shownRank = i + 1;
      });
    } else {
      list.forEach(function (item) {
        item.shownRank = item.row.rank;
      });
    }
    var q = state.query.trim().toLowerCase();
    list = list.filter(function (item) {
      var r = item.row;
      if (state.tab !== "all" && !hasFlag(r, state.tab)) return false;
      if (state.show !== "all" && !hasFlag(r, state.show)) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q) {
        var hay = (r.name + " " + (r.category || "") + " " + r.chains.join(" ")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var key = state.sortKey;
    var dir = state.sortDir;
    function numOf(item, k) {
      if (k === "rank") return item.shownRank;
      if (k === "tvl") return item.row.tvl_usd;
      if (k === "growth") return item.row.change_7d;
      if (k === "age") return item.row.age_days;
      return item.score.implied;
    }
    list.sort(function (a, b) {
      var av = numOf(a, key);
      var bv = numOf(b, key);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av === bv) return a.shownRank - b.shownRank;
      return av < bv ? -dir : dir;
    });
    return list;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  var root = document.getElementById("board");

  function distinct(values) {
    var out = [];
    values.forEach(function (v) {
      if (v !== null && v !== undefined && out.indexOf(v) === -1) out.push(v);
    });
    return out.sort();
  }

  function option(value, label) {
    return '<option value="' + esc(value) + '">' + esc(label) + "</option>";
  }

  function buildShell() {
    var categories = distinct(DATA.rows.map(function (r) { return r.category; }));
    var chains = [];
    DATA.rows.forEach(function (r) {
      r.chains.forEach(function (c) {
        if (chains.indexOf(c) === -1) chains.push(c);
      });
    });
    chains.sort();
    var watchCovered = DATA.rows.filter(function (r) { return hasFlag(r, "watchlist"); }).length;

    root.innerHTML =
      '<header class="topbar">' +
        '<div class="brand">Token Radar</div>' +
        '<div class="topmeta">Snapshot ' + esc(DATA.as_of) + " &middot; DefiLlama protocol index &middot; radar-2 model</div>" +
      "</header>" +
      '<section class="hero">' +
        "<h1>Which pre-token protocol is worth farming next?</h1>" +
        '<p class="lede">A radar for token launches that have not happened yet. Every protocol without a token is scored by the same radar-2 model, strongest implied value first. Each row opens a model breakdown and an eight-step farm plan.</p>' +
        '<dl class="stats">' +
          '<div><dt>Watchlist covered</dt><dd>' + watchCovered + " of " + DATA.watchlist_size + "</dd></div>" +
          "<div><dt>Ranked rows</dt><dd>" + DATA.board_size + "</dd></div>" +
          "<div><dt>Early rows below the floor</dt><dd>" + DATA.early_size + "</dd></div>" +
          "<div><dt>Rising fast</dt><dd>" + DATA.rising_size + "</dd></div>" +
          "<div><dt>Live tokens set aside</dt><dd>" + DATA.live_size + "</dd></div>" +
        "</dl>" +
      "</section>" +
      '<section class="filters" aria-label="Filter the board">' +
        '<input id="q" type="search" placeholder="Search a protocol, a category or a chain" aria-label="Search">' +
        '<select id="cat" aria-label="Category">' + option("", "All categories") + categories.map(function (c) { return option(c, c); }).join("") + "</select>" +
        '<select id="chain" aria-label="Chain">' + option("", "All chains") + chains.map(function (c) { return option(c, c); }).join("") + "</select>" +
        '<select id="show" aria-label="Show">' +
          option("all", "All rows") + option("watchlist", "Watchlist only") +
          option("early", "Early only") + option("rising", "Rising only") +
        "</select>" +
        '<div class="tabs" role="group" aria-label="Tabs">' +
          '<button type="button" data-tab="all">All (' + DATA.board_size + ")</button>" +
          '<button type="button" data-tab="watchlist">Watchlist (' + tabCount("watchlist") + ")</button>" +
          '<button type="button" data-tab="early">Early (' + tabCount("early") + ")</button>" +
          '<button type="button" data-tab="rising">Rising (' + tabCount("rising") + ")</button>" +
        "</div>" +
      "</section>" +
      '<section class="rising" id="rising" aria-label="Rising fastest"></section>' +
      '<section class="tablewrap">' +
        '<div class="tablehead">' +
          "<p>Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.</p>" +
          '<p id="rowcount" aria-live="polite"></p>' +
        "</div>" +
        "<table>" +
          "<thead><tr>" +
            '<th data-sort="rank" class="sortable">Rank <span aria-hidden="true">&or;</span></th>' +
            "<th>Protocol</th>" +
            '<th data-sort="tvl" class="sortable num">TVL <span aria-hidden="true">&or;</span></th>' +
            '<th data-sort="growth" class="sortable num">7d <span aria-hidden="true">&or;</span></th>' +
            '<th data-sort="age" class="sortable num">Age <span aria-hidden="true">&or;</span></th>' +
            '<th data-sort="implied" class="sortable num">Implied value <span aria-hidden="true">&or;</span></th>' +
            "<th>Token</th>" +
          "</tr></thead>" +
          '<tbody id="rows"></tbody>' +
        "</table>" +
      "</section>" +
      '<section class="sandbox" id="sandbox">' +
        "<h2>Try the model</h2>" +
        "<p>Move a slider to see how the ranking changes. The published board uses the defaults; nothing here rewrites it.</p>" +
        '<div class="sliders">' +
          '<label>Base multiple <output id="out-base">0.25</output><input id="in-base" type="range" min="0.10" max="0.50" step="0.01" value="0.25"></label>' +
          '<label>Growth weight <output id="out-growth">0.50</output><input id="in-growth" type="range" min="0" max="1" step="0.05" value="0.5"></label>' +
          '<label>Early boost <output id="out-early">1.10</output><input id="in-early" type="range" min="1" max="1.5" step="0.05" value="1.1"></label>' +
        "</div>" +
        '<p class="sandbox-note" id="sandbox-note"></p>' +
        '<button type="button" id="sandbox-reset">Reset the sandbox</button>' +
      "</section>" +
      '<section class="method">' +
        "<h2>How the radar works</h2>" +
        "<p>Implied value = TVL &times; 0.25 &times; growth &times; maturity &times; chain reach &times; early boost. Growth reads the 7-day change, clipped to &minus;60%&hellip;+120% and halved. Maturity rises from 0.6 for a new listing to 1.0 after three years; a protocol with no listing date counts as one year old. Each chain beyond the first adds 4%, up to five extra chains. A protocol younger than a year that grew more than 20% in a week gets a 1.1 boost.</p>" +
        "<p>Bridges, liquid staking and restaking wrappers, exchange-branded products, versioned copies, and anything that already has a token &mdash; a market cap or a ticker &mdash; are set aside instead of ranked. The live-token list below shows what was set aside.</p>" +
        "<p>Implied value is an estimate of what a token launch might be worth, not a price. The farm plan is a starting point: use a fresh wallet, keep positions small, and check the protocol&rsquo;s own pages before you move money.</p>" +
      "</section>" +
      '<section class="live">' +
        "<h2>Set aside &mdash; tokens that already exist</h2>" +
        "<p>These " + DATA.live_size + " already have a token, so they are not ranked. They are listed by market cap, biggest first.</p>" +
        "<table>" +
          "<thead><tr><th>Protocol</th><th>Category</th><th class=\"num\">TVL</th><th class=\"num\">Market cap</th><th class=\"num\">7d</th></tr></thead>" +
          "<tbody>" +
            DATA.live.map(function (p) {
              return (
                "<tr><td><div class=\"pname\">" + esc(p.name) + "</div><div class=\"psub\">" +
                esc(p.chains.join(", ")) + "</div></td><td>" + esc(p.category || "Other") + "</td>" +
                '<td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + "</td>" +
                '<td class="num ' + (p.change_7d === null ? "muted" : p.change_7d >= 0 ? "up" : "down") + '">' + pct(p.change_7d) + "</td></tr>"
              );
            }).join("") +
          "</tbody>" +
        "</table>" +
      "</section>" +
      '<footer class="foot"><p>Estimates, not prices. A high implied value is a starting point for research, not a promise. Always check a protocol&rsquo;s own pages before moving money. Snapshot ' +
        esc(DATA.as_of) + " &middot; DefiLlama protocol index &middot; radar-2 model.</p></footer>" +
      '<div class="overlay" id="overlay" hidden>' +
        '<div class="panel" role="dialog" aria-modal="true" aria-labelledby="dlg-name">' +
          '<button type="button" class="close" id="dlg-close" aria-label="Close">&times;</button>' +
          '<p class="dlgrank" id="dlg-rank"></p>' +
          '<h2 id="dlg-name"></h2>' +
          '<p class="dlgsub" id="dlg-sub"></p>' +
          '<div class="dlgimp"><span>Implied value</span><strong id="dlg-imp"></strong></div>' +
          '<dl class="breakdown" id="dlg-break"></dl>' +
          '<p class="dlgnote" id="dlg-note"></p>' +
          "<h3>Farm plan &mdash; 8 steps</h3>" +
          '<ol class="steps" id="dlg-steps"></ol>' +
        "</div>" +
      "</div>";
  }

  function renderRising() {
    var rising = DATA.rows
      .filter(function (r) { return hasFlag(r, "rising"); })
      .map(function (r) { return { row: r, score: rescore(r, activeTune()) }; })
      .sort(function (a, b) {
        var av = a.row.change_7d === null ? -Infinity : a.row.change_7d;
        var bv = b.row.change_7d === null ? -Infinity : b.row.change_7d;
        return bv - av;
      })
      .slice(0, 4);
    var host = document.getElementById("rising");
    host.innerHTML =
      "<h2>Rising fastest: young, growing, no token yet</h2>" +
      '<div class="cards">' +
      rising.map(function (item) {
        var r = item.row;
        return (
          '<button type="button" class="card" data-slug="' + esc(r.slug) + '">' +
          "<span class=\"cardrank\">Rank " + r.rank + " &middot; " + pct(r.change_7d) + " in 7d</span>" +
          '<span class="cardname">' + esc(r.name) + "</span>" +
          '<span class="cardsub">' + esc(r.category || "Other") + " &middot; " + ageText(r.age_days) + " old &middot; " + esc(r.chains[0]) + "</span>" +
          '<span class="cardimp">' + money(item.score.implied) + " implied</span>" +
          "</button>"
        );
      }).join("") +
      "</div>";
  }

  function renderTable() {
    var list = visibleRows();
    var maxImp = 0;
    list.forEach(function (item) {
      if (item.score.implied > maxImp) maxImp = item.score.implied;
    });
    var body = document.getElementById("rows");
    body.innerHTML = list.map(function (item) {
      var r = item.row;
      var s = item.score;
      var badges = "";
      if (hasFlag(r, "watchlist")) badges += '<span class="badge watch">Watchlist</span>';
      if (hasFlag(r, "rising")) badges += '<span class="badge rise">Rising</span>';
      var growthCls = r.change_7d === null ? "muted" : r.change_7d >= 0 ? "up" : "down";
      var width = maxImp > 0 ? Math.max(2, Math.round((s.implied / maxImp) * 100)) : 0;
      return (
        '<tr data-slug="' + esc(r.slug) + '" tabindex="0">' +
        '<td class="num rank">' + item.shownRank + "</td>" +
        '<td><div class="pname">' + esc(r.name) + '</div><div class="psub">' +
          esc(r.category || "Other") + " on " + esc(r.chains.join(", ")) + "</div></td>" +
        '<td class="num">' + money(r.tvl_usd) + "</td>" +
        '<td class="num ' + growthCls + '">' + pct(r.change_7d) + "</td>" +
        '<td class="num">' + ageText(r.age_days) + "</td>" +
        '<td class="num imp"><div class="impval">' + money(s.implied) + "</div>" +
          '<div class="bar"><span style="width:' + width + '%"></span></div>' +
          (badges ? '<div class="badges">' + badges + "</div>" : "") + "</td>" +
        '<td class="tok"><span aria-hidden="true">&#9679;</span> no token</td>' +
        "</tr>"
      );
    }).join("");
    document.getElementById("rowcount").textContent =
      list.length + (list.length === 1 ? " row shown" : " rows shown") +
      (sandboxOn() ? " — re-ranked by the sandbox" : "");
    if (list.length === 0) {
      body.innerHTML =
        '<tr><td colspan="7" class="muted">No protocol matches these filters.</td></tr>';
    }
    document.querySelectorAll(".tabs button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === state.tab);
      b.setAttribute("aria-pressed", b.getAttribute("data-tab") === state.tab ? "true" : "false");
    });
    document.querySelectorAll("th.sortable").forEach(function (th) {
      th.classList.toggle("sorted", th.getAttribute("data-sort") === state.sortKey);
    });
  }

  // ---------------------------------------------------------------------------
  // Detail dialog
  // ---------------------------------------------------------------------------

  function openDialog(slug) {
    var found = null;
    var shownRank = 0;
    visibleRows().forEach(function (item) {
      if (item.row.slug === slug) {
        found = item;
        shownRank = item.shownRank;
      }
    });
    if (!found) {
      var base = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
      if (!base) return;
      found = { row: base, score: rescore(base, activeTune()), shownRank: base.rank };
      shownRank = base.rank;
    }
    var r = found.row;
    var s = found.score;
    var tune = activeTune();
    state.dialogSlug = slug;

    document.getElementById("dlg-rank").textContent =
      "Rank " + shownRank + " of " + DATA.board_size;
    document.getElementById("dlg-name").textContent = r.name;
    document.getElementById("dlg-sub").textContent =
      (r.category || "Other") + " on " + r.chains.join(", ");
    document.getElementById("dlg-imp").textContent = money(s.implied);

    var growthLine =
      (r.change_7d === null ? "n/a" : pct(r.change_7d)) + " &times; " + s.growth.toFixed(2);
    document.getElementById("dlg-break").innerHTML =
      "<div><dt>TVL</dt><dd>" + money(r.tvl_usd) + " &times; " + tune.base.toFixed(2) + "</dd></div>" +
      "<div><dt>Growth</dt><dd>" + growthLine + "</dd></div>" +
      "<div><dt>Maturity</dt><dd>" + s.maturity.toFixed(2) + " &middot; " + ageText(r.age_days) + " old</dd></div>" +
      "<div><dt>Chains</dt><dd>" + s.chain.toFixed(2) + " &middot; " + r.chains.length + (r.chains.length === 1 ? " chain" : " chains") + "</dd></div>" +
      "<div><dt>Early</dt><dd>&times;" + s.early.toFixed(2) +
        (s.rising ? " &middot; young and growing fast" : " &middot; not early") + "</dd></div>";

    document.getElementById("dlg-note").textContent =
      "Model radar-2: the same function scores every protocol. The page recomputes this row as " +
      money(s.implied) + ", the same number board.json carries. This is an estimate, not a price.";

    document.getElementById("dlg-steps").innerHTML = farmPlan(r)
      .map(function (step) {
        var cut = step.indexOf(" Cost: ");
        var main = cut === -1 ? step : step.slice(0, cut);
        var rest = cut === -1 ? "" : step.slice(cut + 1);
        return (
          "<li><span class=\"step-main\">" + esc(main) + "</span>" +
          (rest ? '<span class="step-cost">' + esc(rest) + "</span>" : "") + "</li>"
        );
      })
      .join("");

    document.getElementById("overlay").hidden = false;
    document.getElementById("dlg-close").focus();
  }

  function closeDialog() {
    state.dialogSlug = null;
    document.getElementById("overlay").hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Sandbox
  // ---------------------------------------------------------------------------

  function readSandbox() {
    var base = parseFloat(document.getElementById("in-base").value);
    var growth = parseFloat(document.getElementById("in-growth").value);
    var early = parseFloat(document.getElementById("in-early").value);
    document.getElementById("out-base").textContent = base.toFixed(2);
    document.getElementById("out-growth").textContent = growth.toFixed(2);
    document.getElementById("out-early").textContent = early.toFixed(2);
    if (
      base === DEFAULT_TUNE.base &&
      growth === DEFAULT_TUNE.growthWeight &&
      early === DEFAULT_TUNE.earlyMultiplier
    ) {
      state.sandbox = null;
      document.getElementById("sandbox-note").textContent = "";
    } else {
      state.sandbox = { base: base, growthWeight: growth, earlyMultiplier: early };
      document.getElementById("sandbox-note").textContent =
        "Showing the board re-ranked with your settings. Reset to return to the published board.";
    }
    renderRising();
    renderTable();
    if (state.dialogSlug) openDialog(state.dialogSlug);
  }

  // ---------------------------------------------------------------------------
  // Deep links: #tab=rising opens a tab, #p=<slug> opens a detail dialog.
  // ---------------------------------------------------------------------------

  function readHash() {
    var h = (window.location.hash || "").replace(/^#/, "");
    var out = { tab: null, slug: null };
    h.split("&").forEach(function (part) {
      var kv = part.split("=");
      if (kv[0] === "tab" && ["all", "watchlist", "early", "rising"].indexOf(kv[1]) !== -1) {
        out.tab = kv[1];
      }
      if (kv[0] === "p") out.slug = decodeURIComponent(kv[1] || "");
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Wire it up
  // ---------------------------------------------------------------------------

  var deepLink = readHash();
  if (deepLink.tab) state.tab = deepLink.tab;
  buildShell();
  renderRising();
  renderTable();
  if (deepLink.slug) openDialog(deepLink.slug);

  document.getElementById("q").addEventListener("input", function (e) {
    state.query = e.target.value;
    renderTable();
  });
  document.getElementById("cat").addEventListener("change", function (e) {
    state.category = e.target.value;
    renderTable();
  });
  document.getElementById("chain").addEventListener("change", function (e) {
    state.chain = e.target.value;
    renderTable();
  });
  document.getElementById("show").addEventListener("change", function (e) {
    state.show = e.target.value;
    renderTable();
  });
  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      state.tab = b.getAttribute("data-tab");
      renderTable();
    });
  });
  document.querySelectorAll("th.sortable").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-sort");
      if (state.sortKey === key) {
        state.sortDir = -state.sortDir;
      } else {
        state.sortKey = key;
        state.sortDir = key === "rank" ? 1 : -1;
      }
      renderTable();
    });
  });
  document.getElementById("rows").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-slug]");
    if (tr) openDialog(tr.getAttribute("data-slug"));
  });
  document.getElementById("rows").addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var tr = e.target.closest("tr[data-slug]");
    if (tr) openDialog(tr.getAttribute("data-slug"));
  });
  document.getElementById("rising").addEventListener("click", function (e) {
    var card = e.target.closest("[data-slug]");
    if (card) openDialog(card.getAttribute("data-slug"));
  });
  document.getElementById("dlg-close").addEventListener("click", closeDialog);
  document.getElementById("overlay").addEventListener("click", function (e) {
    if (e.target === document.getElementById("overlay")) closeDialog();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.dialogSlug) closeDialog();
  });
  ["in-base", "in-growth", "in-early"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", readSandbox);
  });
  document.getElementById("sandbox-reset").addEventListener("click", function () {
    document.getElementById("in-base").value = String(DEFAULT_TUNE.base);
    document.getElementById("in-growth").value = String(DEFAULT_TUNE.growthWeight);
    document.getElementById("in-early").value = String(DEFAULT_TUNE.earlyMultiplier);
    readSandbox();
  });
})();
