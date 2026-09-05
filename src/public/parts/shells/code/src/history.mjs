/**
 * code shell 历史模块：原生 shell 历史解析 + 自有历史（shell/message）读写。
 * 自有历史存于工作区 `.agents/fount/code/{shell,message}_history.json`（`{ entries: string[] }`，追加序）。
 */
import { createTargetExecutor, joinWorkdir } from '../../../plugins/file-operations/src/target.mjs'

/** 自有历史相对工作区根的子目录。 */
const HISTORY_DIR = '.agents/fount/code'

/** 自有历史条目上限。 */
const HISTORY_LIMIT = 500

/**
 * 读取目标机器原生 shell 历史（本机/远程统一经 execJs 自包含 lambda）。
 * @param {string} username - 用户名。
 * @param {string} machine - 目标机器标识（"0" = 本机）。
 * @param {string} shell - shell 名。
 * @returns {Promise<string[]>} 历史条目（newest-first）。
 */
async function readNativeHistory(username, machine, shell) {
	const executor = createTargetExecutor(username, { machine })
	return await executor.execJs(async shellName => {
		const fs = await import('node:fs/promises')
		const os = await import('node:os')
		const path = await import('node:path')
		const homedir = os.homedir()
		const appdata = process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming')
		const pwsh = process.platform === 'win32'
			? path.join(appdata, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt')
			: path.join(homedir, '.local', 'share', 'powershell', 'PSReadLine', 'ConsoleHost_history.txt')
		const candidates = shellName === 'pwsh' || shellName === 'powershell' ? [pwsh]
			: shellName === 'bash' ? [path.join(homedir, '.bash_history')]
			: shellName === 'zsh' ? [path.join(homedir, '.zsh_history')]
			: [path.join(homedir, '.bash_history'), path.join(homedir, '.zsh_history'), pwsh]
		for (const file of candidates) 
			try {
				const text = await fs.readFile(file, 'utf-8')
				// 与模块原 parseHistoryLines 等价：去空行/前导空格项，zsh 处理 `: <ts>:<n>;<cmd>` 续行，去重保留最近一次
				const lines = (text || '').split(/\r?\n/)
				/** @type {string[]} */
				const entries = []
				if (shellName === 'zsh') {
					let current = ''
					for (const line of lines) {
						const match = line.match(/^:\s*\d+:(\d*);(.*)$/)
						if (match) {
							if (current) entries.push(current)
							current = match[2]
						}
						else if (line && current) current += '\n' + line
					}
					if (current) entries.push(current)
				}
				else
					for (const line of lines) {
						const trimmed = line.trim()
						if (!trimmed || /^\s/.test(line)) continue
						entries.push(trimmed)
					}
				const seen = new Set()
				/** @type {string[]} */
				const out = []
				for (let i = entries.length - 1; i >= 0; i--) {
					const entry = entries[i].trim()
					if (!entry || seen.has(entry)) continue
					seen.add(entry)
					out.push(entry)
				}
				return out
			}
			catch { /* 文件不存在等，尝试下一个 */ }
		
		return []
	}, shell)
}

/**
 * 自有历史文件路径（相对工作区根）。
 * @param {string} workdirPath - 工作区根路径。
 * @param {string} kind - 历史类型（`shell` | `message`）。
 * @returns {string} 文件路径。
 */
export function historyFilePath(workdirPath, kind) {
	return joinWorkdir(workdirPath, `${HISTORY_DIR}/${kind}_history.json`)
}

/**
 * 读取自有历史（追加序）。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}|undefined} workdir - 目标工作区。
 * @param {string} kind - 历史类型（`shell` | `message`）。
 * @returns {Promise<string[]>} 历史条目（追加序）。
 */
async function readOwnHistory(username, workdir, kind) {
	if (!workdir?.path) return []
	const executor = createTargetExecutor(username, { machine: workdir.machine ?? '0', workdir: workdir.path })
	const text = await executor.readTextFile(historyFilePath(workdir.path, kind)).catch(() => null)
	if (text == null) return []
	try {
		const data = JSON.parse(text)
		return Array.isArray(data.entries) ? data.entries : []
	}
	catch { return [] }
}

/**
 * 读取合并后的历史（自有 + 原生）。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}|undefined} workdir - 目标工作区。
 * @param {string} kind - 历史类型（`shell` | `message`）。
 * @param {string} [shell] - shell 名（kind 为 shell 时读取原生历史）。
 * @returns {Promise<{own: string[], native: string[]}>} 自有（追加序）与原生（newest-first）。
 */
export async function getHistory(username, workdir, kind, shell) {
	const own = await readOwnHistory(username, workdir, kind)
	const native = kind === 'shell' ? await readNativeHistory(username, workdir?.machine ?? '0', shell || '') : []
	return { own, native }
}

/**
 * 追加一条自有历史（去重保留最近一次，上限 HISTORY_LIMIT）。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}|undefined} workdir - 目标工作区。
 * @param {string} kind - 历史类型（`shell` | `message`）。
 * @param {string} command - 条目内容。
 * @returns {Promise<string[]>} 追加后的历史（追加序）。
 */
export async function appendOwnHistory(username, workdir, kind, command) {
	if (!workdir?.path || !command?.trim()) return []
	const executor = createTargetExecutor(username, { machine: workdir.machine ?? '0', workdir: workdir.path })
	const entries = await readOwnHistory(username, workdir, kind)
	const next = [...entries.filter(entry => entry !== command), command]
	const capped = next.slice(-HISTORY_LIMIT)
	await executor.writeTextFile(historyFilePath(workdir.path, kind), JSON.stringify({ entries: capped }, null, '\t'))
	return capped
}
