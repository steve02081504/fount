/**
 * path CLI — shellcheck 静态检查（PATH 缺失时自动下载二进制）。
 */
/* global Deno */
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'

import { assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

import { ensureShellcheck, runShellcheck } from './ensure_shellcheck.mjs'

const pathRoot = join(REPO_ROOT, 'path')

/**
 * 递归收集 path 下全部 .sh。
 * @param {string} dir 目录
 * @returns {Promise<string[]>} 绝对路径
 */
async function collectShFiles(dir) {
	/** @type {string[]} */
	const out = []
	for await (const entry of Deno.readDir(dir)) {
		const full = join(dir, entry.name)
		if (entry.isDirectory)
			out.push(...await collectShFiles(full))
		else if (entry.isFile && entry.name.endsWith('.sh'))
			out.push(full)
	}
	return out
}

/**
 * Windows 下 shellcheck 打印非 ASCII 文件名会因控制台编码崩溃；
 * 对此类文件复制到临时 ASCII 路径再检。
 * @param {string[]} files 绝对路径
 * @returns {Promise<{ checkPaths: string[], cleanup: () => Promise<void>, labelOf: (checkPath: string) => string }>} 送检路径与清理
 */
async function prepareCheckPaths(files) {
	/** @type {Map<string, string>} */
	const labels = new Map()
	/** @type {string[]} */
	const checkPaths = []
	/** @type {string | null} */
	let tempRoot = null

	for (const file of files) {
		const rel = relative(REPO_ROOT, file).replaceAll('\\', '/')
		if (!/[^\u0000-\u007f]/.test(basename(file))) {
			checkPaths.push(file)
			labels.set(file, rel)
			continue
		}
		if (!tempRoot)
			tempRoot = await mkdtemp(join(tmpdir(), 'fount-shellcheck-'))
		const safe = join(tempRoot, `${checkPaths.length}.sh`)
		await copyFile(file, safe)
		checkPaths.push(safe)
		labels.set(safe, rel)
	}

	return {
		checkPaths,
		/**
		 * @param {string} checkPath 送检路径
		 * @returns {string} 仓库相对标签
		 */
		labelOf: (checkPath) => labels.get(checkPath) ?? checkPath,
		/**
		 * @returns {Promise<void>}
		 */
		cleanup: async () => {
			if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
		},
	}
}

Deno.test('path/**/*.sh passes shellcheck', async () => {
	const exe = await ensureShellcheck()
	const files = (await collectShFiles(pathRoot)).sort()
	assertEquals(files.length > 0, true, 'expected path/**/*.sh')

	const prepared = await prepareCheckPaths(files)
	try {
		const result = await runShellcheck(exe, prepared.checkPaths, ['-f', 'gcc'])
		if (result.code !== 0) {
			const text = `${result.stdout}${result.stderr}`.trim()
			// 把临时路径映回仓库相对路径，便于读报告
			let report = text
			for (const checkPath of prepared.checkPaths) {
				const label = prepared.labelOf(checkPath)
				report = report.split(checkPath).join(label)
				report = report.split(checkPath.replaceAll('\\', '/')).join(label)
			}
			assertEquals(result.code, 0, report || 'shellcheck failed with empty output')
		}
	}
	finally {
		await prepared.cleanup()
	}
})

Deno.test('ensureShellcheck returns a working executable at latest', async () => {
	const { ensureShellcheck, readShellcheckVersion, fetchLatestShellcheckVersion, compareVersions } = await import('./ensure_shellcheck.mjs')
	const exe = await ensureShellcheck()
	const result = await runShellcheck(exe, [], ['--version'])
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.includes('ShellCheck'), true)
	const ver = await readShellcheckVersion(exe)
	const latest = await fetchLatestShellcheckVersion()
	assertEquals(ver !== null, true)
	assertEquals(compareVersions(ver, latest) >= 0, true, `have ${ver}, latest ${latest}`)
})
