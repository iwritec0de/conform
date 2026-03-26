# conform

Automated validation for Claude Code plugins and shared `.claude` configurations. Structural checks, integration tests, response logging, and linting — with a terminal UI or JSON output for CI.

## Install

```bash
npm install -g @iwritec0de/conform
# or
pnpm add -g @iwritec0de/conform
# or
yarn global add @iwritec0de/conform
```

Or run locally from the repo:

```bash
pnpm install && pnpm build
./conform ./my-plugin
```

## What It Validates

Conform works with three target types:

| Target | Detection | What's Validated |
|--------|-----------|------------------|
| **Plugin directory** | Contains `.claude-plugin/`, `skills/`, `commands/`, `agents/`, or `hooks/` | Manifest + all components |
| **`.claude` project directory** | `.claude/` folder with commands, skills, agents, or hooks inside | Components only (no manifest required) |
| **Directory of plugins** | Parent folder containing multiple plugin dirs | Each child plugin independently |

```bash
conform ./my-plugin                    # Plugin with manifest
conform structural .claude             # Validate .claude project directory
conform ./plugins/                     # Scan all plugins in a directory
conform ./plugins/ --skip drafts,wip   # Skip specific subdirectories
```

## Modes

| Mode | Description |
|------|-------------|
| `structural` | Static validation — free, instant, no API calls |
| `integration` | Integration tests against Claude API (`claude -p`) |
| `response-log` | Run user-defined prompts and capture full responses |
| `lint` | Fast structural linter with error/warning output |
| `all` | Structural + integration (default) |

```bash
conform ./my-plugin                              # Default: all (structural + integration)
conform structural ./my-plugin                   # Structural only
conform integration ./my-plugin                  # Integration only
conform response-log ./my-plugin                 # Run test-prompts.json
conform lint ./my-plugin                         # Quick lint
```

## Authentication

Integration and response-log modes need access to the Claude API. Two auth modes are supported:

| Mode | How It Works | When to Use |
|------|-------------|-------------|
| `oauth` (default) | Uses your native `claude` CLI login session | Local development, interactive use |
| `api` | Uses `ANTHROPIC_API_KEY` environment variable | CI pipelines, headless environments |

Auth is auto-detected: if `ANTHROPIC_API_KEY` is set, `api` mode is used. Otherwise falls back to `oauth`.

```bash
# Native Claude CLI (OAuth) — default
conform integration ./my-plugin
conform integration ./my-plugin --auth oauth     # Explicit

# API key
export ANTHROPIC_API_KEY=sk-ant-...
conform integration ./my-plugin --auth api

# Or inline
ANTHROPIC_API_KEY=sk-ant-... conform integration ./my-plugin
```

## Lint Rules

Validates across all plugin components:

- **Manifest** — required fields, schema compliance (`plugin.json`)
- **Skills** — folder structure, `SKILL.md` presence, frontmatter, description quality, naming (kebab-case), reserved words
- **Commands** — frontmatter or `# Title` heading, description field, file naming
- **Agents** — frontmatter fields (model, tools, description), kebab-case naming, model validation
- **Hooks** — nested format enforcement, valid event types, script existence, type field validation
- **Schema** — JSON Schema validation for `plugin.json` and `marketplace.json`
- **Misplaced files** — detects files/folders in wrong locations
- **Cross-plugin** — duplicate skill/command name detection across multiple plugins

## Component Filters

Test specific components instead of everything:

```bash
conform structural ./my-plugin --skills            # Only validate skills
conform structural ./my-plugin --hooks --commands   # Hooks and commands only
conform structural ./my-plugin --agents             # Only validate agents
conform lint ./my-plugin --skills                   # Lint skills only
```

Available filters: `--skills`, `--commands`, `--hooks`, `--agents`

When no filter is specified, all components are validated.

## Integration Options

```bash
conform integration ./my-plugin --auth api           # Use API key
conform integration ./my-plugin --auth oauth         # Use Claude CLI login
conform integration ./my-plugin --model sonnet       # Model selection (default: haiku)
conform integration ./my-plugin --max-turns 10       # Max conversation turns (default: 5)
conform integration ./my-plugin --timeout 120        # Per-test timeout in seconds (default: 60)
conform integration ./my-plugin --dry-run            # Preview test plan, no API calls
conform integration ./my-plugin --verbose            # Show full model responses
conform integration ./my-plugin --stop-on-fail       # Bail on first failure
```

## Response Log Mode

Response-log mode runs user-defined prompts against your plugin via `claude -p` and captures the full responses. Use it to verify that your skills and agents produce the expected output when triggered by real prompts.

### Skills and Agents Only

Response-log works with **skills** and **agents** — components that are triggered by natural language prompt matching. Commands (slash commands like `/deploy`) are user-initiated actions and can't be triggered through `claude -p` the same way.

For command testing, use **integration mode** instead. Integration tests use structured prompt templates that ask the model to self-report whether a command was loaded into its context (e.g. `[COMMAND_LOADED:deploy]`), without actually executing the command. This verifies that `claude -p --plugin-dir` correctly loads the command definitions.

### Creating `test-prompts.json`

Place a `test-prompts.json` file in the root of your plugin directory. The file is a JSON array of prompt objects:

```json
[
  {
    "id": "skill-data-analysis-basic",
    "component": "skill",
    "name": "data-analysis",
    "prompt": "I need to analyze data from a CSV file and create a chart showing the trends",
    "expect": {
      "responseContains": ["data", "trend"],
      "responseNotContains": ["error"]
    }
  },
  {
    "id": "agent-reviewer-trigger",
    "component": "agent",
    "name": "code-reviewer",
    "prompt": "Review the changes in this PR for security issues",
    "expect": {
      "responseContains": ["security"]
    }
  }
]
```

### Prompt Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier for the test case |
| `component` | yes | Component type: `skill` or `agent` |
| `name` | yes | Name of the component being tested |
| `prompt` | yes | Natural language prompt sent to `claude -p` — should match the component's trigger description |
| `expect` | no | Optional expectations to validate against the response |

### Expectations

The `expect` object supports these checks:

| Field | Type | Description |
|-------|------|-------------|
| `responseContains` | `string[]` | Response must contain all of these strings (case-insensitive) |
| `responseNotContains` | `string[]` | Response must not contain any of these strings (case-insensitive) |

When no `expect` is defined, conform checks that a non-empty response was returned.

### Verdicts

Each prompt gets a verdict:

| Verdict | Meaning |
|---------|---------|
| `pass` | All expectations met (or response received with no expectations) |
| `fail` | One or more expectations failed |
| `warn` | Component not loaded, or empty response with no expectations |
| `error` | Process error (timeout, auth failure, CLI not found) |
| `skip` | Dry-run mode |

### Running

```bash
conform response-log ./my-plugin                     # Auto-discover test-prompts.json from plugin
conform response-log ./my-plugin --prompts t.json    # Use an external prompts file
conform response-log ./plugins/                      # Run across all plugins with test-prompts.json
conform response-log ./my-plugin --dry-run           # Preview plan without API calls
conform response-log ./my-plugin --verbose           # Show full model responses
conform response-log ./my-plugin --model sonnet      # Use a specific model
conform response-log ./my-plugin --timeout 120       # Per-prompt timeout (default: 60s)
conform response-log ./my-plugin --stop-on-fail      # Stop on first failure
```

Results are written to a timestamped JSON file in the report directory (`./reports/` by default).

## Report Options

Generate reports after test runs:

```bash
conform ./my-plugin --report                         # HTML report (default)
conform ./my-plugin --report --report-type md        # Markdown report
conform ./my-plugin --report --report-type json      # JSON report
conform ./my-plugin --report --report-dir ./out      # Custom output directory (default: ./reports)
conform ./my-plugin --report --report-open           # Open HTML report in browser
```

## CI / JSON Output

```bash
conform lint ./my-plugin --json                      # JSON lint output
conform structural ./my-plugin --ci                  # Non-interactive output (no TUI)
conform ./my-plugin --ci --stop-on-fail              # CI mode, bail on first error
conform ./my-plugin --ci --json                      # JSON output for pipeline parsing
```

## Configuration

Optional `conform.yml` in the plugin directory or working directory:

```yaml
maxDescLength: 1024
rules:
  disable:
    - hooks/script-exists
```

Or pass config inline:

```bash
conform lint ./my-plugin --max-desc-length 2048      # Override max description length
conform lint ./my-plugin --disable hooks/script-exists,schema/marketplace
conform lint ./my-plugin --config ./custom-conform.yml
```

## All Options Reference

| Flag | Description | Default |
|------|-------------|---------|
| `--skills` | Only validate skills | all components |
| `--commands` | Only validate commands | all components |
| `--hooks` | Only validate hooks | all components |
| `--agents` | Only validate agents | all components |
| `--skip <list>` | Comma-separated directory names to skip | — |
| `--auth <mode>` | Auth mode: `api` or `oauth` | auto-detect |
| `--model <name>` | Model for integration tests | `haiku` |
| `--max-turns <n>` | Max conversation turns per test | `5` |
| `--timeout <secs>` | Per-test timeout in seconds | `60` |
| `--verbose`, `-v` | Show full model responses | off |
| `--dry-run` | Preview test plan without API calls | off |
| `--stop-on-fail` | Stop after first failure | off |
| `--report` | Generate a report file after tests | off |
| `--report-type <type>` | Report format: `html`, `md`, `json` | `html` |
| `--report-dir <path>` | Directory to write reports | `./reports` |
| `--report-open` | Open HTML report in browser | off |
| `--prompts <path>` | Path to test-prompts.json | auto-discover |
| `--json` | Output as JSON (lint and CI modes) | off |
| `--ci` | Non-interactive output for CI pipelines | off |
| `--max-desc-length <n>` | Max skill description length | `1024` |
| `--disable <rules>` | Comma-separated rule IDs to disable | — |
| `--config <path>` | Path to conform.yml config file | auto-discover |
| `--help`, `-h` | Show help message | — |
| `--version` | Show version | — |

## License

MIT
