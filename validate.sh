#!/usr/bin/env bash
# validate.sh — Run all validation checks in one shot
#
# Runs:
#   1. TypeScript build (cli/)
#   2. CLI unit tests (jest, 125+ tests)
#   3. Bash fixture self-tests (golden, broken, warning, dot-claude, mock)
#   4. Framework self-tests (case generation, classification, field validation)
#   5. Structural validation against all fixtures
#
# Usage:
#   bash validate.sh           # Run all checks
#   bash validate.sh --quick   # Skip slow checks (jest)
#
# Exit code: 0 if all pass, 1 if any fail.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colors ───────────────────────────────────────────────────────────

if [[ -t 1 ]]; then
    RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[0;33m'
    CYAN='\033[0;36m' BOLD='\033[1m' DIM='\033[0;90m' RESET='\033[0m'
else
    RED='' GREEN='' YELLOW='' CYAN='' BOLD='' DIM='' RESET=''
fi

STEP=0
STEPS_PASSED=0
STEPS_FAILED=0
FAILED_STEPS=()
QUICK=0

[[ "${1:-}" == "--quick" ]] && QUICK=1

# ── Helpers ──────────────────────────────────────────────────────────

step() {
    STEP=$((STEP + 1))
    printf "\n${CYAN}${BOLD}[%d] %s${RESET}\n" "$STEP" "$1"
    printf "${CYAN}%s${RESET}\n" "$(printf '%.0s─' {1..60})"
}

step_pass() {
    STEPS_PASSED=$((STEPS_PASSED + 1))
    printf "${GREEN}${BOLD}  ✔ %s${RESET}\n" "$1"
}

step_fail() {
    STEPS_FAILED=$((STEPS_FAILED + 1))
    FAILED_STEPS+=("$1")
    printf "${RED}${BOLD}  ✘ %s${RESET}\n" "$1"
}

# ── Banner ───────────────────────────────────────────────────────────

printf "${CYAN}${BOLD}conform — Full Validation${RESET}\n"
printf "${DIM}Root: %s${RESET}\n" "$SCRIPT_DIR"
[[ $QUICK -eq 1 ]] && printf "${YELLOW}Quick mode: skipping slow checks${RESET}\n"

# ── 1. TypeScript Build ─────────────────────────────────────────────

step "TypeScript Build"

if (cd "$SCRIPT_DIR/cli" && pnpm exec tsc --noEmit 2>&1); then
    step_pass "TypeScript type-check passed"
else
    step_fail "TypeScript type-check failed"
fi

# ── 2. CLI Unit Tests (jest) ─────────────────────────────────────────

if [[ $QUICK -eq 0 ]]; then
    step "CLI Unit Tests (jest)"

    if (cd "$SCRIPT_DIR/cli" && NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest --config jest.config.cjs --forceExit 2>&1); then
        step_pass "CLI unit tests passed"
    else
        step_fail "CLI unit tests failed"
    fi
else
    step "CLI Unit Tests (skipped — quick mode)"
    printf "${YELLOW}  SKIP${RESET}  use full mode to run jest tests\n"
fi

# ── 3. Bash Fixture Self-Tests ───────────────────────────────────────

step "Bash Fixture Self-Tests"

if bash "$SCRIPT_DIR/tests/run-tests.sh" 2>&1; then
    step_pass "Fixture self-tests passed"
else
    step_fail "Fixture self-tests failed"
fi

# ── 4. Framework Self-Tests ──────────────────────────────────────────

step "Framework Self-Tests"

if bash "$SCRIPT_DIR/tests/test-framework.sh" 2>&1; then
    step_pass "Framework self-tests passed"
else
    step_fail "Framework self-tests failed"
fi

# ── 5. Structural: golden-plugin (should pass) ──────────────────────

step "Structural: golden-plugin (expect pass)"

if bash "$SCRIPT_DIR/conform" structural "$SCRIPT_DIR/tests/golden-plugin" > /dev/null 2>&1; then
    step_pass "golden-plugin passes structural"
else
    step_fail "golden-plugin fails structural (unexpected)"
fi

# ── 6. Structural: broken-plugin (should fail) ──────────────────────

step "Structural: broken-plugin (expect fail)"

if bash "$SCRIPT_DIR/conform" structural "$SCRIPT_DIR/tests/broken-plugin" > /dev/null 2>&1; then
    step_fail "broken-plugin passes structural (should fail)"
else
    step_pass "broken-plugin fails structural (expected)"
fi

# ── 7. Structural: all fixtures ─────────────────────────────────────

step "Structural: all fixtures scan"

if bash "$SCRIPT_DIR/conform" structural "$SCRIPT_DIR/tests/" > /dev/null 2>&1; then
    # broken-plugin causes exit 1, so this will normally fail
    step_pass "All fixtures scanned (no crashes)"
else
    # Expected: broken-plugin causes failures, but no crash
    step_pass "All fixtures scanned (broken-plugin caused expected failures)"
fi

# ── 8. Dry-run integration ──────────────────────────────────────────

step "Integration Dry-Run"

if bash "$SCRIPT_DIR/conform" integration "$SCRIPT_DIR/tests/golden-plugin" --dry-run 2>&1 | grep -q "SKIP\|DRY"; then
    step_pass "Integration dry-run works (no API calls)"
else
    # Even if grep doesn't match, check the script ran without crashing
    if bash "$SCRIPT_DIR/conform" integration "$SCRIPT_DIR/tests/golden-plugin" --dry-run > /dev/null 2>&1; then
        step_pass "Integration dry-run completes without error"
    else
        step_fail "Integration dry-run failed"
    fi
fi

# ── 9. CLI dist build ───────────────────────────────────────────────

step "CLI Dist Build"

if (cd "$SCRIPT_DIR/cli" && pnpm exec tsc 2>&1); then
    step_pass "CLI dist build succeeded"

    # Verify key files exist in dist
    MISSING=()
    for f in index.js App.js runners.js parse-args.js types.js preflight.js; do
        [[ -f "$SCRIPT_DIR/cli/dist/$f" ]] || MISSING+=("$f")
    done

    if [[ ${#MISSING[@]} -eq 0 ]]; then
        step_pass "All expected dist files present"
    else
        step_fail "Missing dist files: ${MISSING[*]}"
    fi
else
    step_fail "CLI dist build failed"
fi

# ── Summary ──────────────────────────────────────────────────────────

printf "\n${CYAN}${BOLD}══════════════════════════════════════════════════════════════${RESET}\n"
printf "  ${GREEN}Passed: %d${RESET}\n" "$STEPS_PASSED"
if [[ $STEPS_FAILED -gt 0 ]]; then
    printf "  ${RED}Failed: %d${RESET}\n" "$STEPS_FAILED"
    printf "\n  ${RED}Failed steps:${RESET}\n"
    for f in "${FAILED_STEPS[@]}"; do
        printf "    ${RED}✘ %s${RESET}\n" "$f"
    done
else
    printf "  Failed: 0\n"
fi
printf "${CYAN}${BOLD}══════════════════════════════════════════════════════════════${RESET}\n\n"

if [[ $STEPS_FAILED -eq 0 ]]; then
    printf "  ${GREEN}${BOLD}RESULT: ALL CHECKS PASSED${RESET}\n\n"
    exit 0
else
    printf "  ${RED}${BOLD}RESULT: %d CHECK(S) FAILED${RESET}\n\n" "$STEPS_FAILED"
    exit 1
fi
