#!/usr/bin/env bash
# common.sh — Shared utilities for Claude Test Suite

# Counters
TOTAL=0
PASSED=0
FAILED=0
SKIPPED=0
WARNINGS=0
HAS_FAILURES=0

# Accumulator arrays for cross-plugin checks
ALL_SKILL_NAMES=()
ALL_COMMAND_NAMES=()

# Colors (disabled if not a terminal)
if [[ -t 1 ]]; then
    GREEN='\033[0;32m'
    RED='\033[0;31m'
    YELLOW='\033[0;33m'
    CYAN='\033[0;36m'
    RESET='\033[0m'
else
    GREEN='' RED='' YELLOW='' CYAN='' RESET=''
fi

pass() {
    TOTAL=$((TOTAL + 1))
    PASSED=$((PASSED + 1))
    printf "${GREEN}ok %d${RESET} - %s\n" "$TOTAL" "$1"
}

fail() {
    TOTAL=$((TOTAL + 1))
    FAILED=$((FAILED + 1))
    HAS_FAILURES=1
    if [[ -n "${2:-}" ]]; then
        printf "${RED}not ok %d${RESET} - %s ${RED}# %s${RESET}\n" "$TOTAL" "$1" "$2"
    else
        printf "${RED}not ok %d${RESET} - %s\n" "$TOTAL" "$1"
    fi
}

warn() {
    TOTAL=$((TOTAL + 1))
    WARNINGS=$((WARNINGS + 1))
    printf "${YELLOW}ok %d${RESET} - %s ${YELLOW}# WARN: %s${RESET}\n" "$TOTAL" "$1" "$2"
}

skip() {
    TOTAL=$((TOTAL + 1))
    SKIPPED=$((SKIPPED + 1))
    printf "${CYAN}ok %d${RESET} - %s ${CYAN}# SKIP: %s${RESET}\n" "$TOTAL" "$1" "$2"
}

section() {
    printf "\n${CYAN}# === %s ===${RESET}\n" "$1"
}

subsection() {
    printf "${CYAN}# --- %s ---${RESET}\n" "$1"
}

# Extract YAML frontmatter (between first --- and second ---)
# Usage: extract_frontmatter <file>
# Outputs frontmatter lines (without delimiters) to stdout
extract_frontmatter() {
    local file="$1"
    local in_frontmatter=0
    local line_num=0

    while IFS= read -r line; do
        line_num=$((line_num + 1))
        if [[ "$line" == "---" ]]; then
            if [[ $in_frontmatter -eq 0 ]]; then
                in_frontmatter=1
                continue
            else
                return 0
            fi
        fi
        if [[ $in_frontmatter -eq 1 ]]; then
            printf '%s\n' "$line"
        fi
    done < "$file"
}

# Check if first line of file is ---
has_frontmatter_start() {
    local first_line
    first_line=$(head -1 "$1")
    [[ "$first_line" == "---" ]]
}

# Check if file has closing --- delimiter
has_frontmatter_end() {
    local count
    count=$(grep -c '^---$' "$1" 2>/dev/null || true)
    [[ $count -ge 2 ]]
}

# Get a simple YAML scalar value
# Handles: key: value, key: "value", and >- multi-line blocks
get_yaml_value() {
    local key="$1"
    local frontmatter="$2"
    local value=""
    local in_multiline=0

    while IFS= read -r line; do
        if [[ $in_multiline -eq 1 ]]; then
            # Multi-line continuation: indented lines
            if [[ "$line" =~ ^[[:space:]]{2,} ]]; then
                local trimmed="${line#"${line%%[![:space:]]*}"}"
                if [[ -n "$value" ]]; then
                    value="$value $trimmed"
                else
                    value="$trimmed"
                fi
                continue
            else
                # No longer indented — done with multi-line
                break
            fi
        fi

        if [[ "$line" =~ ^${key}:[[:space:]]*(.*) ]]; then
            value="${BASH_REMATCH[1]}"
            # Strip quotes
            value="${value%\"}"
            value="${value#\"}"
            value="${value%\'}"
            value="${value#\'}"
            # Check for multi-line indicator
            if [[ "$value" == ">-" || "$value" == ">" || "$value" == "|" || "$value" == "|-" ]]; then
                value=""
                in_multiline=1
                continue
            fi
            break
        fi
    done <<< "$frontmatter"

    printf '%s' "$value"
}

# Get a nested YAML value (e.g., metadata.author)
get_nested_yaml_value() {
    local parent="$1"
    local child="$2"
    local frontmatter="$3"
    local in_parent=0

    while IFS= read -r line; do
        if [[ "$line" =~ ^${parent}: ]]; then
            in_parent=1
            continue
        fi
        if [[ $in_parent -eq 1 ]]; then
            if [[ "$line" =~ ^[[:space:]]+${child}:[[:space:]]*(.*) ]]; then
                local value="${BASH_REMATCH[1]}"
                value="${value%\"}"
                value="${value#\"}"
                printf '%s' "$value"
                return 0
            fi
            # If we hit a non-indented line, we've left the parent block
            if [[ ! "$line" =~ ^[[:space:]] ]]; then
                return 1
            fi
        fi
    done <<< "$frontmatter"
    return 1
}

# Check if string is kebab-case
is_kebab_case() {
    [[ "$1" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]
}

# Count characters in a string
char_count() {
    printf '%s' "$1" | wc -c | tr -d ' '
}

# Count words in file body (after frontmatter)
body_word_count() {
    local file="$1"
    local past_frontmatter=0
    local delimiter_count=0

    {
        while IFS= read -r line; do
            if [[ "$line" == "---" ]]; then
                delimiter_count=$((delimiter_count + 1))
                if [[ $delimiter_count -ge 2 ]]; then
                    past_frontmatter=1
                    continue
                fi
                continue
            fi
            if [[ $past_frontmatter -eq 1 ]]; then
                printf '%s\n' "$line"
            fi
        done < "$file"
    } | wc -w | tr -d ' '
}

# Check if a YAML list field exists in frontmatter
has_yaml_field() {
    local key="$1"
    local frontmatter="$2"
    grep -q "^${key}:" <<< "$frontmatter"
}

# Print test summary
print_summary() {
    printf "\n${CYAN}# ===========================================${RESET}\n"
    printf "${CYAN}# Test Summary${RESET}\n"
    printf "${CYAN}# ===========================================${RESET}\n"
    printf "# Total:    %d\n" "$TOTAL"
    printf "# ${GREEN}Passed:   %d${RESET}\n" "$PASSED"
    if [[ $FAILED -gt 0 ]]; then
        printf "# ${RED}Failed:   %d${RESET}\n" "$FAILED"
    else
        printf "# Failed:   %d\n" "$FAILED"
    fi
    if [[ $WARNINGS -gt 0 ]]; then
        printf "# ${YELLOW}Warnings: %d${RESET}\n" "$WARNINGS"
    else
        printf "# Warnings: %d\n" "$WARNINGS"
    fi
    printf "# Skipped:  %d\n" "$SKIPPED"
    printf "${CYAN}# ===========================================${RESET}\n"

    if [[ $HAS_FAILURES -eq 1 ]]; then
        printf "\n${RED}RESULT: FAIL${RESET}\n"
    else
        printf "\n${GREEN}RESULT: PASS${RESET}\n"
    fi
}
