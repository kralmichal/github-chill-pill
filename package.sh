#!/bin/sh
# Builds the Chrome Web Store upload zip: dist/github-chill-pill-<version>.zip
set -eu
cd "$(dirname "$0")"
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
mkdir -p dist
out="dist/github-chill-pill-$version.zip"
rm -f "$out"
zip -q -X "$out" manifest.json page-hook.js content.js styles.css LICENSE \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png
echo "$out"
