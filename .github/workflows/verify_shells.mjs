import { spawn } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { exec } from 'npm:@steve02081504/exec'

import { matchGlob } from '../../src/scripts/test/launch_node.mjs'
import { __dirname, set_start } from '../../src/server/base.mjs'
import { getPartList, loadPart } from '../../src/server/parts_loader.mjs'
import { init } from '../../src/server/server.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const fount_config = {
	/**
	 * 重新启动服务器。
	 * @returns {undefined} 开始重启服务器
	 */
	restartor: () => process.exit(131),
	data_path: __dirname + '/.github/workflows/default_data',
	starts: {
		Web: false,
		Tray: false,
		DiscordRPC: false,
		Base: {
			Jobs: false,
			Timers: false,
		},
	},
}

/**
 * 解析本次应参与选 suite 的变更文件列表。
 * @returns {Promise<string[]>} 相对仓库根的路径（正斜杠）；含 `__run_all__` 表示全跑
 */
async function getChangedFiles() {
	if (process.env.FOUNT_TEST_CHANGED_FILES)
		return process.env.FOUNT_TEST_CHANGED_FILES.split('\n').map(s => s.trim()).filter(Boolean)


	if (process.env.FOUNT_TEST_RUN_ALL === '1')
		return ['__run_all__']

	const base = process.env.GITHUB_EVENT_BEFORE
	const head = process.env.GITHUB_SHA
	if (base && head && base !== '0000000000000000000000000000000000000000') {
		const out = await exec(`git diff --name-only ${base} ${head}`, { cwd: REPO_ROOT })
		if (out.code === 0) {
			const text = out.stdout.trim()
			if (text) return text.split('\n').map(s => s.replace(/\\/g, '/'))
		}
	}

	const mb = await exec('git merge-base HEAD origin/HEAD', { cwd: REPO_ROOT })
	if (mb.code === 0) {
		const mergeBase = mb.stdout.trim()
		if (mergeBase) {
			const out = await exec(`git diff --name-only ${mergeBase} HEAD`, { cwd: REPO_ROOT })
			if (out.code === 0) {
				const text = out.stdout.trim()
				if (text) return text.split('\n').map(s => s.replace(/\\/g, '/'))
			}
		}
	}

	return ['__run_all__']
}

/**
 * 读取 shell 与 p2p 的 test/manifest.json。
 * @returns {Promise<Array<{ shell: string, name: string, run: string[], triggers: string[] }>>} 全部 suite 定义
 */
async function loadAllSuites() {
	/** @type {Array<{ shell: string, name: string, run: string[], triggers: string[] }>} */
	const suites = []

	/**
	 * @param {string} shell 显示名
	 * @param {string} manifestPath manifest 绝对路径
	 */
	async function loadManifest(shell, manifestPath) {
		try {
			const raw = await readFile(manifestPath, 'utf8')
			const manifest = JSON.parse(raw)
			for (const suite of manifest.suites || [])
				suites.push({
					shell,
					name: suite.name,
					run: suite.run,
					triggers: suite.triggers || [],
				})
		}
		catch { /* no manifest */ }
	}

	const shellsDir = join(REPO_ROOT, 'src/public/parts/shells')
	const shells = await readdir(shellsDir, { withFileTypes: true })
	for (const dirent of shells) {
		if (!dirent.isDirectory()) continue
		await loadManifest(dirent.name, join(shellsDir, dirent.name, 'test', 'manifest.json'))
	}
	await loadManifest('p2p', join(REPO_ROOT, 'src/scripts/p2p/test/manifest.json'))
	return suites
}

/**
 * 按 manifest triggers 与变更文件交集选出要执行的 suite。
 * @param {string[]} changed 变更文件路径
 * @param {Array<{ shell: string, name: string, run: string[], triggers: string[] }>} allSuites 全部 suite
 * @returns {Array<{ shell: string, name: string, run: string[] }>} 待执行 suite
 */
function selectSuites(changed, allSuites) {
	if (changed.includes('__run_all__'))
		return allSuites

	const infraPaths = [
		'.github/workflows/verify_shells.mjs',
		'.github/workflows/verify_shells.yaml',
		'src/scripts/test/',
	]
	const infraHit = changed.some(f => infraPaths.some(p => f.startsWith(p.replace(/\\/g, '/'))))
	if (infraHit) return allSuites

	const manifestHit = changed.some(f => f.endsWith('/test/manifest.json'))
	if (manifestHit) return allSuites

	/** @type {Array<{ shell: string, name: string, run: string[] }>} */
	const selected = []
	for (const suite of allSuites) {
		const hit = suite.triggers.some(pat => changed.some(f => matchGlob(pat, f)))
		if (hit) selected.push(suite)
	}
	return selected
}

/**
 * 执行单个 suite 的 run 命令。
 * @param {string[]} cmd 可执行文件 + 参数
 * @returns {Promise<number>} 子进程退出码
 */
async function runSuite(cmd) {
	console.log('\n>>', cmd.join(' '))
	const [exe, ...args] = cmd
	return new Promise(resolve => {
		const child = spawn(exe, args, { cwd: REPO_ROOT, stdio: 'inherit' })
		child.on('close', code => resolve(code ?? 1))
	})
}

; (async () => {
	set_start()
	console.log('starting fount server (loadPart smoke)')
	const okey = await init(fount_config)
	if (!okey) {
		console.error('server init failed')
		process.exit(1)
	}

	const shells_list = getPartList('CI-user', 'shells')
	let exitCode = 0
	for (const shell of shells_list) try {
		await loadPart('CI-user', 'shells/' + shell)
		console.log('loaded shell:', shell)
	}
	catch (e) {
		console.error(`failed to load shell: ${shell}`)
		console.error(e)
		exitCode = 1
	}

	const changed = await getChangedFiles()
	console.log('changed files:', changed.length, changed.slice(0, 20).join(', '), changed.length > 20 ? '...' : '')

	const allSuites = await loadAllSuites()
	const selected = selectSuites(changed, allSuites)
	console.log(`selected ${selected.length}/${allSuites.length} test suites`)

	for (const suite of selected) {
		console.log(`\n=== ${suite.shell}/${suite.name} ===`)
		const code = await runSuite(suite.run)
		if (code !== 0) {
			console.error(`FAILED: ${suite.shell}/${suite.name} (exit ${code})`)
			exitCode = 1
		}
		else
			console.log(`PASSED: ${suite.shell}/${suite.name}`)

	}

	process.exit(exitCode)
})()
