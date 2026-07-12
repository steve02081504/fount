/**
 * 用户级群发现索引：合并联邦 gossip，带来源归因。
 * 广告签名 = 某成员曾声称，非群主授权；入索引需正信誉或 ≥2 独立 node（与冷归档 quorum 一致）。
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import archiveTunables from '../lib/archive.tunables.json' with { type: 'json' }
import { sign, verify } from 'npm:@steve02081504/fount-p2p/crypto'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'
import { resolveArchiveQuorumPeerMin } from 'npm:@steve02081504/fount-p2p/trust_graph/resolve'
import { resolveLocalEventSigner } from '../dag/localSigner.mjs'
import { getState } from '../dag/materialize.mjs'
import { discoveryIndexPath } from '../lib/paths.mjs'
import { listUserGroups } from '../lib/userGroups.mjs'

const MAX_ENTRIES = 512
const MAX_SOURCES_PER_ENTRY = 16

/**
 * @typedef {{
 *   groupId: string,
 *   title: string,
 *   blurb: string,
 *   advertiserPubKeyHash: string,
 *   advertiserNodeHash: string,
 *   signature: string,
 *   observedAt: number,
 *   sources: Array<{ fromNodeHash: string, fromPubKeyHash?: string, seenAt: number }>,
 * }} DiscoveryEntry
 */

/**
 * @param {DiscoveryEntry} entry 条目
 * @returns {string} 去重键
 */
function entryKey(entry) {
	return `${entry.groupId}\0${entry.advertiserPubKeyHash}`
}

/**
 * @param {string} username 用户
 * @returns {Promise<{ entries: DiscoveryEntry[] }>} 磁盘索引
 */
export async function loadDiscoveryIndex(username) {
	try {
		return { entries: JSON.parse(await readFile(discoveryIndexPath(username), 'utf8')).entries.slice(0, MAX_ENTRIES) }
	}
	catch { return { entries: [] } }
}

/**
 * @param {string} username 用户
 * @param {{ entries: DiscoveryEntry[] }} data 索引
 * @returns {Promise<void>}
 */
async function saveDiscoveryIndex(username, data) {
	const path = discoveryIndexPath(username)
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, JSON.stringify({
		entries: data.entries.slice(0, MAX_ENTRIES),
	}, null, '\t'), 'utf8')
}

/**
 * @param {object} advertisement 广告体（不含 signature）
 * @returns {string} 签名消息
 */
function signMessage(advertisement) {
	return createHash('sha256').update(JSON.stringify(advertisement)).digest('hex')
}

/**
 * 为本机公开群构建签名广告。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} nodeHash 本机 nodeHash
 * @returns {Promise<object | null>} 签名广告
 */
export async function buildSignedDiscoveryAdvertisement(username, groupId, nodeHash) {
	const { state } = await getState(username, groupId)
	if (!state.groupSettings?.discoveryPublic) return null
	const signer = await resolveLocalEventSigner(username, groupId)
	const title = (state.groupSettings.discoveryTitle || state.groupMeta?.name || groupId).slice(0, 200)
	const blurb = (state.groupSettings.discoveryBlurb || state.groupMeta?.description || '').slice(0, 500)
	const body = {
		groupId,
		title,
		blurb,
		advertiserPubKeyHash: signer.sender,
		advertiserNodeHash: nodeHash,
		observedAt: Date.now(),
	}
	const signature = Buffer.from(await sign(Buffer.from(signMessage(body), 'hex'), signer.secretKey)).toString('hex')
	return { ...body, signature }
}

/**
 * @param {object} advertisement 含 signature 的广告（联邦入站）
 * @returns {Promise<boolean>} 验签是否通过
 */
export async function verifyDiscoveryAdvertisement(advertisement) {
	const advertiserPubKeyHash = normalizeHex64(advertisement.advertiserPubKeyHash)
	const signatureHex = String(advertisement.signature || '').trim()
	if (!isHex64(advertiserPubKeyHash) || !signatureHex) return false
	const body = { ...advertisement }
	delete body.signature
	return verify(
		Buffer.from(signatureHex, 'hex'),
		Buffer.from(signMessage(body), 'hex'),
		Buffer.from(advertiserPubKeyHash, 'hex'),
	)
}

/**
 * @param {string} username 用户
 * @param {object} advertisement 已验签广告
 * @param {{ fromNodeHash: string, fromPubKeyHash?: string }} source 来源
 * @returns {Promise<void>}
 */
export async function mergeDiscoveryAdvertisement(username, advertisement, source) {
	if (!await verifyDiscoveryAdvertisement(advertisement)) return
	const fromNodeHash = String(source.fromNodeHash || '').trim()
	const nodeScore = fromNodeHash ? pickNodeScore(fromNodeHash) : 0
	const index = await loadDiscoveryIndex(username)
	const key = entryKey({
		groupId: advertisement.groupId,
		advertiserPubKeyHash: normalizeHex64(advertisement.advertiserPubKeyHash),
	})
	let entry = index.entries.find(e => entryKey(e) === key)
	const distinctSources = new Set([
		...(entry?.sources || []).map(s => s.fromNodeHash).filter(Boolean),
		fromNodeHash,
	].filter(Boolean))
	const sourceMinN = Math.max(
		Number(advertisement.memberCount) || 0,
		distinctSources.size + 1,
	)
	const sourceMin = resolveArchiveQuorumPeerMin(sourceMinN, archiveTunables)
	if (nodeScore <= 0 && distinctSources.size < sourceMin) return
	if (!entry) {
		entry = {
			groupId: advertisement.groupId,
			title: advertisement.title || '',
			blurb: advertisement.blurb || '',
			advertiserPubKeyHash: normalizeHex64(advertisement.advertiserPubKeyHash),
			advertiserNodeHash: advertisement.advertiserNodeHash || '',
			signature: advertisement.signature,
			observedAt: advertisement.observedAt || Date.now(),
			sources: [],
		}
		index.entries.push(entry)
	}
	if (fromNodeHash && !entry.sources.some(s => s.fromNodeHash === fromNodeHash)) {
		entry.sources.unshift({
			fromNodeHash,
			fromPubKeyHash: source.fromPubKeyHash ? normalizeHex64(source.fromPubKeyHash) : undefined,
			seenAt: Date.now(),
		})
		entry.sources = entry.sources.slice(0, MAX_SOURCES_PER_ENTRY)
	}
	entry.observedAt = Math.max(entry.observedAt, advertisement.observedAt || 0)
	await saveDiscoveryIndex(username, index)
}

/**
 * @param {string} username 用户
 * @param {{ limit?: number }} [opts] 分页
 * @returns {Promise<DiscoveryEntry[]>} 排序后的条目
 */
export async function queryDiscoveryIndex(username, opts = {}) {
	const limit = Math.min(100, Math.max(1, opts.limit ?? 50))
	return [...(await loadDiscoveryIndex(username)).entries]
		.sort((a, b) => b.observedAt - a.observedAt)
		.slice(0, limit)
}

/**
 * 查询响应：本机公开群广告 + 本地索引条目。
 * @param {string} username 用户
 * @param {string} nodeHash 本机 nodeHash
 * @param {number} limit 条数上限
 * @returns {Promise<object[]>} 签名广告列表
 */
export async function buildDiscoveryQueryResponse(username, nodeHash, limit = 32) {
	const advertisements = []
	for (const groupId of await listUserGroups(username)) {
		const advertisement = await buildSignedDiscoveryAdvertisement(username, groupId, nodeHash)
		if (advertisement) advertisements.push(advertisement)
	}
	for (const entry of await queryDiscoveryIndex(username, { limit })) {
		if (advertisements.some(advertisement =>
			advertisement.groupId === entry.groupId && advertisement.advertiserPubKeyHash === entry.advertiserPubKeyHash))
			continue
		advertisements.push({
			groupId: entry.groupId,
			title: entry.title,
			blurb: entry.blurb,
			advertiserPubKeyHash: entry.advertiserPubKeyHash,
			advertiserNodeHash: entry.advertiserNodeHash,
			signature: entry.signature,
			observedAt: entry.observedAt,
			sources: entry.sources,
		})
	}
	return advertisements.slice(0, limit)
}
