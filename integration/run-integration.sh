#!/usr/bin/env bash
# run-integration.sh — Integration tests for Claude Code plugin skills
#
# Sends trigger phrases to a real Claude instance via `claude -p` and validates
# that the correct skill was loaded by checking the response content.
#
# Usage:
#   ./run-integration.sh                    # Test all skills
#   ./run-integration.sh --plugin <name>    # Test one plugin's skills
#   ./run-integration.sh --skill <name>     # Test one specific skill
#   ./run-integration.sh --dry-run          # Show what would run (no API calls)
#   ./run-integration.sh --help
#
# Options:
#   --model <model>     Model to use (default: haiku, cheapest)
#   --max-turns <n>     Max turns per test (default: 1)
#   --timeout <secs>    Per-test timeout (default: 60)
#   --verbose           Show full Claude responses
#   --stop-on-fail      Stop after first failure
#
# Requirements:
#   - `claude` CLI installed and authenticated (OAuth)
#   - python3 (for JSON parsing)
#
# Cost estimate: ~56 single-turn Haiku calls ≈ $0.02-0.05

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_MODEL="haiku"
PLUGINS_DIR=""
CASES_FILE="$SCRIPT_DIR/cases.json"
LOG_DIR="$SCRIPT_DIR/logs"
RESULTS_FILE="$SCRIPT_DIR/logs/.results"

# Load .env if present (won't override existing env vars)
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    while IFS='=' read -r key val; do
        key=$(echo "$key" | tr -d '[:space:]')
        [[ -z "$key" || "$key" == \#* ]] && continue
        val=$(echo "$val" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
        [[ -z "${!key:-}" ]] && export "$key=$val"
    done < "$SCRIPT_DIR/.env"
fi

# Defaults (env vars from .env override these)
MODEL="${TEST_MODEL:-$DEFAULT_MODEL}"
MAX_TURNS="${TEST_MAX_TURNS:-5}"
TIMEOUT="${TEST_TIMEOUT:-60}"
VERBOSE=0
DRY_RUN=0
STOP_ON_FAIL=0
FILTER_PLUGIN=""
FILTER_SKILL=""

# Auth: default to oauth — API key mode requires explicit --auth api
AUTH_MODE="oauth"

# Colors
if [[ -t 1 ]]; then
    GREEN='\033[0;32m' RED='\033[0;31m' YELLOW='\033[0;33m'
    CYAN='\033[0;36m' DIM='\033[0;90m' BOLD='\033[1m' RESET='\033[0m'
else
    GREEN='' RED='' YELLOW='' CYAN='' DIM='' BOLD='' RESET=''
fi

usage() {
    sed -n '2,/^[^#]/{ /^#/s/^# \?//p; }' "$0"
    exit 0
}

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)      usage ;;
        --model)        MODEL="$2"; shift 2 ;;
        --max-turns)    MAX_TURNS="$2"; shift 2 ;;
        --timeout)      TIMEOUT="$2"; shift 2 ;;
        --verbose|-v)   VERBOSE=1; shift ;;
        --dry-run)      DRY_RUN=1; shift ;;
        --stop-on-fail) STOP_ON_FAIL=1; shift ;;
        --plugin)       FILTER_PLUGIN="$2"; shift 2 ;;
        --skill)        FILTER_SKILL="$2"; shift 2 ;;
        --plugins-dir)  PLUGINS_DIR="$2"; shift 2 ;;
        --auth)         AUTH_MODE="$2"; shift 2 ;;
        *)              echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Default plugins dir if not set via --plugins-dir
if [[ -z "$PLUGINS_DIR" ]]; then
    PLUGINS_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

# Preflight
if ! command -v claude &>/dev/null; then
    echo "Error: 'claude' CLI not found in PATH."
    exit 1
fi

if [[ "$AUTH_MODE" == "api" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "Error: --auth api requires ANTHROPIC_API_KEY to be set."
    exit 1
fi

if [[ -n "${CLAUDECODE:-}" && $DRY_RUN -eq 0 ]]; then
    echo "⚠  Running inside a Claude Code session."
    echo "   Integration tests invoke 'claude -p' which cannot nest."
    echo "   Run this from a regular terminal instead:"
    echo ""
    echo "   cd $(pwd)"
    echo "   bash conform/integration/run-integration.sh $*"
    echo ""
    exit 1
fi

# Generate cases if missing
if [[ ! -f "$CASES_FILE" ]]; then
    echo "Generating test cases..."
    python3 "$SCRIPT_DIR/generate-cases.py" "$CASES_FILE"
fi

mkdir -p "$LOG_DIR"
: > "$RESULTS_FILE"

# Build filtered case list as a temp file (one JSON object per line)
CASES_NDJSON=$(mktemp)
trap "rm -f $CASES_NDJSON" EXIT

python3 -c "
import json, sys
cases = json.load(open('$CASES_FILE'))
pf, sf = '$FILTER_PLUGIN', '$FILTER_SKILL'
if pf: cases = [c for c in cases if c['plugin'] == pf]
if sf: cases = [c for c in cases if c['skill'] == sf]
for c in cases:
    print(json.dumps(c))
" > "$CASES_NDJSON"

CASE_COUNT=$(wc -l < "$CASES_NDJSON" | tr -d ' ')

# Header
printf "\n${CYAN}╔══════════════════════════════════════════════╗${RESET}\n"
printf "${CYAN}║   Plugin Integration Tests (claude -p)       ║${RESET}\n"
printf "${CYAN}╚══════════════════════════════════════════════╝${RESET}\n\n"
printf "  Auth:       ${BOLD}%s${RESET}\n" "$AUTH_MODE"
printf "  Model:      ${BOLD}%s${RESET}\n" "$MODEL"
printf "  Max turns:  %s\n" "$MAX_TURNS"
printf "  Timeout:    %ss\n" "$TIMEOUT"
printf "  Tests:      %s" "$CASE_COUNT"
[[ -n "$FILTER_PLUGIN" ]] && printf " (plugin: %s)" "$FILTER_PLUGIN"
[[ -n "$FILTER_SKILL" ]] && printf " (skill: %s)" "$FILTER_SKILL"
printf "\n"
printf "  Mode:       %s\n\n" "$( [[ $DRY_RUN -eq 1 ]] && echo 'DRY RUN' || echo 'LIVE' )"

# Dry run — emit SKIP lines in the same format as live results so the TUI can parse them
if [[ $DRY_RUN -eq 1 ]]; then
    dry_i=0
    while IFS= read -r case_json; do
        dry_i=$((dry_i + 1))
        plugin=$(echo "$case_json" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c['plugin'])")
        skill=$(echo "$case_json" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c['skill'])")
        trigger=$(echo "$case_json" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c['trigger'])")
        case_type=$(echo "$case_json" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('type','skill'))")
        cmd_slug_dry=$(echo "$case_json" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('command',''))")
        dry_trigger="$trigger"
        [[ "$case_type" == "command" && -n "$cmd_slug_dry" ]] && dry_trigger="/${cmd_slug_dry}"
        printf "SKIP [%s] [%d/%d] %s/%s \"%s\" (dry-run)\n" "$case_type" "$dry_i" "$CASE_COUNT" "$plugin" "$skill" "$dry_trigger"
    done < "$CASES_NDJSON"
    exit 0
fi

# Prompt templates per case type
SKILL_PROMPT_TEMPLATE='I need help: %s

IMPORTANT: This is a test prompt. Do NOT use any tools — no Read, Glob, Grep, Bash, Write, Edit, or any other tool. Do NOT attempt to read files, search code, or run commands. Respond ONLY with plain text.

On the FIRST LINE of your response, output one of these exactly:
- [SKILL_LOADED:skill-name] if a plugin skill was loaded into your context (use the name from YAML frontmatter)
- [NO_SKILL_LOADED] if no skill was loaded

Then write 2-3 sentences about the topic. Nothing else.'

COMMAND_PROMPT_TEMPLATE='%s

IMPORTANT: This is a test prompt. Do NOT use any tools — no Read, Glob, Grep, Bash, Write, Edit, or any other tool. Do NOT attempt to read files, search code, or run commands. Respond ONLY with plain text.

On the FIRST LINE of your response, output one of these exactly:
- [COMMAND_LOADED:%s] if the slash command was recognized and loaded
- [NO_COMMAND_LOADED] if no command was found

Then write 2-3 sentences about what this command does. Nothing else.'

AGENT_PROMPT_TEMPLATE='I need help: %s

IMPORTANT: This is a test prompt. Do NOT use any tools — no Read, Glob, Grep, Bash, Write, Edit, or any other tool. Do NOT attempt to read files, search code, or run commands. Respond ONLY with plain text.

On the FIRST LINE of your response, output one of these exactly:
- [AGENT_AVAILABLE:agent-name] if a plugin agent was available in your context (use the agent name)
- [NO_AGENT_AVAILABLE] if no agent was available

Then write 2-3 sentences about the topic. Nothing else.'

# Run tests sequentially
test_num=0
while IFS= read -r case_json; do
    test_num=$((test_num + 1))

    # Parse case
    plugin=$(echo "$case_json" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c['plugin'])")
    skill=$(echo "$case_json" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c['skill'])")
    trigger=$(echo "$case_json" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c['trigger'])")
    keywords=$(echo "$case_json" | python3 -c "import json,sys; c=json.load(sys.stdin); print(' '.join(c.get('keywords',[])[:5]))")
    case_type=$(echo "$case_json" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('type','skill'))")
    case_name=$(echo "$case_json" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('name', c['skill']))")
    cmd_slug=$(echo "$case_json" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('command',''))")
    plugin_type=$(echo "$case_json" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('plugin_type','plugin'))")

    test_id="${plugin}/${case_name}"
    log_file="$LOG_DIR/${plugin}__${skill}.log"
    progress="[${test_num}/${CASE_COUNT}]"

    plugin_dir="$PLUGINS_DIR/$plugin"
    if [[ ! -d "$plugin_dir" ]]; then
        printf "${YELLOW}SKIP${RESET} [%s] %s %-40s Plugin dir not found\n" "$case_type" "$progress" "$test_id"
        echo "SKIP:$test_id" >> "$RESULTS_FILE"
        continue
    fi

    # Skip hook cases — hooks are validated structurally
    if [[ "$case_type" == "hook" ]]; then
        printf "${YELLOW}SKIP${RESET} [hook] %s %-40s ${DIM}Hooks are structural-only${RESET}\n" "$progress" "$test_id"
        echo "SKIP:$test_id:structural_only" >> "$RESULTS_FILE"
        continue
    fi

    # Build prompt based on case type
    # For commands, use bare slash command (no sample args) to avoid
    # triggering tool execution (e.g. /scan localhost causes Claude to
    # actually try running nmap)
    if [[ "$case_type" == "command" ]]; then
        bare_trigger="/${cmd_slug}"
        prompt=$(printf "$COMMAND_PROMPT_TEMPLATE" "$bare_trigger" "$cmd_slug")
    elif [[ "$case_type" == "agent" ]]; then
        prompt=$(printf "$AGENT_PROMPT_TEMPLATE" "$trigger")
    else
        prompt=$(printf "$SKILL_PROMPT_TEMPLATE" "$trigger")
    fi

    # Run Claude
    display_trigger="$trigger"
    [[ "$case_type" == "command" ]] && display_trigger="/${cmd_slug}"
    printf "${DIM}RUN  [%s] %s %-40s \"%s\"${RESET}" "$case_type" "$progress" "$test_id" "$display_trigger"

    response=""
    # Build claude args based on plugin type and auth mode
    # Commands use --max-turns 1 to prevent tool loops (security commands
    # like /scan cause Claude to attempt tool execution)
    local_max_turns="$MAX_TURNS"
    [[ "$case_type" == "command" ]] && local_max_turns=1
    claude_args=(-p "$prompt" --model "$MODEL" --max-turns "$local_max_turns" --output-format text)
    if [[ "$plugin_type" == "plugin" ]]; then
        # .claude-plugin/ — explicit plugin dir
        claude_args+=(--plugin-dir "$plugin_dir")
    fi
    # "project" and "standalone" rely on cwd-based discovery

    # Unset CLAUDECODE to allow running from within a Claude Code session
    # When --auth oauth, unset ANTHROPIC_API_KEY so claude uses OAuth session instead
    # When --auth api, ANTHROPIC_API_KEY is picked up from env automatically
    env_vars=(CLAUDECODE=)
    [[ "$AUTH_MODE" == "oauth" ]] && env_vars+=(ANTHROPIC_API_KEY=)

    if response=$(cd "$plugin_dir" && env "${env_vars[@]}" claude "${claude_args[@]}" 2>"$log_file.stderr"); then
        :
    fi

    echo "$response" > "$log_file"

    # Clear the RUN line
    printf "\r\033[K"

    # Check for empty response or max-turns exhaustion
    if [[ -z "$response" ]]; then
        printf "${RED}ERR ${RESET} [%s] %s %-40s ${DIM}Empty response (timeout/error)${RESET}\n" "$case_type" "$progress" "$test_id"
        echo "ERROR:$test_id" >> "$RESULTS_FILE"
        [[ $VERBOSE -eq 1 && -f "$log_file.stderr" ]] && printf "${DIM}  stderr: %s${RESET}\n" "$(head -3 "$log_file.stderr")"
        continue
    fi

    if [[ "$response" == *"Reached max turns"* ]]; then
        printf "${RED}ERR ${RESET} [%s] %s %-40s ${DIM}Exhausted max turns (%s) — model used tools instead of responding | trigger: \"%s\"${RESET}\n" "$case_type" "$progress" "$test_id" "$MAX_TURNS" "$trigger"
        echo "ERROR:$test_id:max_turns" >> "$RESULTS_FILE"
        continue
    fi

    # Parse result based on case type
    first_line=$(head -1 <<< "$response")

    if [[ "$case_type" == "command" ]]; then
        # Command evaluation
        if [[ "$first_line" =~ \[COMMAND_LOADED:([^\]]+)\] ]]; then
            printf "${GREEN}PASS${RESET} [command] %s %-40s ${DIM}\"%s\"${RESET}\n" "$progress" "$test_id" "$display_trigger"
            echo "PASS:$test_id" >> "$RESULTS_FILE"
        elif [[ "$first_line" == *"[NO_COMMAND_LOADED]"* ]]; then
            printf "${RED}FAIL${RESET} [command] %s %-40s ${DIM}Command not recognized: \"%s\"${RESET}\n" "$progress" "$test_id" "$display_trigger"
            echo "FAIL:$test_id:no_command" >> "$RESULTS_FILE"
        else
            # No tag — command likely loaded but Claude went off-script
            # (common with tool-heavy commands that trigger actions)
            response_lower=$(echo "$response" | tr '[:upper:]' '[:lower:]')
            found_keyword=""
            for kw in $keywords; do
                if [[ "$response_lower" == *"$kw"* ]]; then
                    found_keyword="$kw"
                    break
                fi
            done
            if [[ -n "$found_keyword" ]]; then
                printf "${YELLOW}WARN${RESET} [command] %s %-40s ${DIM}loaded (keyword \"%s\") but no tag | trigger: \"%s\"${RESET}\n" "$progress" "$test_id" "$found_keyword" "$display_trigger"
                echo "WARN:$test_id:keyword=$found_keyword" >> "$RESULTS_FILE"
            else
                printf "${RED}FAIL${RESET} [command] %s %-40s ${DIM}No command tag, no keywords${RESET}\n" "$progress" "$test_id"
                echo "FAIL:$test_id:no_tag_no_keywords" >> "$RESULTS_FILE"
            fi
        fi
    elif [[ "$case_type" == "agent" ]]; then
        # Agent evaluation
        if [[ "$first_line" =~ \[AGENT_AVAILABLE:([^\]]+)\] ]]; then
            printf "${GREEN}PASS${RESET} [agent] %s %-40s ${DIM}\"%s\"${RESET}\n" "$progress" "$test_id" "$trigger"
            echo "PASS:$test_id" >> "$RESULTS_FILE"
        elif [[ "$first_line" == *"[NO_AGENT_AVAILABLE]"* ]]; then
            printf "${RED}FAIL${RESET} [agent] %s %-40s ${DIM}Agent not found: \"%s\"${RESET}\n" "$progress" "$test_id" "$trigger"
            echo "FAIL:$test_id:no_agent" >> "$RESULTS_FILE"
        else
            # Keyword fallback
            response_lower=$(echo "$response" | tr '[:upper:]' '[:lower:]')
            found_keyword=""
            for kw in $keywords; do
                if [[ "$response_lower" == *"$kw"* ]]; then
                    found_keyword="$kw"
                    break
                fi
            done
            if [[ -n "$found_keyword" ]]; then
                printf "${GREEN}PASS${RESET} [agent] %s %-40s ${DIM}(keyword \"%s\" matched) | trigger: \"%s\"${RESET}\n" "$progress" "$test_id" "$found_keyword" "$trigger"
                echo "PASS:$test_id:keyword=$found_keyword" >> "$RESULTS_FILE"
            else
                printf "${RED}FAIL${RESET} [agent] %s %-40s ${DIM}No agent tag, no keywords${RESET}\n" "$progress" "$test_id"
                echo "FAIL:$test_id:no_tag_no_keywords" >> "$RESULTS_FILE"
            fi
        fi
    else
        # Skill evaluation
        detected_skill=""
        if [[ "$first_line" =~ \[SKILL_LOADED:([^\]]+)\] ]]; then
            detected_skill="${BASH_REMATCH[1]}"
        fi

        if [[ "$detected_skill" == "$skill" ]]; then
            printf "${GREEN}PASS${RESET} [skill] %s %-40s ${DIM}\"%s\"${RESET}\n" "$progress" "$test_id" "$trigger"
            echo "PASS:$test_id" >> "$RESULTS_FILE"

        elif [[ -n "$detected_skill" ]]; then
            printf "${YELLOW}WARN${RESET} [skill] %s %-40s ${DIM}loaded: %s (expected: %s) | trigger: \"%s\"${RESET}\n" "$progress" "$test_id" "$detected_skill" "$skill" "$trigger"
            echo "WARN:$test_id:loaded=$detected_skill" >> "$RESULTS_FILE"

        elif [[ "$first_line" == *"[NO_SKILL_LOADED]"* ]]; then
            printf "${RED}FAIL${RESET} [skill] %s %-40s ${DIM}No skill loaded for \"%s\"${RESET}\n" "$progress" "$test_id" "$trigger"
            echo "FAIL:$test_id:no_skill" >> "$RESULTS_FILE"

        else
            response_lower=$(echo "$response" | tr '[:upper:]' '[:lower:]')
            found_keyword=""
            for kw in $keywords; do
                if [[ "$response_lower" == *"$kw"* ]]; then
                    found_keyword="$kw"
                    break
                fi
            done

            if [[ -n "$found_keyword" ]]; then
                printf "${YELLOW}WARN${RESET} [skill] %s %-40s ${DIM}(no tag, keyword \"%s\" found) | trigger: \"%s\"${RESET}\n" "$progress" "$test_id" "$found_keyword" "$trigger"
                echo "WARN:$test_id:keyword=$found_keyword" >> "$RESULTS_FILE"
            else
                printf "${RED}FAIL${RESET} [skill] %s %-40s ${DIM}No skill tag, no domain keywords${RESET}\n" "$progress" "$test_id"
                echo "FAIL:$test_id:no_tag_no_keywords" >> "$RESULTS_FILE"
            fi
        fi
    fi

    if [[ $VERBOSE -eq 1 ]]; then
        printf "${DIM}  %.300s${RESET}\n" "$response"
    fi

    # Stop on fail
    if [[ $STOP_ON_FAIL -eq 1 ]] && grep -q "^FAIL:" "$RESULTS_FILE"; then
        printf "\n${RED}Stopping on first failure.${RESET}\n"
        break
    fi

done < "$CASES_NDJSON"

# Summary — grep -c returns 1 exit code when no matches, so capture separately
TOTAL_PASS=$(grep -c "^PASS:" "$RESULTS_FILE" 2>/dev/null) || TOTAL_PASS=0
TOTAL_WARN=$(grep -c "^WARN:" "$RESULTS_FILE" 2>/dev/null) || TOTAL_WARN=0
TOTAL_FAIL=$(grep -c "^FAIL:" "$RESULTS_FILE" 2>/dev/null) || TOTAL_FAIL=0
TOTAL_ERR=$(grep -c "^ERROR:" "$RESULTS_FILE" 2>/dev/null) || TOTAL_ERR=0
TOTAL_SKIP=$(grep -c "^SKIP:" "$RESULTS_FILE" 2>/dev/null) || TOTAL_SKIP=0
TOTAL_RAN=$((TOTAL_PASS + TOTAL_WARN + TOTAL_FAIL + TOTAL_ERR + TOTAL_SKIP))

printf "\n${CYAN}╔══════════════════════════════════════════════╗${RESET}\n"
printf "${CYAN}║   Integration Test Summary                   ║${RESET}\n"
printf "${CYAN}╚══════════════════════════════════════════════╝${RESET}\n"
printf "  Total:      %d\n" "$TOTAL_RAN"
printf "  ${GREEN}Passed:     %d${RESET}\n" "$TOTAL_PASS"
[[ $TOTAL_WARN -gt 0 ]] && printf "  ${YELLOW}Warnings:   %d${RESET}  ${DIM}(wrong skill or keyword-only match)${RESET}\n" "$TOTAL_WARN" || printf "  Warnings:   0\n"
[[ $TOTAL_FAIL -gt 0 ]] && printf "  ${RED}Failed:     %d${RESET}\n" "$TOTAL_FAIL"   || printf "  Failed:     0\n"
[[ $TOTAL_ERR  -gt 0 ]] && printf "  ${RED}Errors:     %d${RESET}\n" "$TOTAL_ERR"    || printf "  Errors:     0\n"
[[ $TOTAL_SKIP -gt 0 ]] && printf "  ${YELLOW}Skipped:    %d${RESET}\n" "$TOTAL_SKIP" || printf "  Skipped:    0\n"
printf "\n"

if [[ $TOTAL_FAIL -gt 0 ]]; then
    printf "  ${RED}Failed tests:${RESET}\n"
    grep "^FAIL:" "$RESULTS_FILE" | while IFS=: read -r _ test_id reason; do
        printf "    ${RED}✗${RESET} %s  (%s)\n" "$test_id" "$reason"
    done
    printf "\n"
fi

if [[ $TOTAL_WARN -gt 0 ]]; then
    printf "  ${YELLOW}Warnings:${RESET}\n"
    grep "^WARN:" "$RESULTS_FILE" | while IFS=: read -r _ test_id detail; do
        printf "    ${YELLOW}~${RESET} %s  (%s)\n" "$test_id" "$detail"
    done
    printf "\n"
fi

if [[ $TOTAL_ERR -gt 0 ]]; then
    printf "  ${RED}Error tests:${RESET}\n"
    grep "^ERROR:" "$RESULTS_FILE" | while IFS=: read -r _ test_id; do
        printf "    ${RED}!${RESET} %s\n" "$test_id"
    done
    printf "\n"
fi

printf "  Logs:   %s\n" "$LOG_DIR"
printf "  Rerun:  ./run-integration.sh --skill <name> --verbose\n\n"

if [[ $TOTAL_FAIL -eq 0 && $TOTAL_ERR -eq 0 ]]; then
    printf "  ${GREEN}${BOLD}RESULT: PASS${RESET}\n\n"
    exit 0
else
    printf "  ${RED}${BOLD}RESULT: FAIL${RESET}\n\n"
    exit 1
fi
