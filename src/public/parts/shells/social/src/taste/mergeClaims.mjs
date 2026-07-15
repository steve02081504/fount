/**
 * Tag 合并声明收件箱（有界、过期、来源限速）。
 * 已接受别名写入 taste store，持久不过期。
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'


import { getNodeDir } from 'npm:@steve02081504/fount-p2p/node/instance'
import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'

import { collectSocialRpcMerged } from '../federation/rpc/wire.mjs'

import { localTagStats, verifyTagMergeClaimWithStats } from './mergeVerify.mjs'
import { loadTaste, mutateTaste, resolveTasteAlias } from './store.mjs'

const CLAIM_INBOX_MAX = 500
const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CLAIM_PER_SOURCE_MAX = 20

/**
 * @returns {string} 收件箱路径
 */
function tagClaimsPath() {
	return path.join(getNodeDir(), 'social', 'tag_claims.jsonl')
}

/**
 * @param {object} claim 声明
 * @returns {boolean} 结构是否可用
 */
function isWellFormedClaim(claim) {
	const from = String(claim?.from || '').trim().toLowerCase()
	const to = String(claim?.to || '').trim().toLowerCase()
	return Boolean(from && to && from !== to && from.length <= 128 && to.length <= 128)
}

/**
 * @returns {Promise<object[]>} 收件箱行
 */
async function readClaimInbox() {
	try {
		const text = await readFile(tagClaimsPath(), 'utf8')
		return text.split('\n').filter(Boolean).map(line => JSON.parse(line))
	}
	catch (err) {
		if (err?.code !== 'ENOENT') throw err
		return []
	}
}

/**
 * @param {object[]} rows 行
 * @returns {Promise<void>}
 */
async function rewriteClaimInbox(rows) {
	await mkdir(path.dirname(tagClaimsPath()), { recursive: true })
	const body = rows.map(row => JSON.stringify(row)).join('\n')
	await writeFile(tagClaimsPath(), body ? `${body}\n` : '', 'utf8')
}

/**
 * 修剪过期 / 超量 / 来源限速后的收件箱。
 * @param {object[]} rows 原始
 * @returns {object[]} 修剪后
 */
export function pruneClaimInbox(rows) {
	const now = Date.now()
	const fresh = rows.filter(row => now - (Number(row.at) || 0) < CLAIM_TTL_MS)
	/** @type {Map<string, number>} */
	const perSource = new Map()
	/** @type {object[]} */
	const kept = []
	for (const row of fresh.reverse()) {
		const source = String(row.sourceNodeHash || row.claim?.annotator || 'unknown')
		const count = perSource.get(source) || 0
		if (count >= CLAIM_PER_SOURCE_MAX) continue
		perSource.set(source, count + 1)
		kept.push(row)
		if (kept.length >= CLAIM_INBOX_MAX) break
	}
	return kept.reverse()
}

/**
 * 入站合并声明：只入收件箱，懒验证另走。
 * @param {string} _username replica
 * @param {object} claim 声明体
 * @param {{ requesterNodeHash?: string | null }} [ingress] 入站
 * @returns {Promise<{ ok: boolean }>} 是否入箱
 */
export async function ingestTagMergeClaim(_username, claim, ingress = {}) {
	if (!isWellFormedClaim(claim)) return { ok: false }
	await withAsyncMutex('tag-claim-inbox', async () => {
		const rows = pruneClaimInbox([
			...await readClaimInbox(),
			{
				at: Date.now(),
				sourceNodeHash: ingress.requesterNodeHash || null,
				claim: {
					from: String(claim.from).trim().toLowerCase(),
					to: String(claim.to).trim().toLowerCase(),
					evidence: claim.evidence || {},
				},
			},
		])
		await rewriteClaimInbox(rows)
	})
	return { ok: true }
}

/**
 * 对偏好表中出现的 tag 懒验证收件箱声明（供 rebuild 调用；复用预计算 stats）。
 * @param {string} username replica
 * @param {string} entityHash acting
 * @param {{ usage: Map<string, number>, audiences: Map<string, Map<string, number>> }} [statsHint] 预计算
 * @returns {Promise<{ accepted: number, rejected: number }>} 计数
 */
export async function lazyVerifyPendingMergeClaims(username, entityHash, statsHint = null) {
	const rows = pruneClaimInbox(await readClaimInbox())
	await rewriteClaimInbox(rows)
	let accepted = 0
	let rejected = 0
	const taste = await loadTaste(username, entityHash)
	const stats = statsHint || await localTagStats(username, entityHash, taste)
	const actorTags = new Set([
		...Object.keys(taste.computed || {}),
		...Object.keys(taste.manual || {}),
	].map(t => resolveTasteAlias(t, taste.aliases)))
	for (const row of Object.values(taste.postTags || {}))
		for (const tag of row?.tags || [])
			actorTags.add(resolveTasteAlias(tag, taste.aliases))

	for (const row of rows) {
		const from = row.claim?.from
		const to = row.claim?.to
		if (!from || !to) continue
		if (!actorTags.has(from) && !actorTags.has(to)
			&& !actorTags.has(resolveTasteAlias(from, taste.aliases)))
			continue
		const result = verifyTagMergeClaimWithStats(stats, row.claim)
		if (!result.ok) {
			rejected++
			continue
		}
		await mutateTaste(username, entityHash, store => {
			const canonTo = resolveTasteAlias(to, store.aliases)
			store.aliases[from] = {
				to: canonTo,
				confidence: result.confidence,
				evidence: { ...row.claim.evidence, verifiedAt: Date.now() },
			}
			return store
		})
		accepted++
	}
	return { accepted, rejected }
}

/**
 * 广播本地发现的合并（验证通过后）。
 * @param {string} username replica
 * @param {{ from: string, to: string, evidence?: object }} claim 声明
 * @returns {Promise<void>}
 */
export async function gossipTagMergeClaim(username, claim) {
	if (!isWellFormedClaim(claim)) return
	await collectSocialRpcMerged(username, {
		type: 'social_tag_merge_claim',
		claim: {
			from: String(claim.from).trim().toLowerCase(),
			to: String(claim.to).trim().toLowerCase(),
			evidence: claim.evidence || {},
		},
	}, 2000, 6)
}

/**
 * 撤销软别名。
 * @param {string} username replica
 * @param {string} entityHash acting
 * @param {string} fromTag 别名源
 * @returns {Promise<import('./store.mjs').TasteStore>} 更新后偏好
 */
export async function revokeTasteAlias(username, entityHash, fromTag) {
	const from = String(fromTag).trim().toLowerCase()
	return mutateTaste(username, entityHash, store => {
		delete store.aliases[from]
		return store
	})
}

/**
 * 追加到收件箱（测试 / 内部）。
 * @param {object} row 行
 * @returns {Promise<void>}
 */
export async function appendClaimInboxRow(row) {
	await withAsyncMutex('tag-claim-inbox', async () => {
		await mkdir(path.dirname(tagClaimsPath()), { recursive: true })
		await appendFile(tagClaimsPath(), `${JSON.stringify(row)}\n`, 'utf8')
		const pruned = pruneClaimInbox(await readClaimInbox())
		await rewriteClaimInbox(pruned)
	})
}
