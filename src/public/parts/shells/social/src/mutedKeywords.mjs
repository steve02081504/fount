import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { normalizeMutedKeywordEntry, pruneMutedKeywordEntries } from './lib/contentFilter.mjs'
import { mutedKeywordsPath } from './paths.mjs'

export { normalizeMutedKeywordEntry, pruneMutedKeywordEntries } from './lib/contentFilter.mjs'

/**
 * @returns {{ entries: object[] }} 空屏蔽词表
 */
function emptyMutedKeywords() {
	return { entries: [] }
}

/**
 * 读取实体关键词/标签屏蔽表（本地私有，不联邦）。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @returns {Promise<{ entries: object[] }>} 屏蔽词表
 */
export async function loadMutedKeywords(username, entityHash) {
	try {
		const raw = JSON.parse(await readFile(mutedKeywordsPath(username, entityHash), 'utf8'))
		const entries = pruneMutedKeywordEntries(raw?.entries || [])
		return { entries }
	}
	catch {
		return emptyMutedKeywords()
	}
}

/**
 * 持久化关键词屏蔽表。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {{ entries?: object[] }} data 数据
 * @returns {Promise<{ entries: object[] }>} 写入后的表
 */
export async function saveMutedKeywords(username, entityHash, data) {
	const entries = pruneMutedKeywordEntries(data?.entries || [])
	const path = mutedKeywordsPath(username, entityHash)
	await mkdir(`${path.replace(/[/\\][^/\\]+$/, '')}`, { recursive: true })
	const payload = { entries }
	await writeFile(path, JSON.stringify(payload, null, '\t'), 'utf8')
	return payload
}

/**
 * 覆盖或合并替换屏蔽词表。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object[]} entries 新条目
 * @returns {Promise<{ entries: object[] }>} 结果
 */
export async function replaceMutedKeywords(username, entityHash, entries) {
	return saveMutedKeywords(username, entityHash, { entries })
}
