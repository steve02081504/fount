/* global Deno */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import { assert, assertEquals } from 'jsr:@std/assert'
import { execFile } from 'npm:@steve02081504/exec'

import { testDataRoot } from '../core/paths.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import { detectsZeroTests } from '../core/zero_tests.mjs'

Deno.test('detectsZeroTests flags a file that registered no tests', () => {
	assert(detectsZeroTests('running 0 tests from ./x.test.mjs\n\nok | 0 passed | 0 failed (0ms)\n'))
})

Deno.test('detectsZeroTests leaves real runs green', () => {
	assertEquals(detectsZeroTests('running 1 test from ./x.test.mjs\n\nok | 1 passed | 0 failed (1ms)\n'), false)
})

Deno.test('detectsZeroTests leaves filtered runs green', () => {
	assertEquals(
		detectsZeroTests('running 0 tests from ./x.test.mjs\n\n0 filtered out | 0 passed | 0 failed\n'),
		false,
	)
})

Deno.test('detectsZeroTests leaves ignored runs green', () => {
	assertEquals(
		detectsZeroTests('running 0 tests from ./x.test.mjs\n\n0 ignored | 0 passed | 0 failed\n'),
		false,
	)
})

Deno.test('serial.mjs fails a suite whose file registers zero tests, keeps real file green', async () => {
	const tempDir = await (async () => {
		// serial.mjs 用 toRepoRelative 归一化文件路径，临时目录必须在仓库内（data/ 已 gitignore）。
		const scratchRoot = testDataRoot(REPO_ROOT)
		await mkdir(scratchRoot, { recursive: true })
		return await mkdtemp(join(scratchRoot, 'fount-zero-tests-'))
	})()
	const failuresOut = join(tempDir, 'failures.json')
	let output = ''
	try {
		await writeFile(join(tempDir, 'empty.test.mjs'), '// no tests registered\n', 'utf8')
		await writeFile(join(tempDir, 'real.test.mjs'), 'Deno.test(\'real\', () => {})\n', 'utf8')

		const env = { ...process.env, FOUNT_TEST_KEEP_GOING: '1', FOUNT_TEST_FAILURES_OUT: failuresOut }
		delete env.FOUNT_TEST_HUB_URL
		delete env.FOUNT_TEST_MODULE_CHECK_TICKET

		const result = await execFile(Deno.execPath(), [
			'run', '--allow-scripts', '--allow-all', '-c', './deno.json',
			join(REPO_ROOT, 'src/scripts/test/deno/serial.mjs'),
			tempDir,
		], {
			cwd: REPO_ROOT,
			env,
			no_output_record: true,
			/**
			 * @param {string | Uint8Array} data stdout 片段
			 * @returns {void}
			 */
			on_stdout: data => { output += String(data) },
			/**
			 * @param {string | Uint8Array} data stderr 片段
			 * @returns {void}
			 */
			on_stderr: data => { output += String(data) },
		})

		assertEquals(result.code, 1)
		assert(output.includes('empty.test.mjs'), `missing empty.test.mjs in output:\n${output}`)
		assert(
			/\[serial\] ok [^\n]*real\.test\.mjs/.test(output),
			`real file not reported ok:\n${output}`,
		)

		const failures = JSON.parse(await readFile(failuresOut, 'utf8'))
		assert(failures.some(path => path.includes('empty.test.mjs')), `empty file not in failures: ${failures}`)
	}
	finally {
		await rm(tempDir, { recursive: true, force: true })
	}
})
