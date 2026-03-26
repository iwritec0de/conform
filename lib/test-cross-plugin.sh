#!/usr/bin/env bash
# test-cross-plugin.sh — Cross-plugin integrity checks

test_cross_plugin() {
    section "Cross-Plugin Checks"

    # Check for duplicate skill names across plugins
    test_no_duplicate_skill_names
    test_no_duplicate_command_names
}

test_no_duplicate_skill_names() {
    if [[ ${#ALL_SKILL_NAMES[@]} -eq 0 ]]; then
        skip "cross-plugin: duplicate skill names" "No skills collected"
        return
    fi

    # Extract just the skill names and find duplicates
    local dupes
    dupes=$(printf '%s\n' "${ALL_SKILL_NAMES[@]}" | cut -d'|' -f1 | sort | uniq -d)

    if [[ -z "$dupes" ]]; then
        pass "cross-plugin: no duplicate skill names (${#ALL_SKILL_NAMES[@]} skills)"
        return
    fi

    # Report each duplicate with which plugins define it
    while IFS= read -r dupe_name; do
        [[ -z "$dupe_name" ]] && continue
        local plugins_with_dupe=""
        for entry in "${ALL_SKILL_NAMES[@]}"; do
            local sname="${entry%%|*}"
            local pname="${entry##*|}"
            if [[ "$sname" == "$dupe_name" ]]; then
                plugins_with_dupe="$plugins_with_dupe $pname"
            fi
        done
        fail "cross-plugin: duplicate skill name '$dupe_name'" "Found in:$plugins_with_dupe"
    done <<< "$dupes"
}

test_no_duplicate_command_names() {
    if [[ ${#ALL_COMMAND_NAMES[@]} -eq 0 ]]; then
        skip "cross-plugin: duplicate command names" "No commands collected"
        return
    fi

    # Commands are namespaced by plugin at runtime, so duplicates across
    # plugins are warnings, not failures. Duplicates WITHIN a plugin are failures.
    local within_plugin_dupes
    within_plugin_dupes=$(printf '%s\n' "${ALL_COMMAND_NAMES[@]}" | sort | uniq -d)

    if [[ -n "$within_plugin_dupes" ]]; then
        while IFS= read -r dupe; do
            [[ -z "$dupe" ]] && continue
            fail "cross-plugin: duplicate command" "'$dupe' appears multiple times in same plugin"
        done <<< "$within_plugin_dupes"
    fi

    # Cross-plugin: just warn about shared command names
    local cross_dupes
    cross_dupes=$(printf '%s\n' "${ALL_COMMAND_NAMES[@]}" | cut -d'|' -f1 | sort | uniq -d)

    if [[ -z "$cross_dupes" ]]; then
        pass "cross-plugin: no shared command names (${#ALL_COMMAND_NAMES[@]} commands)"
    else
        local dupe_list=""
        while IFS= read -r dupe_name; do
            [[ -z "$dupe_name" ]] && continue
            local plugins_with=""
            for entry in "${ALL_COMMAND_NAMES[@]}"; do
                local cname="${entry%%|*}"
                local pname="${entry##*|}"
                if [[ "$cname" == "$dupe_name" ]]; then
                    plugins_with="$plugins_with $pname"
                fi
            done
            dupe_list="$dupe_list $dupe_name(in$plugins_with)"
        done <<< "$cross_dupes"
        warn "cross-plugin: shared command names" "Namespaced at runtime but shared:$dupe_list"
    fi
}
