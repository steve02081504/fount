import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { set_start } from '../../src/server/base.mjs';
import { init, config } from '../../src/server/server.mjs';


// --- Server Setup ---
set_start();
const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const data_path = path.join(__dirname, '.github/workflows/default_data');

const fount_config = {
	restartor: () => process.exit(131),
	data_path: data_path,
	starts: {
		Web: true,
		Tray: false,
		DiscordIPC: false,
		Base: {
			Jobs: false,
			Timers: false,
		}
	}
};

console.log('Starting Fount server for E2E tests...');
const okey = await init(fount_config);

if (!okey) {
	console.error('Server init failed');
	process.exit(1);
}

const port = config.port;
console.log(`Fount server started on port ${port}.`);


// --- Test File Discovery ---
const changedFiles = process.argv.slice(2);
const testFilesToRun = new Set();

async function fileExists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

for (const file of changedFiles) {
	const testPath = path.dirname(file) + '/test.spec.mjs';

	if (testPath && await fileExists(testPath)) {
		testFilesToRun.add(testPath);
	}
}

const testFiles = [...testFilesToRun];

if (testFiles.length === 0) {
	console.log("No test files found for the changed files. Exiting.");
	process.exit(0);
}


// --- Test Execution ---
const commandArgs = [
	"run",
	"--allow-all",
	"npm:playwright",
	"test",
	...testFiles
];

console.log(`$ deno ${commandArgs.join(" ")}`);

const playwrightProcess = spawn("deno", commandArgs, {
	stdio: "inherit",
	env: {
		...process.env,
		E2E_TEST_PORT: String(port)
	}
});

playwrightProcess.on('exit', async (code) => {
	console.log('Playwright tests finished. Shutting down Fount server...');
	process.exit(code);
});
