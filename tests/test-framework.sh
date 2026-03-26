#!/usr/bin/env bash
# test-framework.sh — Self-tests for the test framework
#
# Validates that the test infrastructure itself works correctly:
#   - generate-cases.py discovers the right cases from fixtures
#   - Plugin type classification is correct
#   - Golden plugin produces expected cases
#   - Broken plugin has known issues
#   - .claude/ and standalone dirs are discovered
#   - Structural tests pass/fail on the right fixtures
#
# Usage:
#   bash tests/test-framework.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES_DIR="$SCRIPT_DIR"
TMPFILE=$(mktemp)
trap "rm -f $TMPFILE" EXIT

# Colors
if [[ -t 1 ]]; then
    GREEN='\033[0;32m' RED='\033[0;31m' YELLOW='\033[0;33m'
    CYAN='\033[0;36m' DIM='\033[0;90m' BOLD='\033[1m' RESET='\033[0m'
else
    GREEN='' RED='' YELLOW='' CYAN='' DIM='' BOLD='' RESET=''
fi

PASS_COUNT=0
FAIL_COUNT=0

pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    printf "${GREEN}PASS${RESET}  %s\n" "$1"
}

fail() {
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf "${RED}FAIL${RESET}  %s\n" "$1"
    [[ -n "${2:-}" ]] && printf "       ${DIM}%s${RESET}\n" "$2"
}

section() {
    printf "\n${CYAN}${BOLD}%s${RESET}\n" "$1"
    printf "${CYAN}%s${RESET}\n" "$(printf '%.0s─' {1..50})"
}

# Helper: query cases.json with python
qcases() {
    python3 -c "
import json, sys
cases = json.load(open('$TMPFILE'))
$1
"
}

printf "${CYAN}${BOLD}Test Framework Self-Tests${RESET}\n"
printf "${DIM}Fixtures: %s${RESET}\n" "$FIXTURES_DIR"

# ── Generate cases ──────────────────────────────────────────────────

section "Case Generation"

python3 "$ROOT_DIR/integration/generate-cases.py" "$TMPFILE" --plugins-dir "$FIXTURES_DIR" 2>/dev/null

TOTAL=$(qcases "print(len(cases))")
if [[ "$TOTAL" -gt 0 ]]; then
    pass "generate-cases.py produced $TOTAL cases"
else
    fail "generate-cases.py produced 0 cases"
fi

# ── Expected counts by type ─────────────────────────────────────────

section "Case Counts"

SKILL_COUNT=$(qcases "print(sum(1 for c in cases if c['type'] == 'skill'))")
CMD_COUNT=$(qcases "print(sum(1 for c in cases if c['type'] == 'command'))")
HOOK_COUNT=$(qcases "print(sum(1 for c in cases if c['type'] == 'hook'))")
AGENT_COUNT=$(qcases "print(sum(1 for c in cases if c['type'] == 'agent'))")

[[ "$SKILL_COUNT" -ge 3 ]] && pass "skills: $SKILL_COUNT (>= 3 expected)" || fail "skills: $SKILL_COUNT (expected >= 3)"
[[ "$CMD_COUNT" -ge 5 ]] && pass "commands: $CMD_COUNT (>= 5 expected)" || fail "commands: $CMD_COUNT (expected >= 5)"
[[ "$HOOK_COUNT" -ge 2 ]] && pass "hooks: $HOOK_COUNT (>= 2 expected)" || fail "hooks: $HOOK_COUNT (expected >= 2)"
[[ "$AGENT_COUNT" -ge 2 ]] && pass "agents: $AGENT_COUNT (>= 2 expected)" || fail "agents: $AGENT_COUNT (expected >= 2)"

# ── Plugin type classification ──────────────────────────────────────

section "Plugin Type Classification"

# golden-plugin has .claude-plugin/ -> "plugin"
GOLDEN_TYPE=$(qcases "
types = set(c['plugin_type'] for c in cases if c['plugin'] == 'golden-plugin')
print(types.pop() if len(types) == 1 else ','.join(types))
")
[[ "$GOLDEN_TYPE" == "plugin" ]] && pass "golden-plugin -> 'plugin'" || fail "golden-plugin -> '$GOLDEN_TYPE' (expected 'plugin')"

# broken-plugin has .claude-plugin/ -> "plugin"
BROKEN_TYPE=$(qcases "
types = set(c['plugin_type'] for c in cases if c['plugin'] == 'broken-plugin')
print(types.pop() if len(types) == 1 else ','.join(types))
")
[[ "$BROKEN_TYPE" == "plugin" ]] && pass "broken-plugin -> 'plugin'" || fail "broken-plugin -> '$BROKEN_TYPE' (expected 'plugin')"

# dot-claude-project has commands/ at root -> "standalone"
DOT_TYPE=$(qcases "
types = set(c['plugin_type'] for c in cases if c['plugin'] == 'dot-claude-project')
print(types.pop() if len(types) == 1 else 'not_found')
")
[[ "$DOT_TYPE" == "standalone" ]] && pass "dot-claude-project -> 'standalone'" || fail "dot-claude-project -> '$DOT_TYPE' (expected 'standalone')"

# mock-project has .claude/commands/ -> "project"
MOCK_TYPE=$(qcases "
types = set(c['plugin_type'] for c in cases if c['plugin'] == 'mock-project')
print(types.pop() if len(types) == 1 else 'not_found')
")
[[ "$MOCK_TYPE" == "project" ]] && pass "mock-project -> 'project'" || fail "mock-project -> '$MOCK_TYPE' (expected 'project')"

# ── Golden plugin (complete, should be fully discovered) ─────────────

section "Golden Plugin"

GOLDEN_SKILLS=$(qcases "print(sum(1 for c in cases if c['plugin'] == 'golden-plugin' and c['type'] == 'skill'))")
GOLDEN_CMDS=$(qcases "print(sum(1 for c in cases if c['plugin'] == 'golden-plugin' and c['type'] == 'command'))")
GOLDEN_AGENTS=$(qcases "print(sum(1 for c in cases if c['plugin'] == 'golden-plugin' and c['type'] == 'agent'))")
GOLDEN_HOOKS=$(qcases "print(sum(1 for c in cases if c['plugin'] == 'golden-plugin' and c['type'] == 'hook'))")

[[ "$GOLDEN_SKILLS" -eq 1 ]] && pass "1 skill (data-analysis)" || fail "$GOLDEN_SKILLS skills (expected 1)"
[[ "$GOLDEN_CMDS" -eq 1 ]] && pass "1 command (analyze)" || fail "$GOLDEN_CMDS commands (expected 1)"
[[ "$GOLDEN_AGENTS" -eq 1 ]] && pass "1 agent (data-helper)" || fail "$GOLDEN_AGENTS agents (expected 1)"
[[ "$GOLDEN_HOOKS" -eq 1 ]] && pass "1 hook (PreToolUse)" || fail "$GOLDEN_HOOKS hooks (expected 1)"

GOLDEN_TRIGGER=$(qcases "
c = [c for c in cases if c['plugin'] == 'golden-plugin' and c['type'] == 'skill'][0]
print(c['trigger'])
")
[[ "$GOLDEN_TRIGGER" == "analyze data" ]] && pass "skill trigger: '$GOLDEN_TRIGGER'" || fail "skill trigger: '$GOLDEN_TRIGGER' (expected 'analyze data')"

GOLDEN_ARG_HINT=$(qcases "
c = [c for c in cases if c['plugin'] == 'golden-plugin' and c['type'] == 'command'][0]
print(c.get('argument_hint') or '')
")
[[ -n "$GOLDEN_ARG_HINT" ]] && pass "command has argument_hint" || fail "command missing argument_hint"

# ── Broken plugin ───────────────────────────────────────────────────

section "Broken Plugin"

BROKEN_SKILLS=$(qcases "print(sum(1 for c in cases if c['plugin'] == 'broken-plugin' and c['type'] == 'skill'))")
BROKEN_AGENTS=$(qcases "print(sum(1 for c in cases if c['plugin'] == 'broken-plugin' and c['type'] == 'agent'))")

[[ "$BROKEN_SKILLS" -ge 1 ]] && pass "$BROKEN_SKILLS skills discovered" || fail "0 skills (expected >= 1)"
[[ "$BROKEN_AGENTS" -ge 1 ]] && pass "$BROKEN_AGENTS agents discovered" || fail "0 agents (expected >= 1)"

# missing-skillmd should NOT be discovered (no SKILL.md)
MISSING_SKILL=$(qcases "
print(sum(1 for c in cases if c['plugin'] == 'broken-plugin' and c.get('name') == 'missing-skillmd'))
")
[[ "$MISSING_SKILL" -eq 0 ]] && pass "missing-skillmd correctly excluded" || fail "missing-skillmd was discovered (should be excluded)"

# Structural tests should catch all the broken skill variants
BROKEN_OUTPUT=$(bash "$ROOT_DIR/conform" structural "$FIXTURES_DIR/broken-plugin" 2>/dev/null || true)

echo "$BROKEN_OUTPUT" | grep -q "Found 'skill.md' instead of 'SKILL.md'" \
    && pass "detects lowercase skill.md (case-sensitive)" \
    || fail "missed lowercase skill.md detection"

echo "$BROKEN_OUTPUT" | grep "empty-skill" | grep -q "File not found" \
    && pass "detects empty skill directory (no SKILL.md)" \
    || fail "missed empty skill directory"

echo "$BROKEN_OUTPUT" | grep "readme-only" | grep -q "File not found" \
    && pass "detects skill dir with only README.md (no SKILL.md)" \
    || fail "missed README-only skill directory"

# ── Project/standalone discovery ─────────────────────────────────────

section "Non-Plugin Directory Discovery"

DOT_CMDS=$(qcases "print(sum(1 for c in cases if c['plugin'] == 'dot-claude-project' and c['type'] == 'command'))")
[[ "$DOT_CMDS" -ge 2 ]] && pass "dot-claude-project: $DOT_CMDS commands (deploy, review)" || fail "dot-claude-project: $DOT_CMDS commands (expected >= 2)"

MOCK_CMDS=$(qcases "print(sum(1 for c in cases if c['plugin'] == 'mock-project' and c['type'] == 'command'))")
[[ "$MOCK_CMDS" -ge 2 ]] && pass "mock-project: $MOCK_CMDS commands from .claude/commands/" || fail "mock-project: $MOCK_CMDS commands (expected >= 2)"

# ── Case field validation ────────────────────────────────────────────

section "Case Field Validation"

MISSING_FIELDS=$(qcases "
required = ['type', 'plugin', 'plugin_type', 'trigger', 'keywords']
bad = []
for i, c in enumerate(cases):
    missing = [f for f in required if f not in c or not c[f]]
    if missing:
        bad.append(f\"{c['plugin']}/{c.get('name','?')}: missing {','.join(missing)}\")
for b in bad[:5]:
    print(b, file=sys.stderr)
print(len(bad))
")
if [[ "$MISSING_FIELDS" -eq 0 ]]; then
    pass "all cases have required fields"
else
    fail "$MISSING_FIELDS cases missing required fields"
fi

CMD_MISSING=$(qcases "print(sum(1 for c in cases if c['type'] == 'command' and not c.get('command')))")
[[ "$CMD_MISSING" -eq 0 ]] && pass "all command cases have 'command' field" || fail "$CMD_MISSING commands missing 'command'"

HOOK_MISSING=$(qcases "print(sum(1 for c in cases if c['type'] == 'hook' and not c.get('event')))")
[[ "$HOOK_MISSING" -eq 0 ]] && pass "all hook cases have 'event' field" || fail "$HOOK_MISSING hooks missing 'event'"

# ── Type filtering ───────────────────────────────────────────────────

section "Type Filtering"

# --types skills should only produce skills
SKILLS_ONLY=$(mktemp)
python3 "$ROOT_DIR/integration/generate-cases.py" "$SKILLS_ONLY" --plugins-dir "$FIXTURES_DIR" --types skills 2>/dev/null
NON_SKILL=$(python3 -c "
import json
cases = json.load(open('$SKILLS_ONLY'))
print(sum(1 for c in cases if c['type'] != 'skill'))
")
rm -f "$SKILLS_ONLY"
[[ "$NON_SKILL" -eq 0 ]] && pass "--types skills produces only skill cases" || fail "--types skills included $NON_SKILL non-skill cases"

# --types commands should only produce commands
CMDS_ONLY=$(mktemp)
python3 "$ROOT_DIR/integration/generate-cases.py" "$CMDS_ONLY" --plugins-dir "$FIXTURES_DIR" --types commands 2>/dev/null
NON_CMD=$(python3 -c "
import json
cases = json.load(open('$CMDS_ONLY'))
print(sum(1 for c in cases if c['type'] != 'command'))
")
rm -f "$CMDS_ONLY"
[[ "$NON_CMD" -eq 0 ]] && pass "--types commands produces only command cases" || fail "--types commands included $NON_CMD non-command cases"

# ── Structural tests ────────────────────────────────────────────────

section "Structural Tests"

if bash "$ROOT_DIR/conform" structural "$FIXTURES_DIR/golden-plugin" > /dev/null 2>&1; then
    pass "golden-plugin passes structural validation"
else
    fail "golden-plugin fails structural validation"
fi

if bash "$ROOT_DIR/conform" structural "$FIXTURES_DIR/broken-plugin" > /dev/null 2>&1; then
    fail "broken-plugin passed structural validation (should fail)"
else
    pass "broken-plugin fails structural validation (expected)"
fi

# ── Confusing plugin (overlapping skill descriptions) ──────────────

section "Confusing Plugin (Overlapping Skills)"

if bash "$ROOT_DIR/conform" structural "$FIXTURES_DIR/confusing-plugin" > /dev/null 2>&1; then
    pass "confusing-plugin passes structural (overlapping descriptions are structurally valid)"
else
    fail "confusing-plugin should pass structural validation"
fi

CONFUSING_SKILLS=$(qcases "print(sum(1 for c in cases if c['plugin'] == 'confusing-plugin' and c['type'] == 'skill'))")
[[ "$CONFUSING_SKILLS" -eq 2 ]] && pass "confusing-plugin: 2 skills discovered" || fail "confusing-plugin: $CONFUSING_SKILLS skills (expected 2)"

# Both skills should share the same trigger phrase (the integration test would catch wrong-skill)
CONFUSING_TRIGGERS=$(qcases "
triggers = [c['trigger'] for c in cases if c['plugin'] == 'confusing-plugin' and c['type'] == 'skill']
print('|'.join(sorted(triggers)))
")
[[ -n "$CONFUSING_TRIGGERS" ]] && pass "confusing-plugin: skills have triggers: $CONFUSING_TRIGGERS" || fail "confusing-plugin: skills missing triggers"

# ── Empty dirs plugin (empty component directories) ────────────────

section "Empty Dirs Plugin"

EMPTY_OUTPUT=$(bash "$ROOT_DIR/conform" structural "$FIXTURES_DIR/empty-dirs-plugin" 2>/dev/null || true)
EMPTY_EXIT=$?

# Has both warnings (empty dirs) and a failure (empty skill subdir with no SKILL.md)
EMPTY_WARNS=$(echo "$EMPTY_OUTPUT" | grep -c "WARN:" || true)
[[ "$EMPTY_WARNS" -ge 3 ]] && pass "empty-dirs-plugin: $EMPTY_WARNS warnings for empty dirs (>= 3 expected)" || fail "empty-dirs-plugin: $EMPTY_WARNS warnings (expected >= 3)"

# Verify the specific warning messages
echo "$EMPTY_OUTPUT" | grep -q "Directory exists but contains no .md files" && pass "empty-dirs-plugin: warns about empty commands/" || fail "empty-dirs-plugin: missing empty commands/ warning"
echo "$EMPTY_OUTPUT" | grep -q "hooks/" && pass "empty-dirs-plugin: warns about empty hooks/" || fail "empty-dirs-plugin: missing empty hooks/ warning"

# Empty skill subdirectory should fail (no SKILL.md)
echo "$EMPTY_OUTPUT" | grep "empty-skill" | grep -q "File not found" && pass "empty-dirs-plugin: fails on empty skill subdir" || fail "empty-dirs-plugin: missed empty skill subdir"

# ── Malformed plugin (invalid JSON, oversized, missing frontmatter) ─

section "Malformed Plugin"

if bash "$ROOT_DIR/conform" structural "$FIXTURES_DIR/malformed-plugin" > /dev/null 2>&1; then
    fail "malformed-plugin passed structural validation (should fail)"
else
    pass "malformed-plugin fails structural validation (expected)"
fi

MAL_OUTPUT=$(bash "$ROOT_DIR/conform" structural "$FIXTURES_DIR/malformed-plugin" 2>/dev/null || true)

# Invalid JSON in plugin.json
echo "$MAL_OUTPUT" | grep -q "JSON parse error" && pass "malformed-plugin: detects invalid JSON in plugin.json" || fail "malformed-plugin: missed invalid JSON"

# Oversized description
echo "$MAL_OUTPUT" | grep -q "description under 1024 chars" | grep -q "not ok" 2>/dev/null || {
    echo "$MAL_OUTPUT" | grep -q "Got 1318" && pass "malformed-plugin: detects oversized description (1318 chars)" || fail "malformed-plugin: missed oversized description"
}

# Command with no format
echo "$MAL_OUTPUT" | grep -q "No frontmatter and no # Title" && pass "malformed-plugin: detects commands with no valid format" || fail "malformed-plugin: missed invalid command format"

# Agent with no frontmatter
echo "$MAL_OUTPUT" | grep -q "Missing --- delimiters" && pass "malformed-plugin: detects agent without frontmatter" || fail "malformed-plugin: missed missing frontmatter"

# Count expected failures
MAL_FAILS=$(echo "$MAL_OUTPUT" | grep -c "^not ok" || true)
[[ "$MAL_FAILS" -ge 4 ]] && pass "malformed-plugin: $MAL_FAILS failures detected (>= 4 expected)" || fail "malformed-plugin: only $MAL_FAILS failures (expected >= 4)"

# ── Warning plugin (empty agents dir) ──────────────────────────────

section "Warning Plugin"

WARN_OUTPUT=$(bash "$ROOT_DIR/conform" structural "$FIXTURES_DIR/warning-plugin" 2>/dev/null)
WARN_EXIT=$?

[[ $WARN_EXIT -eq 0 ]] && pass "warning-plugin passes structural (warnings only)" || fail "warning-plugin should pass structural"

echo "$WARN_OUTPUT" | grep -q "Directory exists but contains no .md files" && pass "warning-plugin: warns about empty agents/" || fail "warning-plugin: missing empty agents/ warning"

WARN_WARNS=$(echo "$WARN_OUTPUT" | grep -c "WARN:" || true)
[[ "$WARN_WARNS" -ge 4 ]] && pass "warning-plugin: $WARN_WARNS warnings (>= 4 expected)" || fail "warning-plugin: $WARN_WARNS warnings (expected >= 4)"

# ── CLI Discovery ────────────────────────────────────────────────────

if command -v claude &>/dev/null && [[ -z "${SKIP_CLI_TESTS:-}" ]]; then
    section "CLI Discovery (claude -p)"

    # Quick smoke test: run claude -p with a no-op prompt on golden-plugin
    # to verify plugin loading works. Uses --max-turns 1 to minimize cost.
    # ANTHROPIC_API_KEY is picked up from env automatically by claude CLI
    GOLDEN_RESPONSE=$(cd "$FIXTURES_DIR/golden-plugin" && CLAUDECODE= claude -p "respond with just the word HELLO" \
        --plugin-dir "$FIXTURES_DIR/golden-plugin" \
        --model claude-haiku-4-5 \
        --max-turns 1 \
        --output-format text \
        2>/dev/null) || GOLDEN_RESPONSE=""

    if [[ -n "$GOLDEN_RESPONSE" ]]; then
        pass "claude -p loaded golden-plugin and responded"
    else
        fail "claude -p failed to load golden-plugin or returned empty"
    fi
else
    section "CLI Discovery (skipped)"
    printf "${YELLOW}SKIP${RESET}  claude CLI not available or SKIP_CLI_TESTS set\n"
fi

# ── Summary ──────────────────────────────────────────────────────────

printf "\n${CYAN}══════════════════════════════════════════════${RESET}\n"
printf "  ${GREEN}Passed: $PASS_COUNT${RESET}\n"
[[ $FAIL_COUNT -gt 0 ]] && printf "  ${RED}Failed: $FAIL_COUNT${RESET}\n" || printf "  Failed: 0\n"
printf "${CYAN}══════════════════════════════════════════════${RESET}\n\n"

if [[ $FAIL_COUNT -eq 0 ]]; then
    printf "  ${GREEN}${BOLD}RESULT: PASS${RESET}\n\n"
    exit 0
else
    printf "  ${RED}${BOLD}RESULT: FAIL${RESET}\n\n"
    exit 1
fi
