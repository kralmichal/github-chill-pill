# Publishing to the Chrome Web Store

Maintainer notes. Not needed to use the extension.

1. Bump `version` in `../manifest.json`.
2. Run `../package.sh`. It creates `dist/github-chill-pill-<version>.zip` with only the files
   the extension needs.
3. Upload the zip in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole).
4. Fill in the listing from [`LISTING.md`](LISTING.md): texts, privacy answers and asset paths.
   The privacy policy URL points to [`../PRIVACY.md`](../PRIVACY.md).

## Assets in this folder

- `screenshot-1280x800.png`: store screenshot (before / after)
- `promo-440x280.png`: small promo tile
- Store icon: `../icons/icon128.png`
