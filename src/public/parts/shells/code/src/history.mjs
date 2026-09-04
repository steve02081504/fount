/**
 * code shell 历史模块：原生 shell 历史解析 + 自有历史（shell/message）读写。
 * 自有历史存于工作区 `.agents/fount/code/{shell,message}_history.json`（`{ entries: string[] }`，追加序）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createTargetExecutor, joinWorkdir } from '../../../plugins/file-operations/src/target.mjs'

/** 自有历史相对工作区根的子目录。 */
const HISTORY_DIR = '.agents/fount/code'

/** 自有历史条目上限。 */
const HISTORY_LIMIT = 500

/**
 * 本机原生历史候选路径（按 shell 类型）。
 * @param {string} shell - shell 名。
 * @param {string} homedir - 家目录。
 * @param {string} appdata - Windows APPDATA（或回退家目录）。
 * @returns {string[]} 候选文件路径。
 */
function nativeHistoryCandidates(shell, homedir, appdata) {
	const pwsh = process.platform === 'win32'
		? path.join(appdata, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt')
		: path.join(homedir, '.local', 'share', 'powershell', 'PSReadLine', 'ConsoleHost_history.txt')
	if (shell === 'pwsh' || shell === 'powershell') return [pwsh]
	if (shell === 'bash') return [path.join(homedir, '.bash_history')]
	if (shell === 'zsh') return [path.join(homedir, '.zsh_history')]
	return [path.join(homedir, '.bash_history'), path.join(homedir, '.zsh_history'), pwsh]
}

/**
 * 远程原生历史候选相对路径（经远程 shell `cat ~/…` 尽力读取）。
 * @param {string} shell - shell 名。
 * @returns {string[]} 候选路径。
 */
function nativeHistoryRemoteCandidates(shell) {
	if (shell === 'pwsh' || shell === 'powershell')
		return ['.local/share/powershell/PSReadLine/ConsoleHost_history.txt', 'AppData/Roaming/Microsoft/Windows/PowerShell/PSReadLine/ConsoleHost_history.txt']
	if (shell === 'bash') return ['.bash_history']
	if (shell === 'zsh') return ['.zsh_history']
	return ['.bash_history', '.zsh_history', '.local/share/powershell/PSReadLine/ConsoleHost_history.txt']
}

/**
 * 解析历史文件文本（去空行/前导空格项；zsh 处理 `: <ts>:<n>;<cmd>` 与多行续行）。
 * 结果去重保留最近一次，返回 newest-first。
 * @param {string} text - 文件内容。
 * @param {string} shell - shell 名。
 * @returns {string[]} 历史条目（newest-first）。
 */
function parseHistoryLines(text, shell) {
	const lines = (text || '').split(/\r?\n/)
	/** @type {string[]} */
	const entries = []
	if (shell === 'zsh') {
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

/**
 * 读取目标机器原生 shell 历史（本机用 fs；远程尽力经 shell `cat ~/…`）。
 * @param {string} username - 用户名。
 * @param {string} machine - 目标机器标识（"0" = 本机）。
 * @param {string} shell - shell 名。
 * @returns {Promise<string[]>} 历史条目（newest-first）。
 */
async function readNativeHistory(username, machine, shell) {
	if (String(machine) === '0') {
		const homedir = os.homedir()
		const appdata = process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming')
		for (const file of nativeHistoryCandidates(shell, homedir, appdata)) 
			try {
				return parseHistoryLines(await fs.promises.readFile(file, 'utf-8'), shell)
			}
			catch { /* 文件不存在等，尝试下一个 */ }
		
		return []
	}
	const executor = createTargetExecutor(username, { machine })
	for (const rel of nativeHistoryRemoteCandidates(shell)) 
		try {
			const result = await executor.execShell(null, `cat ~/${rel} 2>/dev/null`)
			if (result && !result.code && typeof result.stdout === 'string' && result.stdout.trim())
				return parseHistoryLines(result.stdout, shell)
		}
		catch { /* 继续尝试 */ }
	
	return []
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