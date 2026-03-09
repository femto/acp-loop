# acp-loop

Recurring prompt scheduler for ACP agents. Inspired by Claude Code's `/loop` command.

## Concept

Run prompts on a recurring interval:

```bash
# Run every 5 minutes
acp-loop --interval 5m "check if deploy succeeded"

# Cron-style scheduling
acp-loop --cron "*/10 * * * *" "summarize new issues"

# With specific agent
acp-loop --interval 1h --agent codex "review open PRs"
```

## Use Cases

1. **Monitoring** - Periodic health checks
2. **Polling** - Watch for changes (new issues, PR updates)
3. **Scheduled tasks** - Daily summaries, weekly reports
4. **Long-running workflows** - Check progress, auto-retry failed tasks

## Design Questions

### 1. Session Management
- New session per loop iteration? Or reuse session?
- Claude Code's /loop runs within a session
- acp-loop could be standalone or integrate with acp-team

### 2. Integration with acp-team
```bash
# Poll for unclaimed tasks and auto-dispatch
acp-loop --interval 30s "acp-team poll"

# Watch for completed tasks
acp-loop --interval 1m "acp-team status | grep completed"
```

### 3. Output Handling
- Log to file?
- Send to inbox?
- Conditional execution (only run if previous check found something)?

### 4. Stop Conditions
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

### Option B: acp-team integration
```
acp-team watch   # already exists, similar concept
acp-team loop    # new subcommand
```

### Option C: acpx extension
```
acpx loop --interval 5m "prompt"
```

## MVP Implementation

```typescript
// Minimal loop runner
async function loop(options: {
  interval: number;      // ms
  prompt: string;
  agent?: string;        // default: codex
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
- acp-team watch: Similar polling concept for task assignment

## TODO

- [ ] Define CLI interface
- [ ] Implement interval scheduler
- [ ] Implement cron scheduler
- [ ] Add stop conditions
- [ ] Integration with acp-team
- [ ] Logging and output handling
