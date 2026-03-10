---
name: acp-loop
description: Recurring prompt scheduler for ACP agents. Run prompts at intervals or cron schedules.
---

# acp-loop

Run AI agent prompts on a recurring schedule.

## Installation

```bash
npm install -g acp-loop
```

## Usage

### Interval Mode
```bash
# Run every 5 minutes
acp-loop --interval 5m "check logs for errors"

# Run every 30 seconds, max 10 times
acp-loop --interval 30s --max 10 "quick status check"
```

### Cron Mode
```bash
# Daily at 3am
acp-loop --cron "0 3 * * *" "nightly cleanup"

# Every Monday at 9am
acp-loop --cron "0 9 * * 1" "weekly report"

# Every 5 minutes
acp-loop --cron "*/5 * * * *" "check status"
```

## Options

| Option | Description |
|--------|-------------|
| `--interval <duration>` | Interval between runs (30s, 5m, 1h) |
| `--cron <expression>` | Cron expression schedule |
| `--agent <name>` | Agent to use (default: codex) |
| `--max <n>` | Max iterations |
| `--timeout <duration>` | Max total run time |
| `--until <string>` | Stop when output contains string |
| `--quiet` | Minimal output |

## Notes

- `--interval` and `--cron` are mutually exclusive
- Uses `croner` library for cron (handles laptop sleep/wake better than node-cron)
- Press Ctrl+C to stop
