#!/usr/bin/env bash
# test-hooks.sh — Validate hooks within a plugin

VALID_HOOK_EVENTS="PreToolUse PostToolUse Stop Notification SubagentStop SessionStart SessionEnd UserPromptSubmit PreCompact"

test_hooks() {
    local plugin_dir="$1"
    local project_root="${2:-$plugin_dir}"
    local plugin_name
    plugin_name=$(basename "$plugin_dir")

    local hooks_file=""

    # Check plugin-style hooks/hooks.json first
    if [[ -d "$plugin_dir/hooks" ]] && [[ -f "$plugin_dir/hooks/hooks.json" ]]; then
        hooks_file="$plugin_dir/hooks/hooks.json"
    # Fallback: settings.json with hooks key (.claude directory style)
    elif [[ -f "$plugin_dir/settings.json" ]] && python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
sys.exit(0 if 'hooks' in d else 1)
" "$plugin_dir/settings.json" 2>/dev/null; then
        hooks_file="$plugin_dir/settings.json"
    # hooks/ directory exists but no hooks.json and no settings.json hooks
    elif [[ -d "$plugin_dir/hooks" ]]; then
        subsection "Hooks: $plugin_name"
        warn "$plugin_name: hooks/" "hooks/ directory exists but no hooks.json or settings.json hooks"
        return 0
    else
        return 0
    fi

    subsection "Hooks: $plugin_name"

    # 1. hooks file exists (already validated above)
    pass "$plugin_name: hooks file exists ($(basename "$hooks_file"))"

    # 2. Valid JSON
    if python3 -c "import json; json.load(open('$hooks_file'))" 2>/dev/null; then
        pass "$plugin_name: hooks.json is valid JSON"
    else
        fail "$plugin_name: hooks.json is valid JSON" "JSON parse error"
        return
    fi

    # 3. Validate structure and events
    # Supports two hook entry formats:
    #   Flat:   { "type": "command", "command": "..." }
    #   Nested: { "matcher": "Write|Edit", "hooks": [{ "type": "command", ... }] }
    python3 -c "
import json, sys, os

import re

SHELL_SKIP = {
    'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until',
    'do', 'done', 'case', 'esac', 'in', '!', '&&', '||', ';', ';;',
    '{', '}', 'env', 'exec', 'nohup', 'sudo', 'command', 'builtin', 'time',
}

def extract_script_path(resolved):
    tokens = resolved.split()
    test_depth = 0
    paren_depth = 0
    for t in tokens:
        opens = t.count('(')
        closes = t.count(')')
        # Test expression brackets
        if test_depth == 0 and paren_depth == 0 and t in ('[', '[['):
            test_depth += 1
            continue
        if test_depth > 0:
            if t in (']', ']]') or t.endswith('];') or t.endswith(']]'):
                test_depth -= 1
            continue
        # Subshell / command substitution parens
        if opens > 0 or closes > 0:
            paren_depth = max(0, paren_depth + opens - closes)
            continue
        if paren_depth > 0:
            continue
        if t in SHELL_SKIP:
            continue
        if re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', t):
            continue
        if t.startswith('$'):
            continue
        if re.match(r'^[0-9]*>{1,2}|^<|^&>', t) or t == '/dev/null':
            continue
        if t in ('|', '&', ';'):
            continue
        if t.endswith(';') and t[:-1] in SHELL_SKIP:
            continue
        return t
    return None

def validate_hook_entry(hook, prefix, plugin_dir, errors, warnings):
    hook_type = hook.get('type', '')
    if hook_type not in ('command', 'prompt'):
        errors.append(f'{prefix}: type must be \"command\" or \"prompt\", got \"{hook_type}\"')

    if hook_type == 'command':
        cmd = hook.get('command', '')
        if not cmd:
            errors.append(f'{prefix}: command hook missing \"command\" field')
        else:
            resolved = cmd.replace('\${CLAUDE_PLUGIN_ROOT}', plugin_dir)
            resolved = resolved.replace('\$CLAUDE_PLUGIN_ROOT', plugin_dir)
            resolved = resolved.replace('\${CLAUDE_PROJECT_DIR}', project_root)
            resolved = resolved.replace('\$CLAUDE_PROJECT_DIR', project_root)
            resolved = resolved.replace('\"', '').replace(\"'\", '')
            script_path = extract_script_path(resolved)
            builtins = ('bash', 'sh', 'python3', 'python', 'node', 'echo', 'printf', 'cat', 'true', 'false', 'test')
            if script_path and script_path not in builtins:
                if not os.path.exists(script_path):
                    warnings.append(f'{prefix}: script not found: {script_path}')

    elif hook_type == 'prompt':
        if not hook.get('prompt', ''):
            errors.append(f'{prefix}: prompt hook missing \"prompt\" field')

hooks_file = sys.argv[1]
plugin_dir = sys.argv[2]
project_root = sys.argv[3]
valid_events = sys.argv[4].split()

with open(hooks_file) as f:
    data = json.load(f)

errors = []
warnings = []

if 'hooks' not in data:
    errors.append('Missing top-level \"hooks\" key')
else:
    hooks = data['hooks']
    if not isinstance(hooks, dict):
        errors.append('\"hooks\" must be an object')
    else:
        for event_name, event_hooks in hooks.items():
            if event_name not in valid_events:
                warnings.append(f'Unknown hook event: {event_name}')

            if not isinstance(event_hooks, list):
                errors.append(f'{event_name}: must be an array')
                continue

            for i, hook in enumerate(event_hooks):
                if not isinstance(hook, dict):
                    errors.append(f'{event_name}[{i}]: must be an object')
                    continue

                # Detect format: nested (has 'hooks' key) or flat (has 'type')
                if 'hooks' in hook:
                    inner_hooks = hook['hooks']
                    if not isinstance(inner_hooks, list):
                        errors.append(f'{event_name}[{i}]: nested hooks must be an array')
                        continue
                    if len(inner_hooks) == 0:
                        errors.append(f'{event_name}[{i}]: hooks array must not be empty')
                        continue
                    for j, inner in enumerate(inner_hooks):
                        if not isinstance(inner, dict):
                            errors.append(f'{event_name}[{i}].hooks[{j}]: must be an object')
                            continue
                        validate_hook_entry(inner, f'{event_name}[{i}].hooks[{j}]', plugin_dir, errors, warnings)
                else:
                    validate_hook_entry(hook, f'{event_name}[{i}]', plugin_dir, errors, warnings)

for e in errors:
    print(f'ERROR:{e}')
for w in warnings:
    print(f'WARN:{w}')
if not errors and not warnings:
    print('OK')
" "$hooks_file" "$plugin_dir" "$project_root" "$VALID_HOOK_EVENTS" | while IFS= read -r line; do
        case "$line" in
            ERROR:*)
                fail "$plugin_name: hooks structure" "${line#ERROR:}"
                ;;
            WARN:*)
                warn "$plugin_name: hooks check" "${line#WARN:}"
                ;;
            OK)
                pass "$plugin_name: hooks structure is valid"
                ;;
        esac
    done
}
