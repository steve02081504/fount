/**
 * 编辑器常用项目目录采集：VS Code 最近终端目录 + workspaceStorage + Notepad++ 会话目录。
 * 全部在目标机器上经自包含 lambda 执行（无外部引用，数据均来自目标机器环境）。
 */
import { createTargetExecutor } from '../../../plugins/file-operations/src/target.mjs'

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
	/** @type {Map<string, string>} 已收录目录：规范化路径 → 实际路径。 */
	const seen = new Map()
	/**
	 * 收录目录（stat 确认存在且为目录，规范化分隔符去重）。
	 * @param {string} p - 候选目录。
	 * @returns {Promise<void>}
	 */
	const addDir = async p => {
		if (!p) return
		const normalized = p.replace(/\\/g, '/').replace(/\/+$/, '')
		if (seen.has(normalized)) return
		try {
			const st = await fs.stat(p)
			if (!st.isDirectory()) return
		}
		catch {
			return
		}
		seen.set(normalized, p)
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
					// file:///c%3A/Users/... → C:/Users/...（Windows 盘符在 URL 中编码为 %3A，decode 后出现 `/c:/` 需去前导 `/`）
					const parsed = new URL(p)
					p = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
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
	return [...seen.values()].map(p => ({ name: path.basename(p), path: p }))
}

/**
 * 采集编辑器常用项目目录（VS Code 最近终端目录/工作区 + Notepad++ 会话目录）。
 * @param {string} username - 用户名。
 * @param {string} machine - 目标机器标识。
 * @returns {Promise<Array<{name: string, path: string}>>} 编辑器常用项目目录（执行失败时空数组）。
 */
export async function collectEditorSources(username, machine) {
	const executor = createTargetExecutor(username, { machine })
	try {
		return await executor.execJs(scanEditorSources)
	}
	catch {
		return []
	}
}
