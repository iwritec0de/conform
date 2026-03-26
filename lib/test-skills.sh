#!/usr/bin/env bash
# test-skills.sh — Validate skills within a plugin

test_skills() {
    local plugin_dir="$1"
    local plugin_name
    plugin_name=$(basename "$plugin_dir")

    if [[ ! -d "$plugin_dir/skills" ]]; then
        return 0
    fi

    subsection "Skills: $plugin_name"

    local skill_count=0
    for skill_dir in "$plugin_dir/skills"/*/; do
        [[ -d "$skill_dir" ]] || continue
        skill_count=$((skill_count + 1))

        local folder_name
        folder_name=$(basename "$skill_dir")
        local test_prefix="$plugin_name/$folder_name"

        # 1. SKILL.md exists (case-sensitive, even on case-insensitive filesystems)
        local actual_name=""
        actual_name=$(ls "$skill_dir" 2>/dev/null | grep -i '^skill\.md$' | head -1 || true)
        if [[ "$actual_name" == "SKILL.md" ]]; then
            pass "$test_prefix: SKILL.md exists"
        elif [[ -n "$actual_name" ]]; then
            fail "$test_prefix: SKILL.md exists" "Found '$actual_name' instead of 'SKILL.md' (must be uppercase)"
            continue
        else
            fail "$test_prefix: SKILL.md exists" "File not found"
            continue  # Can't test further without the file
        fi

        local skill_file="$skill_dir/SKILL.md"

        # 2. Folder name is kebab-case
        if is_kebab_case "$folder_name"; then
            pass "$test_prefix: folder is kebab-case"
        else
            fail "$test_prefix: folder is kebab-case" "Got '$folder_name'"
        fi

        # 3. Frontmatter delimiters
        if has_frontmatter_start "$skill_file" && has_frontmatter_end "$skill_file"; then
            pass "$test_prefix: valid frontmatter delimiters"
        else
            fail "$test_prefix: valid frontmatter delimiters" "Missing --- delimiters"
            continue
        fi

        local frontmatter
        frontmatter=$(extract_frontmatter "$skill_file")

        # 4. Required field: name
        local name_val
        name_val=$(get_yaml_value "name" "$frontmatter")
        if [[ -n "$name_val" ]]; then
            pass "$test_prefix: has name field"
        else
            fail "$test_prefix: has name field" "Missing or empty"
        fi

        # 5. Required field: description
        local desc_val
        desc_val=$(get_yaml_value "description" "$frontmatter")
        if [[ -n "$desc_val" ]]; then
            pass "$test_prefix: has description field"
        else
            fail "$test_prefix: has description field" "Missing or empty"
        fi

        # 6. name matches folder name
        if [[ "$name_val" == "$folder_name" ]]; then
            pass "$test_prefix: name matches folder"
        else
            fail "$test_prefix: name matches folder" "name='$name_val' folder='$folder_name'"
        fi

        # 7. name is kebab-case
        if [[ -n "$name_val" ]] && is_kebab_case "$name_val"; then
            pass "$test_prefix: name is kebab-case"
        elif [[ -n "$name_val" ]]; then
            fail "$test_prefix: name is kebab-case" "Got '$name_val'"
        fi

        # 8. Description under 1024 characters
        if [[ -n "$desc_val" ]]; then
            local desc_len
            desc_len=$(char_count "$desc_val")
            if [[ $desc_len -le 1024 ]]; then
                pass "$test_prefix: description under 1024 chars ($desc_len)"
            else
                fail "$test_prefix: description under 1024 chars" "Got $desc_len characters"
            fi
        fi

        # 9. No XML angle brackets in frontmatter
        # Filter out YAML multi-line indicators (>-, >, |-, |) before checking
        local frontmatter_stripped
        frontmatter_stripped=$(echo "$frontmatter" | sed -E 's/: *>-?$//' | sed -E 's/: *\|-?$//')
        if echo "$frontmatter_stripped" | grep -q '[<>]'; then
            fail "$test_prefix: no XML brackets in frontmatter" "Found < or > in frontmatter"
        else
            pass "$test_prefix: no XML brackets in frontmatter"
        fi

        # 10. No "claude" or "anthropic" in skill name
        if [[ -n "$name_val" ]]; then
            local name_lower
            name_lower=$(echo "$name_val" | tr '[:upper:]' '[:lower:]')
            if [[ "$name_lower" == *claude* ]] || [[ "$name_lower" == *anthropic* ]]; then
                fail "$test_prefix: no reserved words in name" "Contains 'claude' or 'anthropic'"
            else
                pass "$test_prefix: no reserved words in name"
            fi
        fi

        # 11. No README.md inside skill folder
        if [[ -f "$skill_dir/README.md" ]]; then
            fail "$test_prefix: no README.md in skill folder" "README.md should not be inside skill folders"
        else
            pass "$test_prefix: no README.md in skill folder"
        fi

        # 12. Optional fields: license
        if has_yaml_field "license" "$frontmatter"; then
            pass "$test_prefix: has license field"
        else
            warn "$test_prefix: has license field" "Missing (recommended)"
        fi

        # 13. Optional fields: metadata.author
        local author_val
        author_val=$(get_nested_yaml_value "metadata" "author" "$frontmatter" 2>/dev/null || true)
        if [[ -n "$author_val" ]]; then
            pass "$test_prefix: has metadata.author"
        else
            warn "$test_prefix: has metadata.author" "Missing (recommended)"
        fi

        # 14. Optional fields: metadata.version
        local version_val
        version_val=$(get_nested_yaml_value "metadata" "version" "$frontmatter" 2>/dev/null || true)
        if [[ -n "$version_val" ]]; then
            pass "$test_prefix: has metadata.version"
        else
            warn "$test_prefix: has metadata.version" "Missing (recommended)"
        fi

        # 15. Body word count under 5,000
        local wc
        wc=$(body_word_count "$skill_file")
        if [[ $wc -le 5000 ]]; then
            pass "$test_prefix: body under 5000 words ($wc)"
        else
            fail "$test_prefix: body under 5000 words" "Got $wc words"
        fi

        # 16. Resource directories not empty
        for res_dir in "references" "reference" "scripts" "assets"; do
            if [[ -d "$skill_dir/$res_dir" ]]; then
                local file_count
                file_count=$(find "$skill_dir/$res_dir" -type f 2>/dev/null | wc -l | tr -d ' ')
                if [[ $file_count -gt 0 ]]; then
                    pass "$test_prefix: $res_dir/ is not empty ($file_count files)"
                else
                    fail "$test_prefix: $res_dir/ is not empty" "Empty directory — remove or populate"
                fi
            fi
        done

        # 17. Description quality: contains trigger phrases
        if [[ -n "$desc_val" ]]; then
            if echo "$desc_val" | grep -qi "when\|trigger\|use\|asks\|mention"; then
                pass "$test_prefix: description has trigger conditions"
            else
                warn "$test_prefix: description has trigger conditions" "No trigger phrases detected"
            fi
        fi

        # Accumulate for cross-plugin checks
        ALL_SKILL_NAMES+=("$name_val|$plugin_name")
    done

    if [[ $skill_count -eq 0 ]]; then
        warn "$plugin_name: skills/" "Directory exists but contains no skill subdirectories"
    fi
}
