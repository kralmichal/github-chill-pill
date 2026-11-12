<img src="icons/icon128.png" width="96" height="96" alt="">

# Chill Pill for GitHub

> Not failing, just lonely.

Chrome extension (Manifest V3, no dependencies, no build step). When a PR's merge box
says **"Required checks failing"** but no CI check has failed and the PR is really
waiting for a review, the extension changes the header to **"Review required"** /
"At least 1 approving review is required." and turns the red badge yellow (Primer
attention colours, so it works in light and dark themes).

<img src="store/screenshot-1280x800.png" width="640" alt="Merge box before and after">

- No permissions, no background worker, no storage. A single content script runs on
  `https://github.com/*` (so GitHub's SPA navigation is covered) and does nothing outside
  `/<owner>/<repo>/pull/<n>`.
- Check states come from the same endpoint GitHub's merge box uses,
  `/{owner}/{repo}/pull/{n}/page_data/status_checks` (same origin, your session). It works
  even when the checks list is collapsed.
- Overrides only when every failing check is a review gate (name contains
  review/approv…, e.g. an n8n status "Review approved by everyone") and the merge box
  says an approval is missing. Any other failing check leaves GitHub's red UI alone.
- The tab favicon switches from GitHub's red "failure" icon to its yellow "pending" one
  while the override is active.
- React-safe: only the `nodeValue` of the two text nodes changes. Colours are switched
  through `data-ghrr-*` attributes plus `styles.css`.
- Reversible: if a check fails later, the original text and styling come back.

## Installation (from source)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (the one that contains `manifest.json`).
4. Open a PR on github.com.

After you change the code, click ↻ on the extension card and reload the GitHub tab.

## Debugging

Open DevTools on a PR, set the console level to include **Verbose**, and filter by `ghrr`.
Each time the decision changes, you get a line with the reason (for example `override skipped: failing check(s): "build" (FAILURE)`).

## Privacy

No data collection, no tracking, no storage. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
