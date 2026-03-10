#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { Command, InvalidArgumentError } from 'commander';
import { Cron } from 'croner';

type LoopOptions = {
  interval?: number;
  cron?: string;
  agent: string;
  max?: number;
  timeout?: number;
  until?: string;
  quiet: boolean;
};

function timestamp(): string {
  return new Date().toISOString();
}

function parseDuration(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h)$/i.exec(value.trim());
  if (!match) {
    throw new InvalidArgumentError(
      `Invalid duration "${value}". Use formats like 30s, 5m, 1h.`,
    );
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'ms':
      return amount;
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60_000;
    case 'h':
      return amount * 3_600_000;
    default:
      throw new InvalidArgumentError(`Unsupported duration unit: ${unit}`);
  }
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Value must be a positive integer.');
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runPrompt(
  agent: string,
  prompt: string,
  quiet: boolean,
): Promise<{ output: string; code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('acpx', [agent, 'exec', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      if (!quiet) {
        process.stdout.write(text);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      if (!quiet) {
        process.stderr.write(text);
      }
    });

    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({ output, code, signal });
    });
  });
}

async function runLoop(prompt: string, options: LoopOptions): Promise<void> {
  const startedAt = Date.now();
  const timeoutAt = options.timeout ? startedAt + options.timeout : undefined;
  let iteration = 0;
  let stopReason: string | undefined;
  let runInProgress = false;
  let scheduler: Cron | undefined;
  let timeoutHandle: NodeJS.Timeout | undefined;
  let resolveDone: (() => void) | undefined;

  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const cleanup = () => {
    if (scheduler) {
      scheduler.stop();
      scheduler = undefined;
    }
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
  };

  const finishIfStopped = () => {
    if (!stopReason || runInProgress) {
      return;
    }
    cleanup();
    resolveDone?.();
  };

  const stop = (reason: string) => {
    if (stopReason) {
      return;
    }
    stopReason = reason;
    console.log(`[${timestamp()}] stopping: ${reason}`);
    finishIfStopped();
  };

  const hasTimedOut = () => timeoutAt !== undefined && Date.now() >= timeoutAt;

  const runIteration = async () => {
    if (stopReason) {
      return;
    }
    if (runInProgress) {
      if (!options.quiet) {
        console.log(`[${timestamp()}] skipping: previous iteration still in progress`);
      }
      return;
    }
    if (hasTimedOut()) {
      stop('timeout reached');
      return;
    }

    runInProgress = true;
    iteration += 1;
    console.log(`[${timestamp()}] iteration ${iteration}`);

    try {
      const result = await runPrompt(options.agent, prompt, options.quiet);

      if (!options.quiet) {
        const status =
          result.code !== null ? `exit code ${result.code}` : `signal ${result.signal ?? 'unknown'}`;
        console.log(`[${timestamp()}] iteration ${iteration} completed (${status})`);
      }

      if (options.until && result.output.includes(options.until)) {
        stop(`matched --until "${options.until}"`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${timestamp()}] failed to run acpx: ${message}`);
      process.exitCode = 1;
      stopReason = 'acpx failed';
    } finally {
      runInProgress = false;
    }

    if (stopReason) {
      finishIfStopped();
      return;
    }

    if (options.max !== undefined && iteration >= options.max) {
      stop(`reached --max ${options.max}`);
      return;
    }

    if (hasTimedOut()) {
      stop('timeout reached');
      return;
    }
  };

  const onSigint = () => {
    stop('interrupted');
  };
  process.on('SIGINT', onSigint);

  try {
    if (options.cron !== undefined) {
      if (hasTimedOut()) {
        stop('timeout reached');
      } else {
        if (timeoutAt !== undefined) {
          timeoutHandle = setTimeout(() => {
            stop('timeout reached');
          }, Math.max(0, timeoutAt - Date.now()));
        }
        scheduler = new Cron(options.cron, () => {
          void runIteration();
        }, { protect: true });
      }

      await done;
    } else {
      while (!stopReason) {
        await runIteration();
        if (stopReason) {
          break;
        }
        await sleep(options.interval!);
      }
    }
  } finally {
    process.off('SIGINT', onSigint);
    cleanup();
  }
}

function validateCronExpression(value: string): string | undefined {
  try {
    const validator = new Cron(value, { paused: true });
    validator.stop();
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Invalid cron expression "${value}": ${message}`;
  }
}

const program = new Command();

program
  .name('acp-loop')
  .version('0.2.0')
  .description('Run an ACP prompt on a recurring interval')
  .argument('<prompt>', 'prompt to execute')
  .option('--interval <duration>', 'interval between runs (e.g., 30s, 5m, 1h)', parseDuration)
  .option('--cron <expression>', 'cron expression schedule (e.g., "0 3 * * *")')
  .option('--agent <name>', 'agent to use', 'codex')
  .option('--max <n>', 'max iterations', parsePositiveInt)
  .option('--timeout <duration>', 'max total run time (e.g., 30s, 5m, 1h)', parseDuration)
  .option('--until <string>', 'stop when output contains this')
  .option('--quiet', 'minimal output', false)
  .action(async (prompt: string, options: LoopOptions) => {
    const hasInterval = options.interval !== undefined;
    const hasCron = options.cron !== undefined;
    if (hasInterval === hasCron) {
      program.error('error: specify exactly one of --interval or --cron');
    }
    if (options.cron) {
      const errorMessage = validateCronExpression(options.cron);
      if (errorMessage) {
        program.error(`error: ${errorMessage}`);
      }
    }
    await runLoop(prompt, options);
  });

await program.parseAsync(process.argv);
