/**
 * REPL 命令历史：持久化到 `data/log_viewer/history.json`。
 */
import fs from 'node:fs'
import path from 'node:path'

const MAX_ENTRIES = 500
const HISTORY_REL = 'data/log_viewer/history.json'

/**
 * @typedef {object} HistoryStore
 * @property {() => string[]} getEntries - 历史条目（由旧到新）。
 * @property {(entry: string) => void} push - 追加一条（去重相邻、忽略空白）。
 */

/**
 * 创建 REPL 命令历史存储（启动时从磁盘加载）。
 * @param {string} fountDir - fount 根目录。
 * @returns {HistoryStore} 历史存储。
 */
export function createHistoryStore(fountDir) {
	const filePath = path.join(fountDir, HISTORY_REL)
	/** @type {string[]} */
	let entries = []

	/**
	 * 确保历史文件所在目录存在。
	 * @returns {void}
	 */
	function ensureDir() {
		fs.mkdirSync(path.dirname(filePath), { recursive: true })
	}

	/**
	 * 从磁盘加载历史条目。
	 * @returns {void}
	 */
	function load() {
		try {
			const raw = fs.readFileSync(filePath, 'utf-8')
			entries = JSON.parse(raw).entries.map(String)
		} catch { /* 首次运行或文件损坏 */ }
	}

	/** @type {ReturnType<typeof setTimeout> | null} */
	let saveTimer = null

	/**
	 * 防抖写入历史文件（200ms）。
	 * @returns {void}
	 */
	function scheduleSave() {
		if (saveTimer) return
		saveTimer = setTimeout(() => {
			saveTimer = null
			try {
				ensureDir()
				fs.writeFileSync(filePath, `${JSON.stringify({ entries }, null, '\t')}\n`)
			} catch { /* 磁盘满等：忽略，不阻断 REPL */ }
		}, 200)
	}

	load()

	/** @returns {string[]} 历史条目（由旧到新）。 */
	function getEntries() {
		return [...entries]
	}

	/**
	 * @param {string} entry - 待追加的命令。
	 * @returns {void}
	 */
	function push(entry) {
		const trimmed = entry.trim()
		if (!trimmed) return
		if (entries[entries.length - 1] === trimmed) return
		entries.push(trimmed)
		entries = entries.slice(-MAX_ENTRIES)
		scheduleSave()
	}

	return { getEntries, push }
}
