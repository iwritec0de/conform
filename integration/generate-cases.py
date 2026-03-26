#!/usr/bin/env python3
"""Generate integration test cases from plugin components.

Scans plugins for skills, commands, and hooks, then writes cases.json
for the integration test runners.

Usage:
  python3 generate-cases.py [output-file] [options]

  --plugins-dir <path>    Directory containing plugins (default: ../../)
  --skip <csv>            Comma-separated plugin dirs to skip
  --types <csv>           Component types to generate: skills,commands,hooks (default: all)
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

DEFAULT_SKIP = {"conform", ".claude", "claude-plugin-marketplace"}
SCRIPT_DIR = Path(__file__).parent


def classify_plugin(plugin_dir: Path) -> tuple[str, Path]:
    """Classify a plugin directory and return (plugin_type, component_root).

    Returns:
        ("plugin", root)     — has .claude-plugin/plugin.json, components at root
        ("project", .claude/) — .claude/ dir with commands/skills/agents/hooks
        ("standalone", root)  — bare component dirs (skills/, commands/, etc.) at root
        ("none", root)        — not a recognized plugin structure
    """
    # .claude-plugin/ manifest — full plugin
    if (plugin_dir / ".claude-plugin").is_dir():
        return ("plugin", plugin_dir)

    # .claude/ project dir with components inside
    claude_dir = plugin_dir / ".claude"
    if claude_dir.is_dir():
        for d in ("commands", "skills", "agents", "hooks"):
            if (claude_dir / d).is_dir():
                return ("project", claude_dir)
        if (claude_dir / "settings.json").exists():
            return ("project", claude_dir)

    # Bare component dirs at root (standalone)
    for d in ("skills", "commands", "agents", "hooks"):
        if (plugin_dir / d).is_dir():
            return ("standalone", plugin_dir)

    return ("none", plugin_dir)


def extract_frontmatter(filepath: Path) -> str:
    """Extract YAML frontmatter between --- delimiters."""
    lines = filepath.read_text().splitlines()
    if not lines or lines[0] != "---":
        return ""
    fm_lines = []
    for line in lines[1:]:
        if line == "---":
            break
        fm_lines.append(line)
    return "\n".join(fm_lines)


def get_yaml_value(key: str, frontmatter: str) -> str:
    """Get a YAML scalar value, handling >- multi-line blocks."""
    lines = frontmatter.splitlines()
    value = ""
    in_multiline = False

    for i, line in enumerate(lines):
        if in_multiline:
            if line and line[0] in (" ", "\t"):
                trimmed = line.strip()
                value = f"{value} {trimmed}" if value else trimmed
                continue
            else:
                break

        match = re.match(rf"^{re.escape(key)}:\s*(.*)", line)
        if match:
            val = match.group(1).strip().strip('"').strip("'")
            if val in (">-", ">", "|", "|-"):
                in_multiline = True
                continue
            value = val
            break

    return value


def extract_trigger_phrases(desc: str) -> list[str]:
    """Extract all quoted trigger phrases from description."""
    phrases = re.findall(r'"([^"]+)"', desc)
    if not phrases:
        phrases = re.findall(r"'([^']+)'", desc)
    # Filter to reasonable length and minimum length (under 60, at least 8 chars)
    # Very short triggers like "ESP32" don't work well as prompts
    good = [p for p in phrases if 8 <= len(p) < 60]
    short = [p for p in phrases if len(p) < 8]
    return good + short  # Prefer longer triggers, keep short as fallback


def extract_keywords(filepath: Path, description: str, name: str) -> list[str]:
    """Extract domain keywords from name, description, and body headings."""
    STOPWORDS = {
        "this", "that", "with", "from", "when", "what", "your", "about",
        "should", "must", "have", "been", "will", "also", "example",
        "examples", "usage", "overview", "notes", "step", "steps",
        "important", "reference", "related", "additional", "resources",
        "workflow", "skill", "used", "user", "asks", "mentions", "provides",
        "trigger", "guidance", "help", "need", "want", "like", "code",
        "file", "project", "create", "build", "make", "best", "practices",
        "comprehensive", "including", "specific", "based",
    }

    keywords = set()

    # 1. Name parts (e.g. "docker-compose" → "docker", "compose")
    for part in name.split("-"):
        if len(part) >= 3 and part not in STOPWORDS:
            keywords.add(part)

    # 2. Domain terms from description (4+ char words, skip stopwords)
    for word in re.findall(r"[a-zA-Z]{4,}", description):
        w = word.lower()
        if w not in STOPWORDS:
            keywords.add(w)

    # 3. H2/H3 headings from body
    text = filepath.read_text()
    parts = text.split("---", 2)
    body = parts[2] if len(parts) >= 3 else text

    for heading in re.findall(r"^#{2,3}\s+(.+)", body, re.MULTILINE):
        for word in re.findall(r"[a-zA-Z]{4,}", heading):
            w = word.lower()
            if w not in STOPWORDS:
                keywords.add(w)

    name_parts = {p for p in name.split("-") if len(p) >= 3}
    ordered = sorted(name_parts & keywords) + sorted(keywords - name_parts)
    return ordered[:12]


# ── Skill cases ──────────────────────────────────────────────────────

def generate_skill_cases(plugins_dir: Path, skip_dirs: set[str]) -> list[dict]:
    cases = []
    for plugin_dir in sorted(plugins_dir.iterdir()):
        if not plugin_dir.is_dir():
            continue
        plugin_name = plugin_dir.name
        if plugin_name in skip_dirs or plugin_name.startswith("."):
            continue

        plugin_type, component_root = classify_plugin(plugin_dir)
        if plugin_type == "none":
            continue

        skills_dir = component_root / "skills"
        if not skills_dir.is_dir():
            continue

        for skill_dir in sorted(skills_dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            skill_file = skill_dir / "SKILL.md"
            if not skill_file.exists():
                continue

            fm = extract_frontmatter(skill_file)
            skill_name = get_yaml_value("name", fm)
            desc = get_yaml_value("description", fm)
            if not skill_name or not desc:
                continue

            triggers = extract_trigger_phrases(desc)
            if not triggers:
                first_sentence = desc.split(".")[0] if "." in desc else desc[:80]
                first_sentence = re.sub(
                    r"^This skill should be used when the user (?:asks to |mentions |asks about )",
                    "",
                    first_sentence,
                    flags=re.IGNORECASE,
                )
                triggers = [first_sentence.strip().strip('"')]

            # Ensure trigger is a natural prompt (expand very short triggers)
            primary = triggers[0]
            if len(primary) < 12:
                # Short triggers like "ESP32" — make into a natural question
                primary = f"I'm working with {primary} and need help"

            keywords = extract_keywords(skill_file, desc, skill_name)

            cases.append({
                "type": "skill",
                "plugin": plugin_name,
                "plugin_type": plugin_type,
                "name": skill_name,
                "trigger": primary,
                "all_triggers": triggers[:3],
                "keywords": keywords,
                # Legacy compat
                "skill": skill_name,
            })

    return cases


# ── Command cases ────────────────────────────────────────────────────

# Sample values for common argument placeholder names
SAMPLE_ARG_VALUES = {
    "resource": "users",
    "route_or_resource": "users",
    "target": "localhost",
    "container_name_or_id": "my-app",
    "type": "feature",
    "description": "add-login",
    "version": "minor",
    "name": "api-server",
    "service": "api",
    "path": "src/",
    "dir": "src/",
    "file": "config.yaml",
    "base": "main",
    "tool": "nmap",
    "ports": "80,443",
    "extra": "-v",
}

# Fallback: generic sample for unknown arg names
DEFAULT_SAMPLE = "example"


def generate_sample_args(argument_hint: str) -> str:
    """Generate realistic sample arguments from an argument-hint string.

    Handles these patterns:
      <required>                       → sample value from lookup
      <choice1|choice2|choice3>        → first choice
      [--flag choice1|choice2]         → --flag firstchoice
      [--flag <value>]                 → --flag samplevalue
      [--boolean]                      → --boolean
      [subcmd1|subcmd2]                → first subcmd
    """
    if not argument_hint:
        return ""

    parts = []

    # Split into required part (outside []) and optional parts (inside [])
    required_part = re.sub(r"\[.*?\]", "", argument_hint).strip()

    # Required args: <name> or <choice1|choice2|choice3>
    for match in re.finditer(r"<([^>]+)>", required_part):
        inner = match.group(1)
        if "|" in inner:
            # Choice arg like <version|major|minor|patch> — pick first
            parts.append(inner.split("|")[0])
        else:
            arg_name = inner.lower()
            sample = SAMPLE_ARG_VALUES.get(arg_name, DEFAULT_SAMPLE)
            parts.append(sample)

    # Optional blocks: each [...] group
    for opt_match in re.finditer(r"\[([^\]]+)\]", argument_hint):
        opt = opt_match.group(1).strip()

        # [--flag choice1|choice2] — flag with choices
        flag_choice = re.match(r"--(\w+)\s+(\w+(?:\|\w+)+)$", opt)
        if flag_choice:
            flag = flag_choice.group(1)
            choices = flag_choice.group(2).split("|")
            parts.append(f"--{flag} {choices[0]}")
            continue

        # [--flag <val1|val2>] — flag with choice inside angle brackets
        flag_choice_angle = re.match(r"--(\w+)\s+<([^>]+\|[^>]+)>", opt)
        if flag_choice_angle:
            flag = flag_choice_angle.group(1)
            choices = flag_choice_angle.group(2).split("|")
            parts.append(f"--{flag} {choices[0]}")
            continue

        # [--flag <value>] — flag with a value placeholder
        flag_val = re.match(r"--(\w+)\s+<(\w+)>", opt)
        if flag_val:
            flag = flag_val.group(1)
            val_name = flag_val.group(2).lower()
            # Check flag name first (e.g. --tool <name> → lookup "tool"), then placeholder
            sample = SAMPLE_ARG_VALUES.get(flag, SAMPLE_ARG_VALUES.get(val_name, DEFAULT_SAMPLE))
            parts.append(f"--{flag} {sample}")
            continue

        # [--boolean] — bare boolean flag
        flag_bool = re.match(r"--(\w+)$", opt)
        if flag_bool:
            parts.append(f"--{flag_bool.group(1)}")
            continue

        # [subcmd1|subcmd2] — subcommand choices (no --)
        if "|" in opt and not opt.startswith("-"):
            # Pick the first simple word choice
            choices = [c.strip() for c in opt.split("|")]
            simple = [c for c in choices if re.match(r"^\w+$", c)]
            if simple:
                parts.append(simple[0])
            continue

    return " ".join(parts)


def generate_command_cases(plugins_dir: Path, skip_dirs: set[str]) -> list[dict]:
    """Generate test cases for slash commands.

    For each command, the test verifies that invoking `/command-name` (or a
    natural-language equivalent) produces a response that acknowledges the
    command's purpose. Commands with argument-hint get tested with sample args.
    """
    cases = []
    for plugin_dir in sorted(plugins_dir.iterdir()):
        if not plugin_dir.is_dir():
            continue
        plugin_name = plugin_dir.name
        if plugin_name in skip_dirs or plugin_name.startswith("."):
            continue

        plugin_type, component_root = classify_plugin(plugin_dir)
        if plugin_type == "none":
            continue

        commands_dir = component_root / "commands"
        if not commands_dir.is_dir():
            continue

        for cmd_file in sorted(commands_dir.iterdir()):
            if not cmd_file.is_file() or cmd_file.suffix != ".md":
                continue

            cmd_slug = cmd_file.stem  # e.g. "audit" from "audit.md"
            text = cmd_file.read_text()

            # Extract command name/description from frontmatter or # Title
            fm = extract_frontmatter(cmd_file)
            if fm:
                cmd_name = get_yaml_value("name", fm) or cmd_slug
                cmd_desc = get_yaml_value("description", fm) or ""
                arg_hint = get_yaml_value("argument-hint", fm) or ""
            else:
                lines = text.splitlines()
                first_line = lines[0] if lines else ""
                if first_line.startswith("# "):
                    cmd_name = first_line[2:].strip()
                else:
                    cmd_name = cmd_slug
                cmd_desc = ""
                arg_hint = ""

            # Strip surrounding quotes from argument-hint
            arg_hint = arg_hint.strip('"').strip("'")

            # Build trigger — slash command with sample args if available
            sample_args = generate_sample_args(arg_hint)
            trigger_bare = f"/{cmd_slug}"
            trigger_with_args = f"/{cmd_slug} {sample_args}".strip() if sample_args else trigger_bare

            # Keywords from command name and description
            keywords = set()
            for part in cmd_slug.split("-"):
                if len(part) >= 3:
                    keywords.add(part.lower())
            for part in cmd_name.lower().split():
                if len(part) >= 3:
                    keywords.add(part)
            if cmd_desc:
                for word in re.findall(r"[a-zA-Z]{4,}", cmd_desc):
                    keywords.add(word.lower())
            # Also grab from first few headings in body
            for heading in re.findall(r"^#{1,3}\s+(.+)", text, re.MULTILINE)[:5]:
                for word in re.findall(r"[a-zA-Z]{4,}", heading):
                    keywords.add(word.lower())

            cases.append({
                "type": "command",
                "plugin": plugin_name,
                "plugin_type": plugin_type,
                "name": cmd_name,
                "command": cmd_slug,
                "argument_hint": arg_hint or None,
                "sample_args": sample_args or None,
                "trigger": trigger_with_args,
                "all_triggers": [trigger_with_args, trigger_bare] if sample_args else [trigger_bare],
                "keywords": sorted(keywords)[:12],
                # Legacy compat
                "skill": f"cmd:{cmd_slug}",
            })

    return cases


# ── Hook cases ───────────────────────────────────────────────────────

def generate_hook_cases(plugins_dir: Path, skip_dirs: set[str]) -> list[dict]:
    """Generate test cases for hooks.

    Hook testing validates that hooks.json is well-formed and that hook
    scripts exist and are executable. This generates metadata for the
    integration runner to perform basic invocation checks.
    """
    cases = []
    for plugin_dir in sorted(plugins_dir.iterdir()):
        if not plugin_dir.is_dir():
            continue
        plugin_name = plugin_dir.name
        if plugin_name in skip_dirs or plugin_name.startswith("."):
            continue

        plugin_type, component_root = classify_plugin(plugin_dir)
        if plugin_type == "none":
            continue

        hooks_file = component_root / "hooks" / "hooks.json"
        if not hooks_file.exists():
            continue

        try:
            hooks_data = json.loads(hooks_file.read_text())
        except json.JSONDecodeError:
            continue

        hooks_section = hooks_data.get("hooks", {})
        for event_type, entries in hooks_section.items():
            if not isinstance(entries, list):
                continue

            for i, entry in enumerate(entries):
                # Flat format: {type, command/prompt}
                # Nested format: {matcher, hooks: [{type, command/prompt}]}
                hook_type = entry.get("type", "nested")
                if hook_type in ("command", "prompt"):
                    hook_items = [entry]
                    matcher = "*"
                else:
                    matcher = entry.get("matcher", "*")
                    hook_items = entry.get("hooks", [])

                for j, hook in enumerate(hook_items):
                    h_type = hook.get("type", "unknown")
                    label = f"{event_type}[{i}]"
                    if len(hook_items) > 1:
                        label += f".{j}"

                    # Extract script path if command type
                    script = ""
                    if h_type == "command":
                        cmd = hook.get("command", "")
                        # Extract script filename
                        parts = cmd.split()
                        script = parts[-1] if parts else cmd

                    keywords = [
                        event_type.lower(),
                        matcher.lower(),
                        h_type,
                        plugin_name,
                    ]
                    if script:
                        keywords.append(Path(script).stem)

                    cases.append({
                        "type": "hook",
                        "plugin": plugin_name,
                        "plugin_type": plugin_type,
                        "name": f"{plugin_name}:{label}",
                        "event": event_type,
                        "matcher": matcher,
                        "hook_type": h_type,
                        "script": script,
                        "trigger": f"Hook {event_type} ({matcher}) in {plugin_name}",
                        "all_triggers": [],
                        "keywords": keywords,
                        "skill": f"hook:{event_type}:{matcher}",
                    })

    return cases


# ── Agent cases ──────────────────────────────────────────────────────

def generate_agent_cases(plugins_dir: Path, skip_dirs: set[str]) -> list[dict]:
    """Generate test cases for agents.

    Scans <plugin>/agents/ directories for .md files, extracts frontmatter
    (name, description), trigger phrases, and keywords.
    """
    cases = []
    for plugin_dir in sorted(plugins_dir.iterdir()):
        if not plugin_dir.is_dir():
            continue
        plugin_name = plugin_dir.name
        if plugin_name in skip_dirs or plugin_name.startswith("."):
            continue

        plugin_type, component_root = classify_plugin(plugin_dir)
        if plugin_type == "none":
            continue

        agents_dir = component_root / "agents"
        if not agents_dir.is_dir():
            continue

        for agent_file in sorted(agents_dir.iterdir()):
            if not agent_file.is_file() or agent_file.suffix != ".md":
                continue

            fm = extract_frontmatter(agent_file)
            agent_name = get_yaml_value("name", fm) or agent_file.stem
            desc = get_yaml_value("description", fm) or ""
            if not agent_name:
                continue

            triggers = extract_trigger_phrases(desc)
            if not triggers:
                first_sentence = desc.split(".")[0] if "." in desc else desc[:80]
                first_sentence = re.sub(
                    r"^This agent should be used when the user (?:asks to |mentions |asks about )",
                    "",
                    first_sentence,
                    flags=re.IGNORECASE,
                )
                triggers = [first_sentence.strip().strip('"')] if first_sentence.strip() else [f"help with {agent_name}"]

            primary = triggers[0]
            if len(primary) < 12:
                primary = f"I'm working with {primary} and need help"

            keywords = extract_keywords(agent_file, desc, agent_name)

            cases.append({
                "type": "agent",
                "plugin": plugin_name,
                "plugin_type": plugin_type,
                "name": agent_name,
                "trigger": primary,
                "all_triggers": triggers[:3],
                "keywords": keywords,
                # Legacy compat
                "skill": f"agent:{agent_name}",
            })

    return cases


# ── Main ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate integration test cases")
    parser.add_argument("output", nargs="?", default=str(SCRIPT_DIR / "cases.json"),
                        help="Output file path (default: cases.json)")
    parser.add_argument("--plugins-dir", default=str(SCRIPT_DIR.parent.parent),
                        help="Directory containing plugins")
    parser.add_argument("--skip", default="",
                        help="Comma-separated plugin dirs to skip")
    parser.add_argument("--types", default="skills,commands,hooks,agents",
                        help="Component types to generate (default: skills,commands,hooks,agents)")

    args = parser.parse_args()

    plugins_dir = Path(args.plugins_dir).resolve()
    skip_dirs = DEFAULT_SKIP | set(filter(None, args.skip.split(",")))
    types = set(args.types.split(","))

    cases = []
    if "skills" in types:
        cases.extend(generate_skill_cases(plugins_dir, skip_dirs))
    if "commands" in types:
        cases.extend(generate_command_cases(plugins_dir, skip_dirs))
    if "hooks" in types:
        cases.extend(generate_hook_cases(plugins_dir, skip_dirs))
    if "agents" in types:
        cases.extend(generate_agent_cases(plugins_dir, skip_dirs))

    with open(args.output, "w") as f:
        json.dump(cases, f, indent=2)

    # Summary by type and plugin_type
    type_counts = {}
    ptype_counts = {}
    for c in cases:
        t = c.get("type", "skill")
        type_counts[t] = type_counts.get(t, 0) + 1
        pt = c.get("plugin_type", "unknown")
        ptype_counts[pt] = ptype_counts.get(pt, 0) + 1

    parts = [f"{count} {typ}s" for typ, count in sorted(type_counts.items())]
    pparts = [f"{count} {pt}" for pt, count in sorted(ptype_counts.items())]
    print(f"Generated {len(cases)} test cases ({', '.join(parts)}) [{', '.join(pparts)}] → {args.output}")


if __name__ == "__main__":
    main()
