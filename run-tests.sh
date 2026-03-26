#!/usr/bin/env bash
# run-tests.sh — Main test runner for Claude Code plugin validation
#
# Usage:
#   ./run-tests.sh              # Test all plugins
#   ./run-tests.sh <plugin>     # Test a single plugin
#   ./run-tests.sh --help       # Show usage
#
# Based on: "The Complete Guide to Building Skills for Claude" (Anthropic)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source all library modules
for lib_file in "$SCRIPT_DIR"/lib/*.sh; do
    # shellcheck source=/dev/null
    source "$lib_file"
done

# Directories to skip (not plugins)
SKIP_DIRS="conform .claude claude-plugin-marketplace"

is_plugin_dir() {
    local dir="$1"
    [[ -d "$dir/.claude-plugin" ]] || [[ -d "$dir/skills" ]] || [[ -d "$dir/commands" ]] || [[ -d "$dir/agents" ]] || [[ -d "$dir/hooks" ]]
}

usage() {
    cat <<'EOF'
Claude Test Suite
=================

Usage:
  ./run-tests.sh              Test all plugins
  ./run-tests.sh <plugin>     Test a single plugin by name
  ./run-tests.sh --help       Show this help

Tests validate:
  - Plugin manifest (plugin.json)
  - Skills (SKILL.md frontmatter, naming, structure)
  - Commands (frontmatter, required fields)
  - Agents (frontmatter, required fields)
  - Hooks (hooks.json structure, valid events)
  - Cross-plugin integrity (duplicate names)

Exit codes:
  0  All tests passed
  1  One or more tests failed
EOF
    exit 0
}

# Parse arguments
SINGLE_PLUGIN=""
case "${1:-}" in
    --help|-h)
        usage
        ;;
    "")
        # Test all
        ;;
    *)
        SINGLE_PLUGIN="$1"
        if [[ ! -d "$PLUGINS_DIR/$SINGLE_PLUGIN" ]]; then
            echo "Error: Plugin '$SINGLE_PLUGIN' not found at $PLUGINS_DIR/$SINGLE_PLUGIN"
            exit 1
        fi
        ;;
esac

# Header
printf "TAP version 13\n"
printf "# Claude Test Suite\n"
printf "# Plugins dir: %s\n" "$PLUGINS_DIR"
printf "# Date: %s\n" "$(date +%Y-%m-%d\ %H:%M:%S)"
printf "#\n"

# Collect plugins to test
PLUGINS_TO_TEST=()

if [[ -n "$SINGLE_PLUGIN" ]]; then
    PLUGINS_TO_TEST+=("$PLUGINS_DIR/$SINGLE_PLUGIN")
else
    for dir in "$PLUGINS_DIR"/*/; do
        [[ -d "$dir" ]] || continue
        local_name=$(basename "$dir")

        # Skip non-plugin dirs
        skip_it=0
        for skip_name in $SKIP_DIRS; do
            if [[ "$local_name" == "$skip_name" ]]; then
                skip_it=1
                break
            fi
        done
        [[ $skip_it -eq 1 ]] && continue

        # Skip hidden directories
        [[ "$local_name" == .* ]] && continue

        # Must look like a plugin
        if is_plugin_dir "$dir"; then
            PLUGINS_TO_TEST+=("$dir")
        fi
    done
fi

printf "# Testing %d plugin(s)\n\n" "${#PLUGINS_TO_TEST[@]}"

# Run tests for each plugin
for plugin_dir in "${PLUGINS_TO_TEST[@]}"; do
    plugin_name=$(basename "$plugin_dir")
    section "Plugin: $plugin_name"

    test_plugin_manifest "$plugin_dir"
    test_skills "$plugin_dir"
    test_commands "$plugin_dir"
    test_agents "$plugin_dir"
    test_hooks "$plugin_dir"
done

# Cross-plugin checks (only when testing all)
if [[ -z "$SINGLE_PLUGIN" ]]; then
    test_cross_plugin
fi

# Summary
print_summary

# Exit code
exit $HAS_FAILURES
