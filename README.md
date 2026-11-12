<img src="icons/icon128.png" width="96" height="96" alt="">

# GitHub – Chill Pill

> Not failing, just lonely.

Chrome extension (Manifest V3, no dependencies, no build step). When a PR's merge box
says **"Required checks failing"** but no CI check has failed and the PR is really
waiting for a review, the extension changes the header to **"Review required"** /
"At least 1 approving review is required." and turns the red badge yellow (Primer
attention colours, so it works in light and dark themes).

- No permissions, no background worker, no storage. A single content script runs on
  `https://github.com/*` (so GitHub's SPA navigation is covered) and does nothing outside
  `/<owner>/<repo>/pull/<n>`.
- Check states come from the same endpoint GitHub's merge box uses,
  `/{owner}/{repo}/pull/{n}/page_data/status_checks` (same origin, your session). It works
  even when the checks list is collapsed.
- Overrides only when every failing check is a review gate (name contains
  review/approv…, e.g. an n8n status "Review approved by everyone") and the merge box
  says an approval is missing. Any other failing check leaves GitHub's red UI alone.
- React-safe: only the `nodeValue` of the two text nodes changes. Colours are switched
  through `data-ghrr-*` attributes plus `styles.css`.
- Reversible: if a check fails later, the original text and styling come back.

## Installation

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (the one that contains `manifest.json`).
4. Open a PR on github.com.

After you change the code, click ↻ on the extension card and reload the GitHub tab.

## Debugging

Open DevTools on a PR, set the console level to include **Verbose**, and filter by `ghrr`.
Each time the decision changes,
you get a line with the reason (for example `override skipped: failing check(s): "build" (FAILURE)`).

## Publishing to the Chrome Web Store

1. Bump `version` in `manifest.json`.
2. Run `./package.sh`. It creates `dist/github-chill-pill-<version>.zip` with only the files
   the extension needs.
3. Upload the zip in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole).
4. Copy the listing texts, privacy answers and asset paths from [`store/LISTING.md`](store/LISTING.md).
   The privacy policy is in [`PRIVACY.md`](PRIVACY.md).

<img src="store/screenshot-1280x800.png" width="640" alt="Merge box before and after">

## License

[MIT](LICENSE)
