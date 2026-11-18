#!/usr/bin/env bash
# Publishes the website to GitHub Pages from the public repo "pagesRepo" in site.config.json (the organization
# lockindapp, so the site carries no personal account name; the signed-in GitHub account must be an owner of it).
# With a custom "domain" (lockinhq.app since 2026-10-21) the site is served there through a CNAME file; the old
# <owner>.github.io address then redirects to it. Only the public files go out: pages, styles, assets, icons,
# .well-known and .nojekyll (so GitHub doesn't drop the .well-known folder). tools/, README.md and site.config.json
# stay private. Needs `gh auth login` first. Run from the repo root:  bash website/tools/publish.sh
set -euo pipefail

GH="${GH:-/c/Program Files/GitHub CLI/gh.exe}"
SITE="$(cd "$(dirname "$0")/.." && pwd)"
config() { grep -o "\"$1\": *\"[^\"]*\"" "$SITE/site.config.json" | cut -d'"' -f4; }
DOMAIN="$(config domain)"
REPO="$(config pagesRepo)"
if [ -z "$REPO" ]; then
  case "$DOMAIN" in
    *.github.io) REPO="${DOMAIN%.github.io}/$DOMAIN" ;;
    *) echo "site.config.json needs \"pagesRepo\" (owner/repo) for the custom domain '$DOMAIN'." >&2; exit 1 ;;
  esac
fi

OUT="$(mktemp -d)"
cp "$SITE"/*.html "$SITE"/styles.css "$SITE"/favicon.svg "$SITE"/favicon-32.png "$SITE"/.nojekyll "$OUT"/
cp -r "$SITE"/assets "$SITE"/.well-known "$OUT"/
case "$DOMAIN" in *.github.io) ;; *) echo "$DOMAIN" > "$OUT/CNAME" ;; esac

if ! "$GH" repo view "$REPO" >/dev/null 2>&1; then
  "$GH" repo create "$REPO" --public --description "Lock-In website"
fi

"$GH" auth setup-git
cd "$OUT"
git init -q -b main
git add -A
# Authored as Lock-In with the public support address, not the personal account.
git -c user.name="Lock-In" -c user.email="lockindapp@gmail.com" commit -q -m "Lock-In website $(date -u +%Y-%m-%d)"
git push -q -f "https://github.com/$REPO.git" main
"$GH" api -X POST "repos/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 || true
case "$DOMAIN" in
  *.github.io) ;;
  # GitHub issues the HTTPS certificate once DNS points at Pages; enforce HTTPS after that (a second run does it).
  *) "$GH" api -X PUT "repos/$REPO/pages" -f "cname=$DOMAIN" >/dev/null
     "$GH" api -X PUT "repos/$REPO/pages" -F https_enforced=true >/dev/null 2>&1 \
       || echo "HTTPS not enforced yet (certificate pending): run this script again in ~15-60 minutes." ;;
esac
rm -rf "$OUT"

echo "Pushed to https://github.com/$REPO. The site appears at https://$DOMAIN in a minute or two."
echo "Check: curl -s https://$DOMAIN/.well-known/assetlinks.json"
