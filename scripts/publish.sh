#!/usr/bin/env bash
# usage: publish.sh <dir-with-files> ; commits the files to the orphan branch `news-data`
set -euo pipefail
SRC="$1"
MODE="${2:-full}"
PUB=$(mktemp -d)
URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
if git clone -q --depth 1 --branch news-data "$URL" "$PUB" 2>/dev/null; then :; else
  git init -q "$PUB"; git -C "$PUB" checkout -q -b news-data; git -C "$PUB" remote add origin "$URL"
fi
if [ "$MODE" = "probe" ]; then rm -rf "$PUB/probe"; mkdir -p "$PUB/probe"; cp -r "$SRC"/. "$PUB/probe"/; else rm -rf "$PUB/samples" "$PUB/probe"; cp -r "$SRC"/. "$PUB"/; fi
cd "$PUB"
git config user.name "arcus-news-bot"; git config user.email "bot@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then echo "no changes"; exit 0; fi
git commit -q -m "news data $(date -u +%FT%TZ)"
git push -q origin news-data
