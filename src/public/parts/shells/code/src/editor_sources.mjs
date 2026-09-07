/**
 * 编辑器常用项目目录采集：VS Code 最近终端目录 + workspaceStorage + Notepad++ 会话目录。
 * 全部在目标机器上经自包含 lambda 执行（无外部引用，数据均来自目标机器环境）。
 */
import process from 'node:process'

import { memoizePromise } from '../../../../../scripts/memo.mjs'
import { ms } from '../../../../../scripts/ms.mjs'
import { createTargetExecutor } from '../../../plugins/file-operations/src/target.mjs'

/** 编辑器常用项目缓存 TTL（毫秒）：扫描目标是慢速 execJs 磁盘遍历，短 TTL 缓存让打开工作区选择器秒出。 */
const EDITOR_SOURCES_TTL_MS = ms('5m')

/**
 * 自包含扫描函数（在目标机器执行）：枚举 VS Code 数据目录与 Notepad++ 会话，返回编辑器常用项目目录。
 * @returns {Promise<Array<{name: string, path: string}>>} 编辑器常用项目目录（已 stat 确认存在）。
 */
async function scanEditorSources() {
	const fs = await import('node:fs/promises')
	const os = await import('node:os')
	const path = await import('node:path')
	const process = await import('node:process')
	const decoder = new TextDecoder()
	/** @type {Map<string, {path: string, lastActive: number}>} 已收录目录：realpath → {实际路径, 最后活跃时间}。 */
	const seen = new Map()
	/** 递归遍历时跳过的目录名（避免扫 node_modules 等大目录）。 */
	const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', '__pycache__', 'target', 'bin', 'obj', '.gradle', 'Library'])
	/**
	 * 计算目录树内最后的修改时间（有限深度，跳过 SKIP_DIRS）。
	 * @param {string} dir - 目录路径。
	 * @param {number} [depth=0] - 当前深度。
	 * @returns {Promise<number>} 最后 mtime（毫秒）。
	 */
	async function lastActiveOf(dir, depth = 0) {
		let max = 0
		try {
			max = (await fs.stat(dir)).mtimeMs || 0
		}
		catch { return max }
		if (depth >= 2) return max
		let entries
		try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return max }
		for (const e of entries) {
			if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue
			try {
				const full = path.join(dir, e.name)
				const st = await fs.stat(full)
				if (st.mtimeMs > max) max = st.mtimeMs
				if (e.isDirectory()) {
					const sub = await lastActiveOf(full, depth + 1)
					if (sub > max) max = sub
				}
			}
			catch { /* 单个条目不可读则跳过 */ }
		}
		return max
	}
	/**
	 * 收录目录（stat 确认存在且为目录，按 realpath 去重；同一真实目录只保留更短的路径名）。
	 * @param {string} p - 候选目录。
	 * @returns {Promise<void>}
	 */
	const addDir = async p => {
		if (!p) return
		let real
		try {
			const st = await fs.stat(p)
			if (!st.isDirectory()) return
			real = (await fs.realpath(p)).replace(/\\/g, '/').replace(/\/+$/, '')
		}
		catch {
			return
		}
		const existing = seen.get(real)
		if (existing !== undefined) {
			if (p.length < existing.path.length) seen.set(real, { path: p, lastActive: existing.lastActive })
			return
		}
		seen.set(real, { path: p, lastActive: await lastActiveOf(p) })
	}
	// VS Code 及 fork 变体的用户数据目录候选名（数据文件同构：User/globalStorage/state.vscdb + User/workspaceStorage）
	const names = [
		'Code', 'Code - Insiders', 'VSCodium', 'VSCodium Insiders',
		'Cursor', 'Cursor - Insiders', 'Windsurf', 'Trae', 'Trae CN',
	]
	/** @type {string[]} */
	const candidates = []
	if (process.platform === 'win32' && process.env.APPDATA)
		for (const name of names)
			candidates.push(path.join(process.env.APPDATA, name))
	else if (process.platform === 'darwin')
		for (const name of names)
			candidates.push(path.join(os.homedir(), 'Library', 'Application Support', name))
	else
		for (const name of names)
			candidates.push(path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), name))
	for (const userDataDir of candidates) {
		// 最近终端目录（state.vscdb 的 terminal.history.entries.dirs，有序）
		const dbPath = path.join(userDataDir, 'User', 'globalStorage', 'state.vscdb')
		let db
		try {
			if (await fs.access(dbPath).then(() => true, () => false)) {
				const { DatabaseSync } = await import('node:sqlite')
				db = new DatabaseSync(dbPath, { readOnly: true })
				const rows = db.prepare('SELECT value FROM ItemTable WHERE key = ?').all('terminal.history.entries.dirs')
				for (const row of rows) 
					try {
						const parsed = JSON.parse(typeof row.value === 'string' ? row.value : decoder.decode(row.value))
						for (const entry of parsed.entries || [])
							await addDir(entry?.key)
					}
					catch { /* 单条历史目录损坏则跳过 */ }
			}
		}
		catch { /* vscdb 被占用/损坏则静默跳过 */ }
		finally {
			try { db?.close() } catch { /* 已关闭 */ }
		}
		// workspaceStorage：遍历 <hash>/workspace.json 的 folder 键（file:// URL 解码）
		const storageRoot = path.join(userDataDir, 'User', 'workspaceStorage')
		let hashes
		try { hashes = await fs.readdir(storageRoot) } catch { continue }
		for (const hash of hashes) 
			try {
				const data = JSON.parse(await fs.readFile(path.join(storageRoot, hash, 'workspace.json'), 'utf8'))
				if (typeof data?.folder !== 'string') continue
				let p = data.folder
				try {
					// file:///c%3A/Users/... → C:/Users/...（Windows 盘符在 URL 中编码为 %3A，decode 后出现 `/c:/`，需剥掉盘符前的根斜杠；Unix 路径原样保留绝对路径）
					const parsed = new URL(p)
					p = decodeURIComponent(parsed.pathname)
					if (process.platform === 'win32') p = p.replace(/^\/+/, '')
				}
				catch {
					// 非 file:// 或非法 URL：当作字面路径
					try { p = decodeURIComponent(p) } catch { /* 保留原文 */ }
				}
				await addDir(p)
			}
			catch { /* 单个 hash 目录异常则跳过 */ }
		
	}
	// Notepad++（仅 Windows）：session.xml 的文件条目，stat 确认是目录
	if (process.platform === 'win32' && process.env.APPDATA) {
		const sessionPath = path.join(process.env.APPDATA, 'Notepad++', 'session.xml')
		try {
			const xml = await fs.readFile(sessionPath, 'utf8')
			for (const match of xml.matchAll(/filename="([^"]*)"/g))
				await addDir(match[1])
		}
		catch { /* 无 Notepad++ 会话文件则跳过 */ }
	}
	// JetBrains 家族（Android Studio / IntelliJ IDEA / PyCharm / WebStorm / GoLand / CLion / DataGrip / PhpStorm / Rider…）：
	// 扫 Google/ 与 JetBrains/ 下每个产品子目录的 options/recentProjects.xml（格式同构，无需枚举产品名）
	const jetbrainsRoots = []
	if (process.platform === 'win32' && process.env.APPDATA) {
		jetbrainsRoots.push(path.join(process.env.APPDATA, 'Google'))
		jetbrainsRoots.push(path.join(process.env.APPDATA, 'JetBrains'))
	}
	else if (process.platform === 'darwin') {
		const base = path.join(os.homedir(), 'Library', 'Application Support')
		jetbrainsRoots.push(path.join(base, 'Google'))
		jetbrainsRoots.push(path.join(base, 'JetBrains'))
	}
	else {
		const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
		jetbrainsRoots.push(path.join(base, 'Google'))
		jetbrainsRoots.push(path.join(base, 'JetBrains'))
	}
	for (const root of jetbrainsRoots) {
		let dirs
		try { dirs = await fs.readdir(root) } catch { continue }
		for (const dir of dirs) 
			try {
				const xml = await fs.readFile(path.join(root, dir, 'options', 'recentProjects.xml'), 'utf8')
				for (const match of xml.matchAll(/<entry key="([^"]*)"/g)) {
					const expanded = match[1].replace(/\$USER_HOME\$/g, os.homedir())
					if (/\$[A-Z_0-9]+\$/.test(expanded)) continue // 其余宏（如 $APPLICATION_HOME_DIR$）无法可靠展开，跳过
					await addDir(expanded)
				}
			}
			catch { /* 无 recentProjects.xml 则跳过该产品目录 */ }
	}
	return [...seen.values()]
		.sort((a, b) => b.lastActive - a.lastActive)
		.map(({ path: p }) => ({ name: path.basename(p), path: p }))
}

/** 编辑器常用项目采集（TTL 缓存，键 = `username\0machine\0环境指纹`）。 */
const loadEditorSources = memoizePromise(
	key => key,
	async key => {
		const [username, machine] = key.split('\u0000')
		const executor = createTargetExecutor(username, { machine })
		try {
			return await executor.execJs(scanEditorSources)
		}
		catch {
			return []
		}
	},
	{ ttlMs: EDITOR_SOURCES_TTL_MS },
)

/**
 * 采集编辑器常用项目目录（VS Code 最近终端目录/工作区 + Notepad++ 会话目录）。
 * @param {string} username - 用户名。
 * @param {string} machine - 目标机器标识。
 * @returns {Promise<Array<{name: string, path: string}>>} 编辑器常用项目目录（执行失败时空数组）。
 */
export function collectEditorSources(username, machine) {
	// 键附编辑器数据根环境指纹：同进程内 APPDATA/XDG_CONFIG_HOME 可能切换（测试隔离），避免跨环境串缓存
	const envRoot = process.env.APPDATA || process.env.XDG_CONFIG_HOME || ''
	return loadEditorSources(`${username}\u0000${machine}\u0000${envRoot}`)
}
