#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_DIR="$SCRIPT_DIR/../pi-patches/pi-tui"
PATCH_FILE="$PATCH_DIR/pi-tui-tmux.patch"
PLACEHOLDER_SRC="$PATCH_DIR/dist/placeholder-diacritics.js"

if [[ ! -f "$PATCH_FILE" ]]; then
  echo "Patch file missing: $PATCH_FILE" >&2
  exit 1
fi
if [[ ! -f "$PLACEHOLDER_SRC" ]]; then
  echo "Placeholder diacritics file missing: $PLACEHOLDER_SRC" >&2
  exit 1
fi

find_pi_package_root() {
  local install_root="$1"
  local scope

  for scope in @earendil-works @mariozechner; do
    local candidate="$install_root/lib/node_modules/$scope/pi-coding-agent"
    if [[ -d "$candidate" && -f "$candidate/package.json" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

resolve_pi_root() {
  local arg="${1:-}"
  local base="$HOME/.local/share/mise/installs/npm-mariozechner-pi-coding-agent"

  if [[ -n "$arg" ]]; then
    if [[ -d "$arg" && -f "$arg/package.json" ]]; then
      echo "$arg"
      return
    fi

    if [[ -d "$arg" ]]; then
      local from_path
      if from_path="$(find_pi_package_root "$arg")"; then
        echo "$from_path"
        return
      fi
    fi

    local by_version
    if by_version="$(find_pi_package_root "$base/$arg")"; then
      echo "$by_version"
      return
    fi

    echo "Could not resolve pi install from argument: $arg" >&2
    exit 1
  fi

  if [[ ! -d "$base" ]]; then
    echo "No pi installs found under: $base" >&2
    exit 1
  fi

  local latest
  latest="$(find "$base" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)"
  if [[ -z "$latest" ]]; then
    echo "No pi installs found under: $base" >&2
    exit 1
  fi

  local root
  if ! root="$(find_pi_package_root "$latest")"; then
    echo "Install found but pi package path missing under: $latest/lib/node_modules/{@earendil-works,@mariozechner}/pi-coding-agent" >&2
    exit 1
  fi

  echo "$root"
}

resolve_tui_dist() {
  local pi_root="$1"
  local scope

  for scope in @earendil-works @mariozechner; do
    local candidate="$pi_root/node_modules/$scope/pi-tui/dist"
    if [[ -d "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

PI_ROOT="$(resolve_pi_root "${1:-}")"
if ! TUI_DIST="$(resolve_tui_dist "$PI_ROOT")"; then
  echo "Target pi-tui dist directory not found under: $PI_ROOT/node_modules/{@earendil-works,@mariozechner}/pi-tui/dist" >&2
  exit 1
fi

# Dry-run first
echo "Checking patch against: $TUI_DIST"
if ! (cd "$TUI_DIST" && patch --dry-run --forward -p1 < "$PATCH_FILE") >/dev/null 2>&1; then
  echo ""
  echo "Patch does not apply cleanly. Checking if already applied..."
  if (cd "$TUI_DIST" && patch --dry-run -R --force -p1 < "$PATCH_FILE") >/dev/null 2>&1; then
    echo "Patch is already applied."
    exit 0
  fi
  echo ""
  echo "Patch failed (may need regenerating for this pi version):" >&2
  (cd "$TUI_DIST" && patch --dry-run -p1 < "$PATCH_FILE") || true
  exit 1
fi

# Backup
version=""
if [[ "$PI_ROOT" =~ /npm-mariozechner-pi-coding-agent/([^/]+)/ ]]; then
  version="${BASH_REMATCH[1]}"
else
  version="$(basename "$PI_ROOT")"
fi
version="${version//\//_}"
stamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="$SCRIPT_DIR/../pi-patches/backups/pi-tui-${version}-${stamp}"
mkdir -p "$backup_dir/components"

cp "$TUI_DIST/terminal-image.js" "$backup_dir/terminal-image.js"
cp "$TUI_DIST/components/image.js" "$backup_dir/components/image.js"
cp "$TUI_DIST/placeholder-diacritics.js" "$backup_dir/placeholder-diacritics.js" 2>/dev/null || true

# Apply patch
(cd "$TUI_DIST" && patch --forward -p1 < "$PATCH_FILE")

# Copy new file (not in patch since it's a new file)
cp "$PLACEHOLDER_SRC" "$TUI_DIST/placeholder-diacritics.js"

# Verify
if ! grep -q "wrapTmuxPassthrough" "$TUI_DIST/terminal-image.js"; then
  echo "Patch verification failed for terminal-image.js" >&2
  exit 1
fi
if ! grep -q "placeholderLines" "$TUI_DIST/components/image.js"; then
  echo "Patch verification failed for components/image.js" >&2
  exit 1
fi

echo ""
echo "Patched: $TUI_DIST"
echo "Backup:  $backup_dir"
echo "Restart pi sessions to load patched code."
