#!/usr/bin/env bash
# test-commands.sh — Validate commands within a plugin

test_commands() {
    local plugin_dir="$1"
    local plugin_name
    plugin_name=$(basename "$plugin_dir")

    if [[ ! -d "$plugin_dir/commands" ]]; then
        return 0
    fi

    subsection "Commands: $plugin_name"

    local cmd_count=0
    for cmd_file in "$plugin_dir/commands"/*.md; do
        [[ -f "$cmd_file" ]] || continue
        cmd_count=$((cmd_count + 1))

        local cmd_name
        cmd_name=$(basename "$cmd_file" .md)
        local test_prefix="$plugin_name/cmd:$cmd_name"

        # Commands support two formats:
        #   1. YAML frontmatter (--- delimiters with description, allowed-tools, etc.)
        #   2. Plain markdown (# Title on first line)
        # Both are valid — only validate frontmatter fields when frontmatter exists.

        if has_frontmatter_start "$cmd_file" && has_frontmatter_end "$cmd_file"; then
            pass "$test_prefix: has valid frontmatter"

            local frontmatter
            frontmatter=$(extract_frontmatter "$cmd_file")

            # Required when using frontmatter: description field
            local desc_val
            desc_val=$(get_yaml_value "description" "$frontmatter")
            if [[ -n "$desc_val" ]]; then
                pass "$test_prefix: has description"
            else
                fail "$test_prefix: has description" "Frontmatter present but description missing or empty"
            fi

            # Check allowed-tools if present
            if has_yaml_field "allowed-tools" "$frontmatter"; then
                pass "$test_prefix: has allowed-tools"
            fi
        else
            # No frontmatter — check for # Title format
            local first_line
            first_line=$(head -1 "$cmd_file")
            if [[ "$first_line" =~ ^#\  ]]; then
                pass "$test_prefix: valid command format (# Title)"
            else
                fail "$test_prefix: valid command format" "No frontmatter and no # Title heading"
            fi
        fi

        # Accumulate for cross-plugin checks
        ALL_COMMAND_NAMES+=("$cmd_name|$plugin_name")
    done

    if [[ $cmd_count -eq 0 ]]; then
        warn "$plugin_name: commands/" "Directory exists but contains no .md files"
    fi
}
