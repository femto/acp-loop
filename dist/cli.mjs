#!/usr/bin/env node
import { spawn } from "node:child_process";
import { Command, InvalidArgumentError } from "commander";
import { Cron } from "croner";
//#region src/cli.ts
function timestamp() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
function parseDuration(value) {
	const match = /^(\d+)\s*(ms|s|m|h)$/i.exec(value.trim());
	if (!match) throw new InvalidArgumentError(`Invalid duration "${value}". Use formats like 30s, 5m, 1h.`);
	const amount = Number(match[1]);
	const unit = match[2].toLowerCase();
	switch (unit) {
		case "ms": return amount;
		case "s": return amount * 1e3;
		case "m": return amount * 6e4;
		case "h": return amount * 36e5;
		default: throw new InvalidArgumentError(`Unsupported duration unit: ${unit}`);
	}
}
function parsePositiveInt(value) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) throw new InvalidArgumentError("Value must be a positive integer.");
	return parsed;
}
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
function buildAcpxArgs(options, prompt) {
	if (options.agent) return [
		"--agent",
		options.agent,
		"exec",
		prompt
	];
	if (options.agentName) return [
		options.agentName,
		"exec",
		prompt
	];
	return ["exec", prompt];
}
function runPrompt(options, prompt, quiet) {
	return new Promise((resolve, reject) => {
		const child = spawn("acpx", buildAcpxArgs(options, prompt), { stdio: [
			"inherit",
			"pipe",
			"pipe"
		] });
		let output = "";
		child.stdout.on("data", (chunk) => {
			const text = chunk.toString();
			output += text;
			if (!quiet) process.stdout.write(text);
		});
		child.stderr.on("data", (chunk) => {
			const text = chunk.toString();
			output += text;
			if (!quiet) process.stderr.write(text);
		});
		child.once("error", reject);
		child.once("close", (code, signal) => {
			resolve({
				output,
				code,
				signal
			});
		});
	});
}
async function runLoop(prompt, options) {
	const startedAt = Date.now();
	const timeoutAt = options.timeout ? startedAt + options.timeout : void 0;
	let iteration = 0;
	let stopReason;
	let runInProgress = false;
	let scheduler;
	let timeoutHandle;
	let resolveDone;
	const done = new Promise((resolve) => {
		resolveDone = resolve;
	});
	const cleanup = () => {
		if (scheduler) {
			scheduler.stop();
			scheduler = void 0;
		}
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
			timeoutHandle = void 0;
		}
	};
	const finishIfStopped = () => {
		if (!stopReason || runInProgress) return;
		cleanup();
		resolveDone?.();
	};
	const stop = (reason) => {
		if (stopReason) return;
		stopReason = reason;
		console.log(`[${timestamp()}] stopping: ${reason}`);
		finishIfStopped();
	};
	const hasTimedOut = () => timeoutAt !== void 0 && Date.now() >= timeoutAt;
	const runIteration = async () => {
		if (stopReason) return;
		if (runInProgress) {
			if (!options.quiet) console.log(`[${timestamp()}] skipping: previous iteration still in progress`);
			return;
		}
		if (hasTimedOut()) {
			stop("timeout reached");
			return;
		}
		runInProgress = true;
		iteration += 1;
		console.log(`[${timestamp()}] iteration ${iteration}`);
		try {
			const result = await runPrompt(options, prompt, options.quiet);
			if (!options.quiet) {
				const status = result.code !== null ? `exit code ${result.code}` : `signal ${result.signal ?? "unknown"}`;
				console.log(`[${timestamp()}] iteration ${iteration} completed (${status})`);
			}
			if (options.until && result.output.includes(options.until)) stop(`matched --until "${options.until}"`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[${timestamp()}] failed to run acpx: ${message}`);
			process.exitCode = 1;
			stopReason = "acpx failed";
		} finally {
			runInProgress = false;
		}
		if (stopReason) {
			finishIfStopped();
			return;
		}
		if (options.max !== void 0 && iteration >= options.max) {
			stop(`reached --max ${options.max}`);
			return;
		}
		if (hasTimedOut()) {
			stop("timeout reached");
			return;
		}
	};
	const onSigint = () => {
		stop("interrupted");
	};
	process.on("SIGINT", onSigint);
	try {
		if (options.cron !== void 0) {
			if (hasTimedOut()) stop("timeout reached");
			else {
				if (timeoutAt !== void 0) timeoutHandle = setTimeout(() => {
					stop("timeout reached");
				}, Math.max(0, timeoutAt - Date.now()));
				scheduler = new Cron(options.cron, () => {
					runIteration();
				}, { protect: true });
			}
			await done;
		} else while (!stopReason) {
			await runIteration();
			if (stopReason) break;
			await sleep(options.interval);
		}
	} finally {
		process.off("SIGINT", onSigint);
		cleanup();
	}
}
function validateCronExpression(value) {
	try {
		new Cron(value, { paused: true }).stop();
		return;
	} catch (error) {
		return `Invalid cron expression "${value}": ${error instanceof Error ? error.message : String(error)}`;
	}
}
const program = new Command();
program.name("acp-loop").version("0.2.1").description("Run an ACP prompt on a recurring interval").argument("<prompt>", "prompt to execute").option("--interval <duration>", "interval between runs (e.g., 30s, 5m, 1h)", parseDuration).option("--cron <expression>", "cron expression schedule (e.g., \"0 3 * * *\")").option("--agent <command>", "raw ACP agent command passed through to acpx --agent").option("-a, --agent-name <name>", "acpx short alias or configured agent name (e.g., claude, codex)").option("--max <n>", "max iterations", parsePositiveInt).option("--timeout <duration>", "max total run time (e.g., 30s, 5m, 1h)", parseDuration).option("--until <string>", "stop when output contains this").option("--quiet", "minimal output", false).action(async (prompt, options) => {
	if (options.interval !== void 0 === (options.cron !== void 0)) program.error("error: specify exactly one of --interval or --cron");
	if (options.agent && options.agentName) program.error("error: specify at most one of --agent or --agent-name");
	if (options.cron) {
		const errorMessage = validateCronExpression(options.cron);
		if (errorMessage) program.error(`error: ${errorMessage}`);
	}
	await runLoop(prompt, options);
});
await program.parseAsync(process.argv);
//#endregion
export {};
