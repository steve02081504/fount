/**
 * 用户级群发现索引：合并联邦 gossip，带来源归因。
 * 广告签名 = 某成员曾声称，非群主授权；入索引不设信誉门槛，查询时按来源信誉降序排列。
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { publicKeyFromSeed, sign, verify } from 'npm:@steve02081504/fount-p2p/crypto'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

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
 * `advertiserPubKeyHash` 字段实际承载广告方**原始 Ed25519 公钥**（非其 sha256 摘要）：
 * 联邦入站验签必须用原始公钥（`npm:@steve02081504/fount-p2p/crypto` 的 `verify` 不接受摘要），
 * 而 wire schema（fount-p2p `schemas/discovery`）只白名单 `advertiserPubKeyHash` 一个 64-hex 键字段，
 * 故复用该字段携带原始公钥；该字段仅用于签名校验与去重归因，不与 DAG 成员 pubKeyHash 比对。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} nodeHash 本机 nodeHash
 * @returns {Promise<object | null>} 签名广告
 */
export async function buildSignedDiscoveryAdvertisement(username, groupId, nodeHash) {
	const { state } = await getState(username, groupId)
	if (!state.groupSettings?.discoveryPublic) return null
	const signer = await resolveLocalEventSigner(username, groupId)
	const advertiserPubKeyHex = Buffer.from(publicKeyFromSeed(signer.secretKey)).toString('hex')
	const title = (state.groupSettings.discoveryTitle || state.groupMeta?.name || groupId).slice(0, 200)
	const blurb = (state.groupSettings.discoveryBlurb || state.groupMeta?.description || '').slice(0, 500)
	const body = {
		groupId,
		title,
		blurb,
		advertiserPubKeyHash: advertiserPubKeyHex,
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
	const advertiserPubKeyHash = advertisement.advertiserPubKeyHash
	const signatureHex = advertisement.signature || ''
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
	const fromNodeHash = source.fromNodeHash || ''
	const index = await loadDiscoveryIndex(username)
	const key = entryKey({
		groupId: advertisement.groupId,
		advertiserPubKeyHash: advertisement.advertiserPubKeyHash,
	})
	let entry = index.entries.find(e => entryKey(e) === key)
	if (!entry) {
		entry = {
			groupId: advertisement.groupId,
			title: advertisement.title || '',
			blurb: advertisement.blurb || '',
			advertiserPubKeyHash: advertisement.advertiserPubKeyHash,
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
			fromPubKeyHash: source.fromPubKeyHash || undefined,
			seenAt: Date.now(),
		})
		entry.sources = entry.sources.slice(0, MAX_SOURCES_PER_ENTRY)
	}
	entry.observedAt = Math.max(entry.observedAt, advertisement.observedAt || 0)
	await saveDiscoveryIndex(username, index)
}

/**
 * 条目信誉评分：取全部来源节点信誉的最高值；无来源（非联邦入站）按 0 计。
 * @param {DiscoveryEntry} entry 条目
 * @returns {number} 信誉评分
 */
function entryReputationScore(entry) {
	const scores = (entry.sources || []).map(source =>
		source.fromNodeHash ? pickNodeScore(source.fromNodeHash) : 0)
	return scores.length ? Math.max(...scores) : 0
}

/**
 * @param {string} username 用户
 * @param {{ limit?: number }} [options] 分页
 * @returns {Promise<DiscoveryEntry[]>} 排序后的条目（信誉降序，同信誉按新近度）
 */
export async function queryDiscoveryIndex(username, options = {}) {
	const limit = Math.min(100, Math.max(1, options.limit ?? 50))
	return [...(await loadDiscoveryIndex(username)).entries]
		.sort((a, b) => entryReputationScore(b) - entryReputationScore(a) || b.observedAt - a.observedAt)
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
