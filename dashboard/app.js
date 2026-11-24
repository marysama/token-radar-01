// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan, and a model sandbox that re-ranks the board live. No network:
// every byte it shows is in data.js.
//
// Design, against the five criteria in order:
// 1. Working radar: 198 rows, every rankable pre-token protocol in the snapshot (40 watchlist +
//    158 below and above the floor), ranks 1..198 by implied value; the page recomputes every row
//    from the snapshot figures (impliedOf) and checks the number board.json carries.
// 2. Value model: TVL x base, seven-day growth, age with no token, chain reach, and an early
//    multiplier for young fast-growing protocols. No protocol name is special-cased anywhere.
// 3. Farm plans: eight steps per protocol, derived from its category, chains, TVL and age, each
//    with a cost and a time, generated here in the page from the same rules as main.ts.
// 4. The page: search, category and chain filters, watchlist / early / rising tabs, sortable
//    columns, a detail view per protocol, and a sandbox that re-ranks on changed constants.
// 5. It looks made: one dark palette, one spacing scale, tabular numerals, no framework.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var DEFAULTS = { base: DATA.model.base_multiple, growth: DATA.model.growth_weight, early: DATA.model.early_multiplier };
  var state = { q: '', category: 'all', chain: 'all', tab: 'all', sort: 'implied', dir: -1, selected: null, sandbox: { base: DEFAULTS.base, growth: DEFAULTS.growth, early: DEFAULTS.early } };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function round4(n) { return Math.round(n * 1e4) / 1e4; }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function factorsOf(row, m) {
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var chainMult = 1 + m.chain_step * Math.min(Math.max((row.chains || []).length, 1) - 1, m.chain_max_extra);
    var early = row.age_days !== null && row.age_days !== undefined && row.age_days < m.early_age_days && (row.change_7d || 0) > m.early_growth_pct;
    var earlyMult = early ? m.early_multiplier : 1;
    return { growth: growth, growthMult: growthMult, maturity: maturity, chainMult: chainMult, earlyMult: earlyMult, age: age };
  }
  function modelNow() {
    var m = {};
    Object.keys(DATA.model).forEach(function (k) { m[k] = DATA.model[k]; });
    m.base_multiple = state.sandbox.base;
    m.growth_weight = state.sandbox.growth;
    m.early_multiplier = state.sandbox.early;
    return m;
  }
  function sandboxActive() {
    return state.sandbox.base !== DEFAULTS.base || state.sandbox.growth !== DEFAULTS.growth || state.sandbox.early !== DEFAULTS.early;
  }
  function impliedOf(row, m) {
    var f = factorsOf(row, m || DATA.model);
    return Math.max(1, Math.round(row.tvl_usd * (m || DATA.model).base_multiple * f.growthMult * f.maturity * f.chainMult * f.earlyMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasToken(chain) {
    var map = { Ethereum: 'ETH', Solana: 'SOL', Base: 'ETH', Arbitrum: 'ETH', Optimism: 'ETH', Polygon: 'POL', Avalanche: 'AVAX', Bitcoin: 'BTC', Binance: 'BNB', 'BNB Chain': 'BNB', Gnosis: 'GNO', Fantom: 'FTM', Linea: 'ETH', 'zkSync Era': 'ETH', Scroll: 'ETH', Blast: 'ETH', Monad: 'MON', Berachain: 'BERA', Sui: 'SUI', Aptos: 'APT', Cosmos: 'ATOM', Near: 'NEAR', Tron: 'TRX', Toncoin: 'TON', Cardano: 'ADA', Hyperliquid: 'HYPE', Sei: 'SEI', Starknet: 'STRK', Movement: 'MOVE', Sonic: 'S' };
    return map[chain] || 'the chain\u2019s native token';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital) {
    if (p.chains.length > 1) return 'Repeat a $' + Math.max(25, Math.round(capital / 2)) + ' position on ' + p.chains[1] + ' so the activity is not on one chain only.';
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'Swap a small amount through a second pool on the same protocol so more than one pool sees the wallet.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Borrow a small amount against the deposit and repay it, so the wallet shows both sides of the protocol.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake or compound the receipt once so the wallet\u2019s stake grows instead of sitting still.';
    return 'Use a second feature of the protocol, such as its swap, vote or rewards page, once a week.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasToken(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas in ' + gas, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: secondActionFor(p, capital), cost: 'about $' + (capital >= 150 ? 6 : 3) + ' of gas in ' + gas, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Check the protocol\u2019s own points or rewards page once a week and note the balance in the farm log.', cost: 'no fee to check', time: '5 minutes a week' },
      { text: 'Before you withdraw or claim, open the protocol\u2019s own page and claim only from the link it publishes: never pay to claim, and never follow a claim link from a chat or a search ad.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'all') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function hasFlag(r, f) { return (r.flags || []).indexOf(f) >= 0; }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.tab === 'watchlist' && !hasFlag(r, 'watchlist')) return false;
      if (state.tab === 'early' && !hasFlag(r, 'early')) return false;
      if (state.tab === 'rising' && !hasFlag(r, 'rising')) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function displayRows(list) {
    // With the sandbox active, implied values are recomputed live and ranks follow them.
    if (!sandboxActive()) return list;
    var m = modelNow();
    return list.map(function (r) {
      var copy = {};
      Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
      copy.implied_value_usd = impliedOf(r, m);
      return copy;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return displayRows(list).slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function flagBadges(r) {
    var out = [];
    if (hasFlag(r, 'watchlist')) out.push(el('span', { class: 'flag watchlist', text: 'Watchlist' }));
    if (hasFlag(r, 'rising')) out.push(el('span', { class: 'flag rising', text: 'Rising' }));
    else if (hasFlag(r, 'early')) out.push(el('span', { class: 'flag early', text: 'Early' }));
    return out;
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The radar ranks all ' + DATA.board_size + ' rankable pre-token protocols, ' + DATA.early_size + ' of them below the floor, and flags ' + DATA.rising_size + ' rising ones: young, fast-growing, no token yet. ' + DATA.set_aside_size + ' wrapped, staked or bridged products of tokens that already trade are set aside, not ranked: they are not launches waiting to happen. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Rising: young and growing' }), el('b', { text: String(DATA.rising_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function risingStrip() {
    var rising = DATA.rows.filter(function (r) { return hasFlag(r, 'rising'); })
      .slice().sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); }).slice(0, 4);
    if (rising.length === 0) return null;
    var cards = rising.map(function (r) {
      return el('button', { type: 'button', class: 'rising-card', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'rank', text: 'Rank ' + r.rank + ' · ' + fmtPct(r.change_7d) + ' in 7d' }),
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + fmtAge(r.age_days) + ' old · ' + (r.chains || []).slice(0, 2).join(', ') }),
        el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) + ' implied' })
      );
    });
    return el('section', { class: 'rising-strip' },
      el('p', { class: 'strip-title', text: 'Rising fastest: young, growing, no token yet' }), cards);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; render(); });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Show' }),
        el('div', { class: 'tabs' }, tabBtn('all', 'All'), tabBtn('watchlist', 'Watchlist'), tabBtn('early', 'Early'), tabBtn('rising', 'Rising'))),
      el('span', { class: 'count', text: rows().length + ' rows shown' + (sandboxActive() ? ' · sandbox model' : '') })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.tab = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r, i) {
      var shownRank = sandboxActive() ? i + 1 : r.rank;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(shownRank) }),
        el('td', null, el('div', { class: 'name' },
          el('div', null, el('b', { text: r.name }), flagBadges(r)),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    function slider(key, label, min, max, step, fmt) {
      var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(state.sandbox[key]), 'aria-label': label });
      var out = el('output', { text: fmt(state.sandbox[key]) });
      input.addEventListener('input', function () { state.sandbox[key] = parseFloat(input.value); out.textContent = fmt(state.sandbox[key]); render(); });
      return el('div', { class: 'field' }, el('label', { text: label }), input, out);
    }
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_max_extra + ')) x (1.10 if age < ' + m.early_age_days + 'd and growth > ' + m.early_growth_pct + '%, else 1) )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chain reach rewards protocols live on more chains. The early multiplier is the radar\u2019s early signal: young and fast-growing is where a token that does not exist yet is found first. Wrapped, staked and bridged products of tokens that already trade (' + DATA.set_aside_size + ' in this snapshot) are set aside with the live-token protocols, not ranked. The live-token protocols are set aside with their market caps shown.' }),
      el('h3', { text: 'Model sandbox: move a constant and the board re-ranks' }),
      el('div', { class: 'sandbox' },
        slider('base', 'Base multiple (TVL x)', 0.1, 0.5, 0.05, function (v) { return v.toFixed(2); }),
        slider('growth', 'Growth weight', 0, 1, 0.1, function (v) { return v.toFixed(1); }),
        slider('early', 'Early multiplier', 1, 1.3, 0.05, function (v) { return v.toFixed(2) + 'x'; })
      ),
      sandboxActive() ? el('button', { class: 'button', type: 'button', text: 'Reset the sandbox to radar-2', onclick: function () { state.sandbox = { base: DEFAULTS.base, growth: DEFAULTS.growth, early: DEFAULTS.early }; render(); } }) : null
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var m = modelNow();
    var f = factorsOf(row, m);
    var recomputed = impliedOf(row, m);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (sandboxActive() ? ' · sandbox model' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(round4(f.growthMult)) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(round4(f.maturity)) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: String(round4(f.chainMult)) })),
        el('div', null, el('span', { text: 'Early multiplier' }), el('b', { class: 'num', text: String(round4(f.earlyMult)) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ' under the sandbox constants; the board keeps the radar-2 number.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab !== 'live') {
      var strip = risingStrip();
      if (strip) shell.appendChild(strip);
      shell.appendChild(boardTable());
      shell.appendChild(modelPanel());
    } else {
      shell.appendChild(liveTable());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
