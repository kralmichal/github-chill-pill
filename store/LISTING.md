# Chrome Web Store listing

Copy-paste texts for the Chrome Web Store developer dashboard.

## Name
Chill Pill for GitHub

## Summary (max 132 characters)
Not failing, just lonely. Shows "Review required" instead of a fake "Required checks failing" when a PR only needs a review.

## Category
Developer Tools

## Language
English

## Description
Not failing, just lonely.

When a repository uses rulesets, GitHub's pull request merge box sometimes shows a red
"Required checks failing" / "Fix the failing required checks." even though no CI job
failed. The only thing blocking the merge is a missing approval, often reported through a
review-gate status check such as "Review approved by everyone".

Chill Pill notices this and calms the merge box down:

• The heading says what really blocks the merge: "Review required" (approvals missing) or "Changes requested" (a reviewer asked for changes).
• The red error badge turns into GitHub's yellow attention style, in light and dark themes.
• The tab favicon shows GitHub's yellow "pending" icon instead of the red "failed" one.
• If a real CI check fails, the original red state comes back straight away. Real failures are never hidden.

How it works
• It reads a copy of the check data GitHub's merge box loads, so it reacts to background updates straight away and works even when the checks list is collapsed. GitHub's requests are never modified.
• It overrides only when every failing check is a review gate and the merge box reports a missing approval.
• It is React-safe: it changes only text and adds CSS attributes, and never rebuilds GitHub's UI.

Privacy
• No data collection, analytics or tracking. No storage. No remote code.
• No extension permissions. It is a single content script on github.com.

Open source (MIT): https://github.com/kralmichal/github-chill-pill

## Single purpose
Relabels GitHub's misleading "Required checks failing" merge box state as "Review required"
when a pull request is blocked only by a missing review.

## Permission justification
Host access (content script on https://github.com/*): the extension reads and adjusts the
pull request merge box on github.com and requests the pull request's check states from
github.com. It requests no other permissions.

## Remote code
No. All code is bundled in the extension package.

## Data usage
The extension does not collect or use any user data. Tick no data categories.
Certify: it does not sell or transfer user data, does not use it for unrelated purposes,
and does not use it for creditworthiness or lending.

## Privacy policy URL
https://github.com/kralmichal/github-chill-pill/blob/main/PRIVACY.md

## Homepage / support URL
https://github.com/kralmichal/github-chill-pill

## Assets
- Store icon 128×128: `icons/icon128.png`
- Screenshot 1280×800: `store/screenshot-1280x800.png`
- Small promo tile 440×280: `store/promo-440x280.png`
