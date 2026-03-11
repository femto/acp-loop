# acp-loop

Recurring prompt scheduler for ACP agents. Inspired by Claude Code's `/loop` command.

## Concept

Run prompts on a recurring interval:

```bash
# Run every 5 minutes
acp-loop --interval 5m "check if deploy succeeded"

# Cron-style scheduling
acp-loop --cron "*/10 * * * *" "summarize new issues"

# Use acpx's configured/default agent
acp-loop --interval 1h "review open PRs"

# Use an acpx short alias / configured agent name
acp-loop --interval 1h -a claude "review open PRs"

# Pass a raw ACP agent command through to acpx --agent
acp-loop --interval 5m --agent "npx -y @zed-industries/claude-agent-acp" "say hello to me"

# Auto-approve permission requests for unattended runs
acp-loop --interval 5m -a claude --approve-all "check latest Twitter mentions"
```

## Use Cases

1. **Monitoring** - Periodic health checks
2. **Polling** - Watch for changes (new issues, PR updates)
3. **Scheduled tasks** - Daily summaries, weekly reports
4. **Long-running workflows** - Check progress, auto-retry failed tasks

## CLI Options

- `--interval <duration>`: Run on a fixed interval such as `30s`, `5m`, or `1h`
- `--cron <expression>`: Run on a cron schedule instead of a fixed interval
- `-a, --agent-name <name>`: Use an `acpx` short alias or configured agent name such as `claude` or `codex`
- `--agent <command>`: Pass a raw ACP agent command straight through to `acpx --agent`
- `--auth-policy <policy>`: Pass through to `acpx --auth-policy`
- `--approve-all`: Pass through to `acpx --approve-all`
- `--approve-reads`: Pass through to `acpx --approve-reads`
- `--deny-all`: Pass through to `acpx --deny-all`
- `--non-interactive-permissions <policy>`: Pass through to `acpx --non-interactive-permissions`
- `--max <n>`: Stop after `n` iterations
- `--timeout <duration>`: Stop after a total elapsed duration
- `--until <string>`: Stop when output contains a matching string
- `--quiet`: Suppress loop progress logs and stream only agent output

Agent selection rules:

- Omit both `--agent` and `-a` to use `acpx exec` with its configured default agent
- Use `-a claude` for the normal short-alias path
- Use `--agent "npx -y @zed-industries/claude-agent-acp"` when you need to pass a full custom command
- Use `--approve-all` or `--approve-reads` for unattended loops that would otherwise stop on permission prompts
- `--agent` and `-a` are mutually exclusive
- `--approve-all`, `--approve-reads`, and `--deny-all` are mutually exclusive

## Design Questions

### 1. Session Management
- New session per loop iteration? Or reuse session?
- Claude Code's /loop runs within a session
- acp-loop is a standalone CLI

### 2. Output Handling
- Log to file?
- Send to inbox?
- Conditional execution (only run if previous check found something)?

### 3. Stop Conditions
```bash
# Run until condition met
acp-loop --until "deploy succeeded" --interval 1m "check deploy status"

# Max iterations
acp-loop --max 10 --interval 5m "check status"

# Timeout
acp-loop --timeout 1h --interval 5m "monitor build"
```

## Architecture Options

### Option A: Standalone CLI
```
acp-loop
├── scheduler (cron/interval)
├── executor (calls acpx)
└── logger
```

### Option B: acpx extension
```
acpx loop --interval 5m "prompt"
```

## MVP Implementation

```typescript
// Minimal loop runner
async function loop(options: {
  interval: number;      // ms
  prompt: string;
  agent?: string;        // forwarded to acpx --agent
  agentName?: string;    // maps to acpx short alias / configured name
  maxIterations?: number;
  until?: string;        // stop condition
}) {
  let iteration = 0;
  while (true) {
    iteration++;
    
    // Run prompt via acpx
    const result = await exec(`acpx ${options.agent} exec "${options.prompt}"`);
    
    // Check stop conditions
    if (options.maxIterations && iteration >= options.maxIterations) break;
    if (options.until && result.includes(options.until)) break;
    
    // Wait for next interval
    await sleep(options.interval);
  }
}
```

## References

- Claude Code /loop: `Added /loop command to run a prompt or slash command on a recurring interval (e.g. /loop 5m check the deploy)`

## Troubleshooting

If `acp-loop` stalls at `[client] initialize (running)`, check your `acpx` config:

```bash
acpx config show
```

`acp-loop --agent <value>` now maps directly to `acpx --agent <value> exec ...`. For `acpx` short aliases such as `claude` or `codex`, use `--agent-name <name>`. If you want the default/configured `acpx` agent, omit both flags. If your `acpx` config overrides `claude` to the raw `claude` CLI command, ACP initialization will hang. Either:

```bash
# Fix the acpx config override
acpx config show

# Or bypass the override with an explicit ACP adapter command
acp-loop --interval 5m --agent "npx -y @zed-industries/claude-agent-acp" "say hello to me"
```

If a loop exits after a permission request, pass the same permission flags you would give `acpx` directly:

```bash
acp-loop --interval 5m -a claude --approve-all "check latest Twitter mentions"
acp-loop --interval 5m -a claude --approve-reads "summarize new issues"
```

## TODO

- [ ] Define CLI interface
- [ ] Implement interval scheduler
- [ ] Implement cron scheduler
- [ ] Add stop conditions
- [ ] Logging and output handling
