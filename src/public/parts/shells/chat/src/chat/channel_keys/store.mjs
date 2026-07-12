import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { unwrapChannelKey } from 'npm:@steve02081504/fount-p2p/crypto/channel'
import { normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'
import { isPlainObject } from 'npm:@steve02081504/fount-p2p/wire/ingress'
import { readLocalSignerSeed } from '../dag/localSigner.mjs'
import { channelKeysPath } from '../lib/paths.mjs'

const MAX_GENERATIONS = 64

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {() => Promise<void>} fn 临界区
 * @returns {Promise<void>}
 */
async function withGroupChannelKeysLock(username, groupId, fn) {
	return withAsyncMutex(`channel-keys:${username}:${groupId}`, fn)
}

/**
 * @typedef {{ current: number, generations: Array<{ gen: number, keyHex: string }> }} ChannelKeyEntry
 * @typedef {{ channels: Record<string, ChannelKeyEntry> }} ChannelKeysFile
 */

/**
 * @param {unknown} raw 磁盘 JSON
 * @returns {ChannelKeysFile} 规范化结构
 */
function normalizeFile(raw) {
	/** @type {Record<string, { current: number, generations: Array<{ gen: number, keyHex: string }> }>} */
	const channels = {}
	for (const [channelId, row] of Object.entries(raw?.channels || {})) {
		const generations = (row?.generations || [])
			.filter(g => g?.keyHex && Number.isFinite(g.gen))
			.sort((a, b) => a.gen - b.gen)
			.slice(-MAX_GENERATIONS)
		channels[channelId] = {
			current: generations.length ? generations.at(-1).gen : -1,
			generations,
		}
	}
	return { channels }
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<ChannelKeysFile>} 频道密钥文件
 */
export async function loadChannelKeysFile(username, groupId) {
	try {
		return normalizeFile(JSON.parse(await readFile(channelKeysPath(username, groupId), 'utf8')))
	}
	catch {
		return { channels: {} }
	}
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {ChannelKeysFile} data 待写入数据
 * @returns {Promise<void>} 无返回值
 */
async function saveChannelKeysFile(username, groupId, data) {
	const path = channelKeysPath(username, groupId)
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, JSON.stringify(data, null, 2), 'utf8')
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {number} [generation] 指定代际，默认当前代
 * @returns {Promise<string | null>} K_ch hex
 */
export async function getChannelKeyHex(username, groupId, channelId, generation = null) {
	const file = await loadChannelKeysFile(username, groupId)
	const ch = file.channels[channelId]
	if (!ch) return null
	if (generation != null) {
		const row = ch.generations.find(g => g.gen === generation)
		return row?.keyHex || null
	}
	const row = ch.generations.find(g => g.gen === ch.current) || ch.generations.at(-1)
	return row?.keyHex || null
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {number} generation 密钥代际
 * @param {string} keyHex K_ch hex
 * @returns {Promise<void>} 无返回值
 */
export async function putChannelKeyGeneration(username, groupId, channelId, generation, keyHex) {
	await withGroupChannelKeysLock(username, groupId, async () => {
		const file = await loadChannelKeysFile(username, groupId)
		if (!file.channels[channelId])
			file.channels[channelId] = { current: -1, generations: [] }
		const ch = file.channels[channelId]
		const gen = Number(generation)
		if (!ch.generations.some(g => g.gen === gen))
			ch.generations.push({ gen, keyHex })
		else
			ch.generations = ch.generations.map(g => g.gen === gen ? { gen, keyHex } : g)
		ch.generations.sort((a, b) => a.gen - b.gen)
		if (ch.generations.length > MAX_GENERATIONS)
			ch.generations = ch.generations.slice(-MAX_GENERATIONS)
		ch.current = Math.max(ch.current, gen)
		await saveChannelKeysFile(username, groupId, file)
	})
}

/**
 * 从 channel_key_rotate 事件导入本机 wrap。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} event DAG 事件
 * @param {string} selfPubKeyHash 本机成员 pubKeyHash
 * @returns {Promise<boolean>} 是否成功导入
 */
export async function applyChannelKeyRotateEvent(username, groupId, event, selfPubKeyHash) {
	const channelId = String(event.content?.channelId || '').trim()
	const generation = Number(event.content?.generation)
	const wraps = event.content?.wraps
	if (!channelId || !Number.isFinite(generation) || !wraps) return false
	const self = normalizeHex64(selfPubKeyHash)
	const wrap = wraps[self]
	if (!wrap) return false
	const seed = await readLocalSignerSeed(username, groupId)
	if (!seed) return false
	const keyHex = unwrapChannelKey(wrap, seed)
	if (!keyHex || String(keyHex).length !== 64) return false
	await putChannelKeyGeneration(username, groupId, channelId, generation, keyHex)
	return true
}

/**
 * 从联邦补拉 `channelKeyWraps` 批量导入本机 K_ch。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {Record<string, Array<{ generation?: number, wrap?: object }>>} wrapsByChannel 频道 → wrap 数组
 * @param {string} selfPubKeyHash 本机成员 pubKeyHash
 * @returns {Promise<number>} 成功导入的频道数
 */
export async function applyChannelKeyWrapsFromPull(username, groupId, wrapsByChannel, selfPubKeyHash) {
	if (!isPlainObject(wrapsByChannel)) return 0
	let imported = 0
	for (const [channelId, entries] of Object.entries(wrapsByChannel)) {
		if (!Array.isArray(entries)) continue
		for (const entry of entries) {
			const generation = Number(entry?.generation)
			const wrap = entry?.wrap
			if (!channelId || !Number.isFinite(generation) || !wrap) continue
			const ok = await applyChannelKeyRotateEvent(username, groupId, {
				content: { channelId, generation, wraps: { [normalizeHex64(selfPubKeyHash)]: wrap } },
			}, selfPubKeyHash)
			if (ok) imported++
		}
	}
	return imported
}
