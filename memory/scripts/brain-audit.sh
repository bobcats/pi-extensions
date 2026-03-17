#!/usr/bin/env bash
set -uo pipefail

VAULT="${1:-$HOME/.pi/memories}"

if [[ ! -d "$VAULT" ]]; then
  echo "Vault not found: $VAULT" >&2
  exit 1
fi

cd "$VAULT"

# --- File census ---
total=$(find . -name '*.md' -not -name 'dream-journal.md' -not -name 'memory-operations.jsonl' | wc -l | tr -d ' ')
principles=$(find ./principles -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
projects=$(find ./projects -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
root=$(find . -maxdepth 1 -name '*.md' -not -name 'dream-journal.md' | wc -l | tr -d ' ')

echo "=== Vault Census ==="
echo "Total: $total files ($principles principles, $projects project, $root root)"

# --- File sizes ---
echo ""
echo "=== File Sizes (top 10) ==="
find . -name '*.md' -not -name 'dream-journal.md' -not -name 'memory-operations.jsonl' -exec wc -l {} + 2>/dev/null \
  | grep -v ' total$' \
  | sort -rn \
  | head -10 \
  | while read lines path; do
    flag=""
    if [[ "$path" == *index.md ]] && (( lines > 200 )); then flag=" ⚠️  OVER LIMIT (200)"; fi
    if [[ "$path" != *index.md ]] && (( lines > 500 )); then flag=" ⚠️  OVER LIMIT (500)"; fi
    if [[ "$path" != *index.md ]] && (( lines > 400 )); then flag="${flag:- ⚡ approaching limit}"; fi
    printf "%4d %s%s\n" "$lines" "$path" "$flag"
  done

# --- Broken wikilinks ---
echo ""
echo "=== Broken Wikilinks ==="
broken=0
while IFS= read -r link; do
  [[ "$link" == "..." ]] && continue
  file="${link}.md"
  if [[ ! -f "$file" ]]; then
    echo "  BROKEN: [[$link]] -> $file"
    ((broken++)) || true
  fi
done < <(grep -roh '\[\[[^]]*\]\]' --include='*.md' . | sed 's/\[\[//;s/\]\]//' | sort -u)
if (( broken == 0 )); then echo "  None"; fi

# --- Orphan files ---
echo ""
echo "=== Orphan Files (not in any index) ==="
orphans=0
while IFS= read -r file; do
  slug=$(echo "$file" | sed 's|^\./||; s|\.md$||')
  if ! grep -rq "\[\[$slug\]\]" --include='*.md' . 2>/dev/null; then
    echo "  ORPHAN: $file"
    ((orphans++)) || true
  fi
done < <(find . -name '*.md' \
  -not -name 'index.md' \
  -not -name 'dream-journal.md' \
  -not -name 'memory-operations.jsonl' \
  -not -path '*/index.md' \
  | sort)
if (( orphans == 0 )); then echo "  None"; fi

# --- Principle connectivity ---
echo ""
echo "=== Principle Connectivity ==="
conn_tmp=$(mktemp)
for f in ./principles/*.md; do
  [[ "$(basename "$f")" == "index.md" ]] && continue
  name=$(basename "$f" .md)
  matches=$(grep -rl "principles/$name" --include='*.md' . 2>/dev/null \
    | grep -v "index.md" \
    | grep -v "dream-journal.md" \
    | grep -v "$f" || true)
  if [[ -z "$matches" ]]; then
    count=0
  else
    count=$(echo "$matches" | wc -l | tr -d ' ')
  fi
  echo "$count $name" >> "$conn_tmp"
done

echo "  Hub:"
sort -rn "$conn_tmp" | head -6 | while read -r c n; do
  printf "    %2d  %s\n" "$c" "$n"
done
echo "  Low:"
sort -n "$conn_tmp" | while read -r c n; do
  [[ -z "$n" ]] && continue
  (( c <= 1 )) && printf "    %2d  %s\n" "$c" "$n"
done
rm -f "$conn_tmp"

echo ""
echo "=== Summary ==="
echo "Files: $total | Broken links: $broken | Orphans: $orphans"
