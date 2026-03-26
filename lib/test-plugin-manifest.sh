#!/usr/bin/env bash
# test-plugin-manifest.sh — Validate .claude-plugin/plugin.json

test_plugin_manifest() {
    local plugin_dir="$1"
    local plugin_name
    plugin_name=$(basename "$plugin_dir")
    local manifest="$plugin_dir/.claude-plugin/plugin.json"

    subsection "Manifest: $plugin_name"

    # 1. plugin.json exists
    if [[ ! -f "$manifest" ]]; then
        fail "$plugin_name: plugin.json exists" "Not found at .claude-plugin/plugin.json"
        return
    fi
    pass "$plugin_name: plugin.json exists"

    # 2. Valid JSON
    if python3 -c "import json; json.load(open('$manifest'))" 2>/dev/null; then
        pass "$plugin_name: plugin.json is valid JSON"
    else
        fail "$plugin_name: plugin.json is valid JSON" "JSON parse error"
        return
    fi

    # Helper to extract JSON fields
    json_get() {
        python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
keys = sys.argv[2].split('.')
v = d
for k in keys:
    if isinstance(v, dict):
        v = v.get(k, '')
    else:
        v = ''
        break
print(v if v else '')
" "$manifest" "$1"
    }

    # 3. Required field: name
    local manifest_name
    manifest_name=$(json_get "name")
    if [[ -n "$manifest_name" ]]; then
        pass "$plugin_name: plugin.json has name"
    else
        fail "$plugin_name: plugin.json has name" "Missing or empty"
    fi

    # 4. Name matches folder
    if [[ "$manifest_name" == "$plugin_name" ]]; then
        pass "$plugin_name: plugin.json name matches folder"
    elif [[ -n "$manifest_name" ]]; then
        warn "$plugin_name: plugin.json name matches folder" "manifest='$manifest_name' folder='$plugin_name'"
    fi

    # 5. Required field: description
    local manifest_desc
    manifest_desc=$(json_get "description")
    if [[ -n "$manifest_desc" ]]; then
        pass "$plugin_name: plugin.json has description"
    else
        fail "$plugin_name: plugin.json has description" "Missing or empty"
    fi

    # 6. Required field: version
    local manifest_version
    manifest_version=$(json_get "version")
    if [[ -n "$manifest_version" ]]; then
        pass "$plugin_name: plugin.json has version"
    else
        warn "$plugin_name: plugin.json has version" "Missing (recommended)"
    fi
}
