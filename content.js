/*
 * Chill Pill for GitHub (not failing, just lonely)
 *
 * When GitHub's merge box says "Required checks failing" although no CI check
 * failed and the PR is really only waiting for a review, relabel it as
 * "Review required" and recolour the red error badge to attention yellow.
 *
 * React safety: no innerHTML, no node replacement. Only the nodeValue of the
 * two leaf text nodes is changed, and colours are switched through data-ghrr-*
 * attributes styled by styles.css. Everything is reverted as soon as the
 * condition stops holding (e.g. a check fails), so real failures stay visible.
 */
(() => {
  'use strict';

  if (window.__ghrrLoaded) return;
  window.__ghrrLoaded = true;

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  const ORIGINAL_HEADING = 'Required checks failing';
  const ORIGINAL_SUBTEXT = 'Fix the failing required checks.';

  const PR_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+/;

  /** Explicit evidence that a review is what's missing. */
  const REVIEW_RE =
    /\breview required\b|\bapproving reviews?\b|\bwaiting on code owner review\b|\bcode owner review required\b|\brequires? (?:an? )?approv|\b[1-9]\d*\s+still\s+required\b|\brequested\s+changes?\b|\bchanges\s+requested\b/i;

  /** Approvals summary: "1 still required" / "1 requested changes". */
  const STILL_REQUIRED_RE = /\b([1-9]\d*)\s+still\s+required\b/i;
  const CHANGES_RE = /\b([1-9]\d*)\s+requested\s+changes?\b|\bchanges\s+requested\b/i;

  /**
   * Name of a failing *status check* that is really a review gate (e.g. an n8n
   * / bot status "Review approved by everyone"). Such a check is reported as
   * failing by GitHub, but it fails only because approvals are missing.
   */
  const REVIEW_GATE_RE = /\b(?:reviews?|reviewed|reviewers?|approv\w*)\b/i;

  /** Summary counters: "1 failing check", "Checks 1 required failing". */
  const FAILING_COUNT_RE = /\b(\d+)\s+(?:required\s+)?failing(?:\s+checks?)?\b/gi;

  /**
   * Evidence of a real CI failure. Deliberately broad: a false positive only
   * means "leave GitHub's original UI alone", which is the safe outcome.
   * Pending / queued / in progress / expected / skipped / neutral never match.
   */
  const FAILURE_TEXT_RES = [
    /\b[1-9]\d*\s+failing\b/i, // "1 failing check", "2 failing, 3 successful checks"
    /\bfailing after\b/i, // check row: "Failing after 42s"
    /\bfail(?:ed|ure)\b/i, // "Failed", "startup failure"
    /\bsome checks were not successful\b/i,
    /\b(?:cancell?ed|timed out|errored)\b/i,
  ];
  const FAILURE_ATTR_RE = /\b(?:fail(?:s|ing|ed|ure)?|error(?:ed)?|cancell?ed|timed out)\b/i;

  /** Known merge box containers (new React UI and classic UI). */
  const MERGEBOX_SELECTOR = [
    '[data-testid="mergebox-partial"]',
    '[data-testid="mergebox"]',
    '#partial-pull-merging',
    '.merge-pr',
    '.js-merge-pr',
  ].join(',');

  /** User-authored content – never treat it as merge box UI. */
  const USER_CONTENT_SELECTOR =
    '.markdown-body, .comment-body, .js-comment-body, textarea, [contenteditable=""], [contenteditable="true"]';

  /** Hitting one of these while walking up means we left the merge box. */
  const STOP_SELECTOR = 'main, [role="main"], #discussion_bucket, .js-discussion, body';

  const MARK_ATTRS = [
    'data-ghrr-override',
    'data-ghrr-fg',
    'data-ghrr-bg',
    'data-ghrr-border',
    'data-ghrr-icon',
    'data-ghrr-icon-hidden',
  ];

  const DEBOUNCE_MS = 150;
  const MAX_WAIT_MS = 1000;
  const MAX_SCAN_ELEMENTS = 400;
  const SENTINEL_COLOR = 'rgb(1, 2, 3)';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /**
   * @type {null | {
   *   heading: Text, headingOriginal: string,
   *   subtext: Text | null, subtextOriginal: string | null,
   *   marked: Set<Element>
   * }}
   */
  let active = null;

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  const xpathLiteral = (s) => (s.includes("'") ? `"${s}"` : `'${s}'`);

  /** Text nodes whose normalised content equals `text`, outside user content. */
  function findTextNodes(text, contextNode) {
    const result = document.evaluate(
      `.//text()[normalize-space()=${xpathLiteral(text)}]`,
      contextNode,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const nodes = [];
    for (let i = 0; i < result.snapshotLength; i++) {
      const node = result.snapshotItem(i);
      const parent = node.parentElement;
      if (parent && !parent.closest(USER_CONTENT_SELECTOR)) nodes.push(node);
    }
    return nodes;
  }

  const isOurText = (node, text) =>
    !!node && node.isConnected && node.nodeValue.trim() === text;

  /** Concatenated text of `root`, skipping the given text nodes. */
  function collectText(root, exclude, excludeEls = []) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (exclude.has(n)) continue;
      if (excludeEls.length && excludeEls.some((el) => el.contains(n))) continue;
      const tag = n.parentElement && n.parentElement.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') continue;
      parts.push(n.nodeValue);
    }
    return parts.join(' ').replace(/\s+/g, ' ');
  }

  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    active.marked.add(el);
  }

  /** Replace `from` with `to` inside a text node, preserving surrounding whitespace. */
  function swapText(node, from, to) {
    if (node.nodeValue.includes(from)) node.nodeValue = node.nodeValue.replace(from, to);
  }

  // ---------------------------------------------------------------------------
  // Locating the merge box pieces
  // ---------------------------------------------------------------------------

  function findHeading() {
    if (active && isOurText(active.heading, active.texts.heading)) return active.heading;
    return findTextNodes(ORIGINAL_HEADING, document.body)[0] || null;
  }

  /** Smallest container that holds the merge box (header + checks + reviews). */
  function findRoot(heading, exclude) {
    const start = heading.parentElement;
    const explicit = start.closest(MERGEBOX_SELECTOR);
    if (explicit) return explicit;

    // Fallback: walk up until the container also mentions the review state,
    // without ever leaving the merge box into the timeline / user content.
    let best = start;
    let node = start;
    for (let i = 0; i < 12; i++) {
      const parent = node.parentElement;
      if (!parent || parent.matches(STOP_SELECTOR) || parent.querySelector(USER_CONTENT_SELECTOR)) break;
      best = node = parent;
      if (REVIEW_RE.test(collectText(parent, exclude))) break;
    }
    return best;
  }

  function findSubtext(root) {
    if (active && isOurText(active.subtext, active.texts.subtext) && root.contains(active.subtext)) {
      return active.subtext;
    }
    return findTextNodes(ORIGINAL_SUBTEXT, root)[0] || null;
  }

  /** The header block: heading + subtext + its status icon. */
  function findHeaderSection(heading, subtext, root) {
    let el = heading.parentElement;
    if (subtext) {
      for (let i = 0; i < 6 && el !== root && !el.contains(subtext); i++) el = el.parentElement;
    }
    let withIcon = el;
    for (let i = 0; i < 3 && withIcon !== root && !withIcon.querySelector('svg'); i++) {
      withIcon = withIcon.parentElement;
    }
    // Never let the "header" grow into the whole merge box.
    return withIcon !== root && withIcon.querySelector('svg') ? withIcon : el;
  }

  function buildContext(heading) {
    const exclude = new Set([heading]);
    if (active && active.subtext) exclude.add(active.subtext);

    const root = findRoot(heading, exclude);
    const subtext = findSubtext(root);
    if (subtext) exclude.add(subtext);
    const header = findHeaderSection(heading, subtext, root);

    return { heading, subtext, root, header, exclude };
  }

  // ---------------------------------------------------------------------------
  // Decision
  // ---------------------------------------------------------------------------

  /** True if the svg is drawn as a red "error" icon (red glyph or on a red badge). */
  function isDangerIcon(svg, palette, stopAt) {
    const cs = getComputedStyle(svg);
    if (palette.fg.has(cs.color) || palette.fg.has(cs.fill)) return true;
    let el = svg.parentElement;
    for (let i = 0; i < 2 && el && el !== stopAt; i++, el = el.parentElement) {
      if (palette.bgEmphasis.has(getComputedStyle(el).backgroundColor)) return true;
    }
    return false;
  }

  /** Smallest ancestor of `svg` that carries text, i.e. the check row. */
  function rowOf(svg, root) {
    const item = svg.closest('li, [role="listitem"], [role="row"], tr');
    if (item && item !== root && root.contains(item)) return item;
    // No list markup: walk up until we hold the check name, not just a
    // screen-reader label like "Failing" next to the icon.
    let el = svg.parentElement;
    for (let i = 0; i < 8 && el && el !== root; i++, el = el.parentElement) {
      if (el.textContent.replace(/\s+/g, ' ').trim().length >= 15) return el;
    }
    return null;
  }

  /**
   * Classify red status icons in the merge box (outside the header).
   * Returns null when a failure is clearly NOT a review gate.
   */
  function findReviewGateRows(ctx) {
    const palette = readDangerPalette();
    const rows = [];
    for (const svg of ctx.root.querySelectorAll('svg')) {
      if (ctx.header.contains(svg) || !isDangerIcon(svg, palette, ctx.root)) continue;
      const row = rowOf(svg, ctx.root);
      if (!row) {
        lastFailure = 'red status icon without a recognisable check row';
        return null;
      }
      const text = row.textContent.replace(/\s+/g, ' ').trim();
      // A row that is too long is probably a whole list, not one check.
      if (text.length > 300 || !REVIEW_GATE_RE.test(text)) {
        lastFailure = `failing check that is not a review gate: "${text.slice(0, 120)}"`;
        return null;
      }
      if (!rows.includes(row)) rows.push(row);
    }
    return rows;
  }

  /** Why hasFailedChecks() said yes – for the console diagnostics. */
  let lastFailure = '';

  const stripCounts = (s, allowed) => {
    let over = false;
    for (const m of s.matchAll(FAILING_COUNT_RE)) if (Number(m[1]) > allowed) over = true;
    return over ? null : s.replace(FAILING_COUNT_RE, ' ');
  };

  function hasFailedChecks(ctx) {
    lastFailure = '';
    // Failing checks that only gate on approvals don't count as CI failures.
    const gateRows = findReviewGateRows(ctx);
    if (gateRows === null) return true;

    // "1 failing check" / "1 required failing" is fine only if every counted
    // failure is one of the review-gate rows we could actually see.
    const text = stripCounts(collectText(ctx.root, ctx.exclude, gateRows), gateRows.length);
    if (text === null) {
      lastFailure = `more failing checks than visible review-gate rows (${gateRows.length})`;
      return true;
    }

    const hit = FAILURE_TEXT_RES.find((re) => re.test(text));
    if (hit) {
      lastFailure = `failure text in merge box: "${(text.match(hit) || [''])[0]}"`;
      return true;
    }

    // Status icons / rows usually expose their state via aria-label or title.
    for (const el of ctx.root.querySelectorAll('[aria-label], [title]')) {
      if (ctx.header.contains(el)) continue; // the header's own red "X" doesn't count
      if (gateRows.some((row) => row.contains(el))) continue;
      const raw = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`;
      const label = stripCounts(raw, gateRows.length);
      if (label === null || FAILURE_ATTR_RE.test(label)) {
        lastFailure = `failure label on <${el.tagName.toLowerCase()}>: "${raw.trim().slice(0, 120)}"`;
        return true;
      }
    }
    return false;
  }

  /**
   * What the header should say, based on the merge box's own review summary.
   * `tone` "attention" recolours the badge yellow; "danger" keeps GitHub's red,
   * because requested changes are a real blocker the author has to act on.
   */
  function describe(text, gateNames) {
    const changes = text.match(CHANGES_RE);
    if (changes) {
      const n = Number(changes[1] || 1);
      return {
        heading: 'Changes requested',
        subtext: `${n} review${n > 1 ? 's' : ''} requesting changes.`,
        tone: 'danger',
      };
    }
    if (REVIEW_RE.test(text)) {
      const n = Number((text.match(STILL_REQUIRED_RE) || [])[1] || 1);
      return {
        heading: 'Review required',
        subtext: n > 1 ? `At least ${n} approving reviews are required.` : 'At least 1 approving review is required.',
        tone: 'attention',
      };
    }
    if (gateNames.length) {
      // Approvals look fine to GitHub, but a review-gate check still waits.
      return {
        heading: 'Review required',
        subtext: `Waiting for ${gateNames.map((n) => `"${n}"`).join(', ')}.`,
        tone: 'attention',
      };
    }
    return null;
  }

  /** Returns {texts} to override, or {reason} for leaving GitHub's UI alone. */
  function decide(ctx, checks) {
    const text = collectText(ctx.root, ctx.exclude);

    if (checks.status === 'ok') {
      // Authoritative data from GitHub's own merge box endpoint.
      const failing = checks.checks.filter((c) => FAIL_STATES.has(c.state));
      const real = failing.filter((c) => !REVIEW_GATE_RE.test(checkName(c)));
      if (real.length) {
        return { reason: `failing check(s): ${real.map((c) => `"${checkName(c)}" (${c.state})`).join(', ')}` };
      }
      // Safety net in case the data is a few seconds behind the UI.
      for (const m of text.matchAll(FAILING_COUNT_RE)) {
        if (Number(m[1]) > failing.length) return { reason: `merge box shows more failing checks than ${failing.length}` };
      }
      const texts = describe(text, failing.map(checkName));
      return texts ? { texts } : { reason: 'no failing check and no review indicator' };
    }

    // Endpoint unavailable: fall back to reading the (expanded) checks list.
    if (hasFailedChecks(ctx)) return { reason: lastFailure || 'failed check detected' };
    const texts = describe(text, []);
    return texts ? { texts } : { reason: 'no "review required" / "changes requested" text in merge box' };
  }

  // ---------------------------------------------------------------------------
  // Status checks from GitHub's page_data endpoint
  // ---------------------------------------------------------------------------

  /** Check states GitHub's merge box itself counts as failures. */
  const FAIL_STATES = new Set(['CANCELLED', 'ERROR', 'FAILURE', 'STALE', 'STARTUP_FAILURE', 'TIMED_OUT']);
  const CHECKS_MAX_AGE_MS = 60_000;
  const CHECKS_MIN_INTERVAL_MS = 3_000;

  const checkName = (c) => String(c.displayName || c.name || c.context || '');

  /** @type {null | {base: string, sig: string, at: number, status: 'pending'|'ok'|'error', checks: any[] | null}} */
  let checksCache = null;

  /**
   * Check data captured from GitHub's own status_checks requests by page-hook.js.
   * Keyed by lower-cased PR base path. Always the freshest data GitHub itself has.
   * @type {Map<string, {status: 'ok', checks: any[], at: number}>}
   */
  const hookedChecks = new Map();

  window.addEventListener('ghrr:status-checks', (event) => {
    try {
      const { base, data } = JSON.parse(event.detail);
      if (typeof base !== 'string' || !data || !Array.isArray(data.statusChecks)) return;
      hookedChecks.set(base.toLowerCase(), { status: 'ok', checks: data.statusChecks, at: Date.now() });
      schedule();
    } catch {
      /* ignore malformed events */
    }
  });
  let checksRetryTimer = null;

  /**
   * Same request GitHub's merge box makes (same origin, user's own session):
   *   GET /{owner}/{repo}/pull/{n}/page_data/status_checks
   * Re-fetched when the merge box text changes or the data is older than 60 s.
   * While a request is in flight the previous result is used.
   */
  function getChecks(ctx) {
    const base = location.pathname.match(PR_PATH)[0];

    // Prefer what GitHub itself fetched most recently.
    const hooked = hookedChecks.get(base.toLowerCase());
    if (hooked) return hooked;

    const sig = collectText(ctx.root, ctx.exclude);
    const now = Date.now();
    const prev = checksCache && checksCache.base === base ? checksCache : null;

    if (prev) {
      if (prev.status === 'pending') return prev.fallback || prev;
      const fresh = prev.sig === sig && now - prev.at < CHECKS_MAX_AGE_MS;
      if (fresh) return prev;
      if (now - prev.at < CHECKS_MIN_INTERVAL_MS) {
        if (!checksRetryTimer) {
          checksRetryTimer = setTimeout(() => {
            checksRetryTimer = null;
            schedule();
          }, CHECKS_MIN_INTERVAL_MS);
        }
        return prev;
      }
    }

    const entry = { base, sig, at: now, status: 'pending', checks: null, fallback: prev && prev.status === 'ok' ? prev : null };
    checksCache = entry;

    fetch(`${base}/page_data/status_checks`, {
      credentials: 'same-origin',
      headers: { 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (!json || !Array.isArray(json.statusChecks)) throw new Error('unexpected response shape');
        entry.checks = json.statusChecks;
        entry.status = 'ok';
      })
      .catch((err) => {
        entry.status = 'error';
        console.debug('[ghrr] status_checks endpoint unavailable, using DOM fallback:', err.message);
      })
      .finally(() => {
        entry.at = Date.now();
        entry.fallback = null;
        if (checksCache === entry) schedule();
      });

    return entry.fallback || entry;
  }

  // ---------------------------------------------------------------------------
  // Colours
  // ---------------------------------------------------------------------------

  /** Resolve the current theme's danger colours to computed rgb() strings. */
  function readDangerPalette() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);

    const resolve = (vars) => {
      const out = new Set();
      for (const v of vars) {
        probe.style.color = `var(${v}, ${SENTINEL_COLOR})`;
        const c = getComputedStyle(probe).color;
        if (c && c !== SENTINEL_COLOR) out.add(c);
      }
      return out;
    };

    const palette = {
      fg: resolve(['--fgColor-danger', '--color-danger-fg']),
      bgEmphasis: resolve(['--bgColor-danger-emphasis', '--color-danger-emphasis']),
      bgMuted: resolve(['--bgColor-danger-muted', '--color-danger-subtle']),
      borderEmphasis: resolve(['--borderColor-danger-emphasis', '--color-danger-emphasis', '--fgColor-danger']),
      borderMuted: resolve(['--borderColor-danger-muted', '--color-danger-muted']),
    };
    probe.remove();
    return palette;
  }

  function dangerBorder(cs, palette) {
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (cs[`border${side}Style`] === 'none' || parseFloat(cs[`border${side}Width`]) <= 0) continue;
      const color = cs[`border${side}Color`];
      if (palette.borderEmphasis.has(color)) return 'emphasis';
      if (palette.borderMuted.has(color)) return 'muted';
    }
    return null;
  }

  /** Elements whose red styling belongs to the misleading status (and nothing else). */
  function colourCandidates(ctx) {
    const list = [ctx.header, ...ctx.header.querySelectorAll('*')];

    // Ancestors up to the merge box root: red outlines / backgrounds on the box.
    for (let el = ctx.header.parentElement; el; el = el.parentElement) {
      list.push(el);
      if (el === ctx.root) break;
    }

    // The round timeline badge rendered next to the box (a sibling of the root).
    const parent = ctx.root.parentElement;
    if (parent) {
      for (const sib of parent.children) {
        if (sib === ctx.root || !sib.querySelector('svg')) continue;
        const rect = sib.getBoundingClientRect();
        if (rect.width > 0 && rect.width <= 64 && rect.height <= 64) list.push(sib, ...sib.querySelectorAll('*'));
      }
    }
    return list.slice(0, MAX_SCAN_ELEMENTS);
  }

  function applyColours(ctx) {
    const palette = readDangerPalette();
    const candidates = colourCandidates(ctx);

    // 1) Read everything first: marking changes computed styles.
    const plan = [];
    for (const el of candidates) {
      if (active.marked.has(el)) continue; // already handled in an earlier pass
      const cs = getComputedStyle(el);
      const isSvg = el instanceof SVGElement;
      const entry = {
        el,
        fg: palette.fg.has(cs.color) || (isSvg && palette.fg.has(cs.fill)),
        bg: palette.bgEmphasis.has(cs.backgroundColor)
          ? 'emphasis'
          : palette.bgMuted.has(cs.backgroundColor)
            ? 'muted'
            : null,
        border: dangerBorder(cs, palette),
      };
      if (entry.fg || entry.bg || entry.border) plan.push(entry);
    }

    const svgs = candidates.filter(
      (el) => el instanceof SVGSVGElement && !el.hasAttribute('data-ghrr-icon-hidden'),
    );
    const iconPlan = [];
    for (const svg of svgs) {
      const wrapper = svg.parentElement;
      if (!wrapper || wrapper === ctx.root || wrapper.children.length !== 1 || wrapper.textContent.trim()) continue;
      const cs = getComputedStyle(svg);
      const isDangerGlyph = palette.fg.has(cs.color) || palette.fg.has(cs.fill);
      const onBadge = (() => {
        for (let el = wrapper; el && el !== ctx.root; el = el.parentElement) {
          if (palette.bgEmphasis.has(getComputedStyle(el).backgroundColor)) return true;
          if (el === ctx.header) break;
        }
        return false;
      })();
      if (!isDangerGlyph && !onBadge) continue; // not the error icon
      const size = Math.round(svg.getBoundingClientRect().width) || 16;
      iconPlan.push({ svg, wrapper, variant: isDangerGlyph ? 'glyph' : 'on-emphasis', size });
    }

    // 2) Write.
    for (const { el, fg, bg, border } of plan) {
      if (fg) setAttr(el, 'data-ghrr-fg', '');
      if (bg) setAttr(el, 'data-ghrr-bg', bg);
      if (border) setAttr(el, 'data-ghrr-border', border);
    }
    for (const { svg, wrapper, variant, size } of iconPlan) {
      setAttr(svg, 'data-ghrr-icon-hidden', '');
      setAttr(wrapper, 'data-ghrr-icon', variant);
      const value = `${size}px`;
      if (wrapper.style.getPropertyValue('--ghrr-icon-size') !== value) {
        wrapper.style.setProperty('--ghrr-icon-size', value);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Apply / revert
  // ---------------------------------------------------------------------------

  const sameTexts = (a, b) => a.heading === b.heading && a.subtext === b.subtext && a.tone === b.tone;

  function apply(ctx, texts) {
    if (active && (active.heading !== ctx.heading || !sameTexts(active.texts, texts))) revert();
    if (!active) {
      active = {
        texts,
        heading: ctx.heading,
        headingOriginal: ctx.heading.nodeValue,
        subtext: null,
        subtextOriginal: null,
        marked: new Set(),
        favicons: new Map(),
      };
    }

    if (ctx.heading.nodeValue.trim() === ORIGINAL_HEADING) {
      active.headingOriginal = ctx.heading.nodeValue;
      swapText(ctx.heading, ORIGINAL_HEADING, texts.heading);
    }

    if (ctx.subtext) {
      if (ctx.subtext !== active.subtext) {
        restoreSubtext();
        active.subtext = ctx.subtext;
        active.subtextOriginal = ctx.subtext.nodeValue;
      }
      if (ctx.subtext.nodeValue.trim() === ORIGINAL_SUBTEXT) {
        active.subtextOriginal = ctx.subtext.nodeValue;
        swapText(ctx.subtext, ORIGINAL_SUBTEXT, texts.subtext);
      }
    }

    // Forget marks on nodes React has since removed.
    for (const el of active.marked) if (!el.isConnected) active.marked.delete(el);

    setAttr(ctx.header, 'data-ghrr-override', texts.tone === 'danger' ? 'changes-requested' : 'review-required');
    if (texts.tone === 'attention') applyColours(ctx);
    swapFavicons();
  }

  function restoreSubtext() {
    if (active && isOurText(active.subtext, active.texts.subtext)) {
      active.subtext.nodeValue = active.subtextOriginal;
    }
  }

  /**
   * GitHub shows the PR's check state in the tab favicon
   * (<link class="js-site-favicon" href=".../favicon-failure[-dark].svg|png">).
   * Show GitHub's own "pending" (yellow) favicon instead of "failure".
   */
  function swapFavicons() {
    for (const link of document.querySelectorAll('link.js-site-favicon')) {
      const href = link.getAttribute('href') || '';
      if (!href.includes('/favicon-failure')) continue;
      const ours = href.replace('/favicon-failure', '/favicon-pending');
      active.favicons.set(link, { original: href, ours });
      link.setAttribute('href', ours);
    }
  }

  function restoreFavicons() {
    for (const [link, { original, ours }] of active.favicons) {
      // Only undo our own change; if GitHub has set a new favicon since, keep it.
      if (link.isConnected && link.getAttribute('href') === ours) link.setAttribute('href', original);
    }
  }

  function revert() {
    if (!active) return;
    restoreFavicons();
    if (isOurText(active.heading, active.texts.heading)) active.heading.nodeValue = active.headingOriginal;
    restoreSubtext();
    for (const el of active.marked) {
      for (const attr of MARK_ATTRS) el.removeAttribute(attr);
      if (el instanceof HTMLElement || el instanceof SVGElement) el.style.removeProperty('--ghrr-icon-size');
    }
    active = null;
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------

  let lastLog = '';
  /** Logs to the DevTools console, but only when the decision changes. */
  function report(msg, root) {
    if (msg === lastLog) return;
    lastLog = msg;
    console.debug(`[ghrr] ${msg}`, root || '');
  }

  function evaluate() {
    if (!document.body || !PR_PATH.test(location.pathname)) return revert();

    const heading = findHeading();
    if (!heading) {
      report('no "Required checks failing" heading on this page');
      return revert();
    }

    const ctx = buildContext(heading);
    const checks = getChecks(ctx);
    if (checks.status === 'pending') return; // first load: wait for data, change nothing

    const { texts, reason } = decide(ctx, checks);
    if (texts) {
      report(`override ACTIVE: "${texts.heading}" / "${texts.subtext}"`, ctx.root);
      apply(ctx, texts);
    } else {
      report(`override skipped: ${reason}`, ctx.root);
      revert();
    }
  }

  let timer = null;
  let firstQueuedAt = 0;

  /** Debounce with a max wait so a constantly-mutating page still gets updates. */
  function schedule() {
    const now = performance.now();
    if (timer === null) firstQueuedAt = now;
    else clearTimeout(timer);
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, firstQueuedAt + MAX_WAIT_MS - now));
    timer = setTimeout(run, wait);
  }

  function run() {
    timer = null;
    try {
      evaluate();
    } catch (err) {
      // Never break the page; fall back to GitHub's original UI.
      try {
        revert();
      } catch (_) {
        active = null;
      }
      console.debug('[ghrr] merge box override failed:', err);
    } finally {
      // Drop the mutation records caused by our own writes so we don't loop.
      observer.takeRecords();
    }
  }

  const observer = new MutationObserver(schedule);
  // Observe <html>, not <body>: Turbo swaps the whole <body> on navigation.
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  // GitHub swaps the status favicon by changing href on the existing <link>.
  if (document.head) observer.observe(document.head, { attributes: true, subtree: true, attributeFilter: ['href'] });

  for (const type of ['turbo:load', 'turbo:render', 'turbo:frame-load', 'pjax:end', 'popstate', 'pageshow']) {
    window.addEventListener(type, schedule);
    document.addEventListener(type, schedule);
  }
  if (window.navigation) window.navigation.addEventListener('navigatesuccess', schedule);

  // page-hook.js may have seen GitHub's first request before this script loaded.
  window.dispatchEvent(new CustomEvent('ghrr:replay'));
  schedule();
})();
