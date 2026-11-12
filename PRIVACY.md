# Privacy Policy – GitHub – Chill Pill

_Last updated: 2026-11-12_

GitHub – Chill Pill does not collect, store, sell or transmit any personal data.

## What the extension does

- It runs only on `https://github.com/*` and acts only on pull request pages
  (`/<owner>/<repo>/pull/<number>`).
- To find out whether a pull request is blocked by a failing CI check or only by a missing
  review, it sends one request to GitHub itself:
  `https://github.com/<owner>/<repo>/pull/<number>/page_data/status_checks`. This is the same
  request GitHub's own merge box makes. It goes to github.com only and uses your existing
  GitHub session.
- The response (check names and states) is processed in memory in your browser tab and
  thrown away when you leave the page.

## What the extension does not do

- It sends no data to the developer or to any third party.
- It uses no analytics, tracking, cookies of its own, `chrome.storage`, `localStorage` or
  remote code.
- It requests no extension permissions beyond running a content script on github.com.

## Contact

Questions or issues: https://github.com/kralmichal/github-chill-pill/issues
