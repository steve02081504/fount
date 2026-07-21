import { createShellJsonNamespace } from '../../chat/src/api/client/helpers.mjs'

import { pruneMutedKeywordEntries } from './lib/contentFilter.mjs'

/**
 * @param {object} stored 原始存储
 * @returns {{ entries: object[] }} 规范化屏蔽词表
 */
function shapeMutedKeywords(stored) {
	return { entries: pruneMutedKeywordEntries(stored?.entries || []) }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @returns {{ list: Function, set: Function }} shell JSON 命名空间
 */
function mutedKeywordsNamespace(username, entityHash) {
	return createShellJsonNamespace(username, 'social', entityHash, 'muted_keywords', shapeMutedKeywords)
}

/**
 * 读取实体关键词/标签屏蔽表（本地私有，不联邦）。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @returns {Promise<{ entries: object[] }>} 屏蔽词表
 */
export async function loadMutedKeywords(username, entityHash) {
	return mutedKeywordsNamespace(username, entityHash).list()
}

/**
 * 持久化关键词屏蔽表。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {{ entries?: object[] }} data 数据
 * @returns {Promise<{ entries: object[] }>} 写入后的表
 */
export async function saveMutedKeywords(username, entityHash, data) {
	return mutedKeywordsNamespace(username, entityHash).set(shapeMutedKeywords(data || {}))
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
