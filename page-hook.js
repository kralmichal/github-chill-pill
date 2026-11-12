/*
 * Chill Pill for GitHub – page hook (runs in the page's MAIN world)
 *
 * GitHub's merge box refreshes check states by fetching
 *   /{owner}/{repo}/pull/{n}/page_data/status_checks
 * whenever something changes in the background (live "alive" channel updates).
 * This hook wraps window.fetch, reads a *clone* of those responses (the original
 * response is passed through untouched) and hands the JSON to content.js
 * (isolated world) via a CustomEvent with a string payload.
 *
 * It sends nothing anywhere else and does not alter any request or response.
 */
(() => {
  'use strict';

  if (window.__ghrrHook) return;
  window.__ghrrHook = true;

  const EVENT = 'ghrr:status-checks';
  const REPLAY = 'ghrr:replay';
  const URL_RE = /^(\/[^/]+\/[^/]+\/pull\/\d+)\/page_data\/status_checks\/?$/;

  /** Latest payload per PR, replayed when content.js starts after GitHub's first fetch. */
  const latest = new Map();

  const publish = (base, data) => {
    const detail = JSON.stringify({ base, data });
    latest.set(base, detail);
    window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  };

  window.addEventListener(REPLAY, () => {
    for (const detail of latest.values()) window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  });

  const nativeFetch = window.fetch;
  if (typeof nativeFetch !== 'function') return;

  function matchBase(input) {
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
      if (!raw) return null;
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin) return null;
      const m = url.pathname.match(URL_RE);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  const wrapped = function fetch(input, init) {
    const promise = nativeFetch.apply(this, arguments);
    const base = matchBase(input);
    if (base) {
      promise
        .then((res) => (res && res.ok ? res.clone().json() : null))
        .then((data) => {
          if (data && Array.isArray(data.statusChecks)) publish(base, data);
        })
        .catch(() => {});
    }
    return promise;
  };

  window.fetch = wrapped;
})();
