#!/usr/bin/env node
import { spawn } from "node:child_process";
import { Command, InvalidArgumentError } from "commander";
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
function runPrompt(agent, prompt, quiet) {
	return new Promise((resolve, reject) => {
		const child = spawn("acpx", [
			agent,
			"exec",
			prompt
		], { stdio: [
			"ignore",
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
	let stopRequested = false;
	process.on("SIGINT", () => {
		stopRequested = true;
	});
	while (true) {
		if (stopRequested) {
			console.log(`[${timestamp()}] stopping: interrupted`);
			break;
		}
		if (timeoutAt !== void 0 && Date.now() >= timeoutAt) {
			console.log(`[${timestamp()}] stopping: timeout reached`);
			break;
		}
		iteration += 1;
		console.log(`[${timestamp()}] iteration ${iteration}`);
		try {
			const result = await runPrompt(options.agent, prompt, options.quiet);
			if (!options.quiet) {
				const status = result.code !== null ? `exit code ${result.code}` : `signal ${result.signal ?? "unknown"}`;
				console.log(`[${timestamp()}] iteration ${iteration} completed (${status})`);
			}
			if (options.until && result.output.includes(options.until)) {
				console.log(`[${timestamp()}] stopping: matched --until "${options.until}"`);
				break;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[${timestamp()}] failed to run acpx: ${message}`);
			process.exitCode = 1;
			break;
		}
		if (options.max !== void 0 && iteration >= options.max) {
			console.log(`[${timestamp()}] stopping: reached --max ${options.max}`);
			break;
		}
		if (timeoutAt !== void 0 && Date.now() >= timeoutAt) {
			console.log(`[${timestamp()}] stopping: timeout reached`);
			break;
		}
		await sleep(options.interval);
	}
}
const program = new Command();
program.name("acp-loop").description("Run an ACP prompt on a recurring interval").argument("<prompt>", "prompt to execute").requiredOption("--interval <duration>", "interval between runs (e.g., 30s, 5m, 1h)", parseDuration).option("--agent <name>", "agent to use", "codex").option("--max <n>", "max iterations", parsePositiveInt).option("--timeout <duration>", "max total run time (e.g., 30s, 5m, 1h)", parseDuration).option("--until <string>", "stop when output contains this").option("--quiet", "minimal output", false).action(async (prompt, options) => {
	await runLoop(prompt, options);
});
await program.parseAsync(process.argv);
//#endregion
export {};
