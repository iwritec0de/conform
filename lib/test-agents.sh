#!/usr/bin/env bash
# test-agents.sh — Validate agents within a plugin

test_agents() {
    local plugin_dir="$1"
    local plugin_name
    plugin_name=$(basename "$plugin_dir")

    if [[ ! -d "$plugin_dir/agents" ]]; then
        return 0
    fi

    subsection "Agents: $plugin_name"

    local agent_count=0
    for agent_file in "$plugin_dir/agents"/*.md; do
        [[ -f "$agent_file" ]] || continue
        agent_count=$((agent_count + 1))

        local agent_filename
        agent_filename=$(basename "$agent_file" .md)
        local test_prefix="$plugin_name/agent:$agent_filename"

        # 1. Has frontmatter delimiters
        if has_frontmatter_start "$agent_file" && has_frontmatter_end "$agent_file"; then
            pass "$test_prefix: has valid frontmatter"
        else
            fail "$test_prefix: has valid frontmatter" "Missing --- delimiters"
            continue
        fi

        local frontmatter
        frontmatter=$(extract_frontmatter "$agent_file")

        # 2. Required: name field
        local name_val
        name_val=$(get_yaml_value "name" "$frontmatter")
        if [[ -n "$name_val" ]]; then
            pass "$test_prefix: has name field"
        else
            fail "$test_prefix: has name field" "Missing or empty"
        fi

        # 3. Required: description (agent descriptions can be long)
        local desc_val
        desc_val=$(get_yaml_value "description" "$frontmatter")
        if [[ -n "$desc_val" ]]; then
            pass "$test_prefix: has description"
        else
            fail "$test_prefix: has description" "Missing or empty"
        fi

        # 4. Required: model field
        local model_val
        model_val=$(get_yaml_value "model" "$frontmatter")
        if [[ -n "$model_val" ]]; then
            case "$model_val" in
                sonnet|opus|haiku)
                    pass "$test_prefix: has valid model ($model_val)"
                    ;;
                *)
                    warn "$test_prefix: model value" "Got '$model_val' — expected sonnet, opus, or haiku"
                    ;;
            esac
        else
            fail "$test_prefix: has model field" "Missing or empty"
        fi

        # 5. Required: tools field
        if has_yaml_field "tools" "$frontmatter"; then
            pass "$test_prefix: has tools field"
        else
            fail "$test_prefix: has tools field" "Missing"
        fi

        # 6. Name is kebab-case
        if [[ -n "$name_val" ]] && is_kebab_case "$name_val"; then
            pass "$test_prefix: name is kebab-case"
        elif [[ -n "$name_val" ]]; then
            fail "$test_prefix: name is kebab-case" "Got '$name_val'"
        fi

        # 7. No XML angle brackets in frontmatter (excluding YAML scalar indicators >- | |-)
        # Filter out YAML multi-line indicators (>-, >, |-, |) before checking
        local fm_stripped
        fm_stripped=$(echo "$frontmatter" | sed -E 's/: *>-?$//' | sed -E 's/: *\|-?$//')
        if echo "$fm_stripped" | grep -q '[<>]'; then
            warn "$test_prefix: XML brackets in frontmatter" "Found < or > — may cause issues"
        fi

        # 8. Has body content (system prompt)
        local wc
        wc=$(body_word_count "$agent_file")
        if [[ $wc -gt 0 ]]; then
            pass "$test_prefix: has body content ($wc words)"
        else
            warn "$test_prefix: has body content" "Agent has no system prompt body"
        fi
    done

    if [[ $agent_count -eq 0 ]]; then
        warn "$plugin_name: agents/" "Directory exists but contains no .md files"
    fi
}
