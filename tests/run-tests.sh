#!/usr/bin/env bash
# Self-tests for the Claude Test Suite
# Validates that known-good/bad/warning fixtures produce expected results
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUITE_DIR="$(dirname "$SCRIPT_DIR")"
TEST_SUITE="$SUITE_DIR/conform"

RED="\033[31m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
DIM="\033[2m"
RESET="\033[0m"
BOLD="\033[1m"

TOTAL=0
PASSED=0
FAILED=0

pass() {
    TOTAL=$((TOTAL + 1))
    PASSED=$((PASSED + 1))
    printf "${GREEN}✔${RESET} %s\n" "$1"
}

fail() {
    TOTAL=$((TOTAL + 1))
    FAILED=$((FAILED + 1))
    printf "${RED}✘${RESET} %s\n" "$1"
    if [[ -n "${2:-}" ]]; then
        printf "  ${DIM}↳ %s${RESET}\n" "$2"
    fi
}

section() {
    printf "\n${CYAN}${BOLD}▸ %s${RESET}\n" "$1"
}

# Run structural tests on a fixture, capture TAP output
# Pass "with_stderr" as $2 to include stderr in output
run_structural() {
    local fixture="$1"
    if [[ "${2:-}" == "with_stderr" ]]; then
        bash "$TEST_SUITE" structural "$SCRIPT_DIR/$fixture" 2>&1
    else
        bash "$TEST_SUITE" structural "$SCRIPT_DIR/$fixture" 2>/dev/null
    fi
}

# Count verdicts from TAP output
count_verdict() {
    local output="$1"
    local verdict="$2"
    local count=0
    case "$verdict" in
        pass) count=$(echo "$output" | grep -c "^ok " || true) ;;
        fail) count=$(echo "$output" | grep -c "^not ok " || true) ;;
        warn) count=$(echo "$output" | grep -c "# WARN" || true) ;;
        skip) count=$(echo "$output" | grep -c "# SKIP" || true) ;;
    esac
    echo "$count" | tr -d ' '
}

# ── golden-plugin: expect all pass, zero failures ────────────────────
section "golden-plugin (expect: all pass)"

output=$(run_structural "golden-plugin" || true)
fails=$(count_verdict "$output" "fail")
warns=$(count_verdict "$output" "warn")
passes=$(count_verdict "$output" "pass")

if [[ "$fails" -eq 0 ]]; then
    pass "zero failures"
else
    fail "expected 0 failures, got $fails" "$(echo "$output" | grep "^not ok")"
fi

if [[ "$warns" -eq 0 ]]; then
    pass "zero warnings"
else
    fail "expected 0 warnings, got $warns" "$(echo "$output" | grep "# WARN")"
fi

if [[ "$passes" -gt 0 ]]; then
    pass "has passing tests ($passes)"
else
    fail "expected passing tests, got 0"
fi

# ── broken-plugin: expect failures ───────────────────────────────────
section "broken-plugin (expect: failures)"

output=$(run_structural "broken-plugin" || true)
fails=$(count_verdict "$output" "fail")
passes=$(count_verdict "$output" "pass")

if [[ "$fails" -gt 0 ]]; then
    pass "has failures ($fails)"
else
    fail "expected failures, got 0"
fi

# Check specific failures
if echo "$output" | grep -q "not ok.*name.*required\|not ok.*name"; then
    pass "detects missing plugin name"
else
    fail "should detect missing plugin name"
fi

if echo "$output" | grep -q "not ok.*kebab\|not ok.*BadCasing"; then
    pass "detects non-kebab-case skill name"
else
    fail "should detect non-kebab-case skill name"
fi

if echo "$output" | grep -q "not ok.*SKILL.md\|not ok.*skill.md"; then
    pass "detects missing SKILL.md"
else
    fail "should detect missing SKILL.md"
fi

if echo "$output" | grep -q "not ok.*README"; then
    pass "detects README.md in skill folder"
else
    fail "should detect README.md in skill folder"
fi

if echo "$output" | grep -q "not ok.*empty"; then
    pass "detects empty references directory"
else
    fail "should detect empty references directory"
fi

if echo "$output" | grep -q "not ok.*model\|not ok.*tools"; then
    pass "detects agent missing model/tools"
else
    fail "should detect agent missing model or tools"
fi

# ── warning-plugin: expect warnings, no failures ─────────────────────
section "warning-plugin (expect: warnings only)"

output=$(run_structural "warning-plugin" || true)
fails=$(count_verdict "$output" "fail")
warns=$(count_verdict "$output" "warn")
passes=$(count_verdict "$output" "pass")

if [[ "$fails" -eq 0 ]]; then
    pass "zero failures"
else
    fail "expected 0 failures, got $fails" "$(echo "$output" | grep "^not ok")"
fi

if [[ "$warns" -gt 0 ]]; then
    pass "has warnings ($warns)"
else
    fail "expected warnings, got 0"
fi

# Missing version in plugin.json should warn
if echo "$output" | grep -q "has version.*# WARN"; then
    pass "warns about missing plugin version"
else
    fail "should warn about missing plugin version"
fi

# Missing license/metadata in skill should warn
if echo "$output" | grep -q "has license field.*# WARN\|has metadata.*# WARN"; then
    pass "warns about missing skill metadata"
else
    fail "should warn about missing skill metadata"
fi

# ── dot-claude-project: no manifest, validate components only ────────
section "dot-claude-project (expect: pass without manifest)"

output=$(run_structural "dot-claude-project" || true)
fails=$(count_verdict "$output" "fail")
passes=$(count_verdict "$output" "pass")

if [[ "$fails" -eq 0 ]]; then
    pass "zero failures"
else
    fail "expected 0 failures, got $fails" "$(echo "$output" | grep "^not ok")"
fi

if [[ "$passes" -gt 0 ]]; then
    pass "has passing tests ($passes)"
else
    fail "expected passing tests, got 0"
fi

if echo "$output" | grep -q "no .claude-plugin.*validating components only"; then
    pass "shows manifest-free info message"
else
    fail "should show manifest-free info message"
fi

if echo "$output" | grep -q "cmd:review\|cmd:deploy"; then
    pass "validates commands without plugin manifest"
else
    fail "should validate commands without manifest"
fi

if echo "$output" | grep -q "hooks file exists"; then
    pass "validates hooks from settings.json"
else
    fail "should validate hooks from settings.json"
fi

# ── mock-project: .claude/ directory pattern with hooks ──────────────
section "mock-project (expect: pass with .claude/ directory)"

output=$(run_structural "mock-project" || true)
fails=$(count_verdict "$output" "fail")
passes=$(count_verdict "$output" "pass")
warns=$(count_verdict "$output" "warn")

if [[ "$fails" -eq 0 ]]; then
    pass "zero failures"
else
    fail "expected 0 failures, got $fails" "$(echo "$output" | grep "^not ok")"
fi

if [[ "$warns" -eq 0 ]]; then
    pass "zero warnings"
else
    fail "expected 0 warnings, got $warns" "$(echo "$output" | grep "# WARN")"
fi

if [[ "$passes" -gt 0 ]]; then
    pass "has passing tests ($passes)"
else
    fail "expected passing tests, got 0"
fi

if echo "$output" | grep -q ".claude/ project directory"; then
    pass "detects .claude/ project directory"
else
    fail "should detect .claude/ project directory"
fi

if echo "$output" | grep -q "cmd:test\|cmd:lint"; then
    pass "validates commands inside .claude/"
else
    fail "should validate commands inside .claude/"
fi

if echo "$output" | grep -q "hooks file exists"; then
    pass "validates hooks from .claude/settings.json"
else
    fail "should validate hooks from .claude/settings.json"
fi

if echo "$output" | grep -q "hooks structure is valid"; then
    pass "hooks structure passes validation"
else
    fail "hooks structure should pass validation"
fi

# ── component-folder resolution: conform ./skills, ./commands, etc ──
section "component-folder auto-resolution (golden-plugin)"

for component in skills commands agents hooks; do
    component_dir="$SCRIPT_DIR/golden-plugin/$component"
    if [[ ! -d "$component_dir" ]]; then
        continue
    fi

    output=$(run_structural "golden-plugin/$component" with_stderr || true)
    fails=$(count_verdict "$output" "fail")
    passes=$(count_verdict "$output" "pass")

    if [[ "$passes" -gt 0 ]]; then
        pass "conform ./$component → resolves to plugin root ($passes tests)"
    else
        fail "conform ./$component should resolve to plugin root" "got 0 passing tests"
    fi

    if [[ "$fails" -eq 0 ]]; then
        pass "conform ./$component → zero failures"
    else
        fail "conform ./$component → expected 0 failures, got $fails" "$(echo "$output" | grep "^not ok")"
    fi

    # Verify stderr shows the parent-dir hint
    if echo "$output" | grep -q "using parent dir"; then
        pass "conform ./$component → shows parent dir hint"
    else
        fail "conform ./$component → should show parent dir hint"
    fi
done

# Also test dot-claude-project component folders
section "component-folder auto-resolution (dot-claude-project)"

output=$(run_structural "dot-claude-project/commands" with_stderr || true)
fails=$(count_verdict "$output" "fail")
passes=$(count_verdict "$output" "pass")

if [[ "$passes" -gt 0 ]]; then
    pass "conform ./commands (dot-claude) → resolves ($passes tests)"
else
    fail "conform ./commands (dot-claude) should resolve"
fi

if [[ "$fails" -eq 0 ]]; then
    pass "conform ./commands (dot-claude) → zero failures"
else
    fail "conform ./commands (dot-claude) → expected 0 failures, got $fails"
fi

# ── Summary ──────────────────────────────────────────────────────────
printf "\n${DIM}───────────────────────────────────────────────${RESET}\n"
if [[ "$FAILED" -eq 0 ]]; then
    printf "${GREEN}${BOLD}✔ All %d tests passed${RESET}\n" "$TOTAL"
    exit 0
else
    printf "${RED}${BOLD}✘ %d/%d failed${RESET}  ${GREEN}✔ %d passed${RESET}\n" "$FAILED" "$TOTAL" "$PASSED"
    exit 1
fi
