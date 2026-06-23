/**
 * 冷归档单月正文 canonical digest 与信誉仲裁。
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

import { canonicalStringify } from '../../../../../../../scripts/p2p/canonical_json.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { loadReputation } from '../../../../../../../scripts/p2p/reputation.mjs'
import { pickNodeScoreFromReputation } from '../../../../../../../scripts/p2p/reputation_pick_score.mjs'
import {
	resolveArchiveQuorumPeerMin,
	resolveArchiveQuorumPeerStrictMin,
	resolveArchiveQuorumThresholds,
} from '../../../../../../../scripts/p2p/tunables_resolve.mjs'
import { channelArchivePath } from '../lib/paths.mjs'

import archiveTunables from './archive.tunables.json' with { type: 'json' }
import { archiveMonthKey } from './settings.mjs'

/** canonical JSONL 行内 eventId 提取（digest 排序用，避免 sort 中重复 JSON.parse） */
const ARCHIVE_LINE_EVENT_ID_RE = /"eventId"\s*:\s*"([\da-f]{64})"/u

/** @deprecated 使用 {@link resolveArchiveQuorumPeerMin}；N=8 参考值 */
export const ARCHIVE_QUORUM_PEER_MIN = resolveArchiveQuorumPeerMin(8, archiveTunables)

/** @deprecated 使用 {@link resolveArchiveQuorumPeerStrictMin}；N=8 参考值 */
export const ARCHIVE_QUORUM_PEER_STRICT_MIN = resolveArchiveQuorumPeerStrictMin(8, archiveTunables)

/**
 *
 */
export { resolveArchiveQuorumPeerMin, resolveArchiveQuorumPeerStrictMin, resolveArchiveQuorumThresholds }

/**
 * @param {object} snap PostSnapshot
 * @returns {object} digest 用 canonical 体
 */
export function canonicalSnapshotForDigest(snap) {
	/** @type {Record<string, unknown>} */
	const body = {
		eventId: String(snap.eventId || '').trim().toLowerCase(),
		channelId: String(snap.channelId || 'default').trim(),
		timestamp: snap.timestamp,
		sender: String(snap.sender || '').trim().toLowerCase(),
		charId: snap.charId ?? null,
		content: snap.content,
		pinned: !!snap.pinned,
		deleted: !!snap.deleted,
	}
	if (snap.hlc != null && typeof snap.hlc === 'object') body.hlc = snap.hlc
	if (snap.reactions != null) body.reactions = snap.reactions
	if (Array.isArray(snap.prev_event_ids))
		body.prev_event_ids = [...snap.prev_event_ids].map(id => String(id).trim().toLowerCase()).filter(isHex64)
			.sort((a, b) => a.localeCompare(b, 'en'))
	if (snap.display)
		body.display = {
			name: String(snap.display.name ?? ''),
			avatar: snap.display.avatar != null ? String(snap.display.avatar) : null,
		}

	return body
}

/**
 * 磁盘 JSONL 单行 canonical 形式（写入与 digest 均使用）。
 * @param {object} snap PostSnapshot
 * @returns {string} canonical JSON 行（无换行）
 */
export function canonicalArchiveMonthLine(snap) {
	return canonicalStringify(canonicalSnapshotForDigest(snap))
}

/**
 * 按 eventId 升序滚动折叠 canonical 行（联邦与本地 append 增量共用）。
 * @param {string} prevDigest 上一行折叠结果；空串表示首行
 * @param {string} canonicalPart 单行 canonical JSON
 * @returns {string} 新 digest hex
 */
export function rollingMonthDigestStep(prevDigest, canonicalPart) {
	if (!prevDigest) return createHash('sha256').update(canonicalPart, 'utf8').digest('hex')
	return createHash('sha256').update(`${prevDigest}\n${canonicalPart}`, 'utf8').digest('hex')
}

/**
 * @param {string} prevDigest 已有月 digest；空则从头折叠
 * @param {object[]} newSnapshots 新增快照（将按 eventId 排序后折叠）
 * @returns {string} 更新后的 digest hex
 */
export function extendRollingMonthDigest(prevDigest, newSnapshots) {
	if (!newSnapshots.length) return String(prevDigest || '')
	const sorted = [...newSnapshots].sort((a, b) =>
		String(a.eventId).localeCompare(String(b.eventId), 'en'),
	)
	let digest = String(prevDigest || '')
	for (const snap of sorted)
		digest = rollingMonthDigestStep(digest, canonicalStringify(canonicalSnapshotForDigest(snap)))
	return digest
}

/**
 * @param {object[]} snapshots 解析后的快照
 * @returns {{ digest: string, snapshots: object[] }} digest hex 与排序后快照
 */
export function digestArchiveMonthSnapshots(snapshots) {
	if (!snapshots.length) return { digest: '', snapshots: [] }
	const sorted = [...snapshots].sort((a, b) =>
		String(a.eventId).localeCompare(String(b.eventId), 'en'),
	)
	let digest = ''
	for (const snap of sorted)
		digest = rollingMonthDigestStep(digest, canonicalStringify(canonicalSnapshotForDigest(snap)))
	return { digest, snapshots: sorted }
}

/**
 * 对已按 eventId 排序的 canonical 行滚动 digest（无 JSON 解析）。
 * @param {string[]} canonicalLines 每行 canonical JSON
 * @returns {string} digest hex
 */
export function digestCanonicalMonthLines(canonicalLines) {
	let digest = ''
	for (const line of canonicalLines) {
		const trimmed = String(line).trim()
		if (!trimmed) continue
		digest = rollingMonthDigestStep(digest, trimmed)
	}
	return digest
}

/**
 * @param {string} body JSONL 明文
 * @returns {{ digest: string, snapshots: object[] }} digest hex 与解析行
 */
export function digestArchiveMonthBody(body) {
	/** @type {object[]} */
	const snapshots = []
	/** @type {string[]} */
	const canonicalLines = []
	for (const line of String(body || '').split('\n')) {
		const trimmed = line.trim()
		if (!trimmed) continue
		let snap
		try {
			snap = JSON.parse(trimmed)
		}
		catch {
			return { digest: '', snapshots: [] }
		}
		snapshots.push(snap)
		canonicalLines.push(canonicalArchiveMonthLine(snap))
	}
	const sorted = [...snapshots].sort((a, b) =>
		String(a.eventId).localeCompare(String(b.eventId), 'en'),
	)
	const sortedLines = sorted.map(snap => canonicalArchiveMonthLine(snap))
	return { digest: digestCanonicalMonthLines(sortedLines), snapshots: sorted }
}

/**
 * @param {string} filePath 月 JSONL 路径
 * @returns {Promise<{ digest: string, snapshots: object[] }>} digest 与快照
 */
export async function digestArchiveMonthFile(filePath) {
	/** @type {object[]} */
	const snapshots = []
	/** @type {string[]} */
	const canonicalLines = []
	try {
		const input = createReadStream(filePath, { encoding: 'utf8' })
		const lines = createInterface({ input, crlfDelay: Infinity })
		for await (const line of lines) {
			const trimmed = String(line).trim()
			if (!trimmed) continue
			let snap
			try {
				snap = JSON.parse(trimmed)
			}
			catch {
				return { digest: '', snapshots: [] }
			}
			snapshots.push(snap)
			canonicalLines.push(canonicalArchiveMonthLine(snap))
		}
	}
	catch {
		return { digest: '', snapshots: [] }
	}
	const sorted = [...snapshots].sort((a, b) =>
		String(a.eventId).localeCompare(String(b.eventId), 'en'),
	)
	const sortedLines = sorted.map(snap => canonicalArchiveMonthLine(snap))
	return { digest: digestCanonicalMonthLines(sortedLines), snapshots: sorted }
}

/**
 * 流式 digest：仅哈希磁盘 canonical 行，不保留快照（低内存）。
 * @param {string} filePath 月 JSONL 路径
 * @returns {Promise<string>} digest hex；失败为空串
 */
export async function digestArchiveMonthFileLinesOnly(filePath) {
	/** @type {string[]} */
	const lines = []
	try {
		const input = createReadStream(filePath, { encoding: 'utf8' })
		const rl = createInterface({ input, crlfDelay: Infinity })
		for await (const line of rl) {
			const trimmed = String(line).trim()
			if (!trimmed) continue
			lines.push(trimmed)
		}
	}
	catch {
		return ''
	}
	const keyed = lines.map(line => {
		const match = ARCHIVE_LINE_EVENT_ID_RE.exec(line)
		return { id: match ? match[1] : '', line }
	})
	keyed.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
	return digestCanonicalMonthLines(keyed.map(row => row.line))
}

/**
 * @param {string} filePath 月 JSONL 路径
 * @returns {Promise<string>} 文件中最大 eventId（hex64）；空文件为 ''
 */
export async function readArchiveMonthMaxEventId(filePath) {
	let max = ''
	try {
		const input = createReadStream(filePath, { encoding: 'utf8' })
		const lines = createInterface({ input, crlfDelay: Infinity })
		for await (const line of lines) {
			const trimmed = String(line).trim()
			if (!trimmed) continue
			try {
				const snap = JSON.parse(trimmed)
				const id = String(snap.eventId || '').trim().toLowerCase()
				if (!isHex64(id)) continue
				if (!max || id.localeCompare(max, 'en') > 0) max = id
			}
			catch { /* skip */ }
		}
	}
	catch { /* missing */ }
	return max
}

/**
 * @param {string} maxOnDisk 磁盘已有最大 eventId
 * @param {object[]} newSnapshots 待追加快照（已按 eventId 升序）
 * @returns {boolean} 新批次是否严格大于磁盘最大值
 */
export function archiveAppendMonotonic(maxOnDisk, newSnapshots) {
	if (!maxOnDisk) return true
	const minNew = String(newSnapshots[0]?.eventId || '').trim().toLowerCase()
	if (!isHex64(minNew)) return false
	return minNew.localeCompare(maxOnDisk, 'en') > 0
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道
 * @param {object} manifest archive manifest
 * @returns {Promise<Record<string, string>>} 月 → digest
 */
export async function collectChannelMonthDigestsFromDisk(username, groupId, channelId, manifest) {
	const months = [...manifest.channels?.[channelId]?.months || []]
		.sort((a, b) => a.localeCompare(b, 'en'))
	/** @type {Record<string, string>} */
	const out = {}
	for (const month of months) {
		const { digest } = await digestArchiveMonthFile(
			channelArchivePath(username, groupId, channelId, month),
		)
		if (digest) out[month] = digest
	}
	return out
}

/**
 * @param {object} manifest archive manifest
 * @param {string} channelId 频道
 * @param {string} month `YYYY-MM`
 * @returns {string | null} 期望 digest
 */
export function expectedMonthDigest(manifest, channelId, month) {
	const digest = manifest.monthDigests?.[channelId]?.[month]
	const normalized = String(digest || '').trim().toLowerCase()
	return isHex64(normalized) ? normalized : null
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道
 * @param {string} month `YYYY-MM`
 * @param {object} manifest archive manifest
 * @returns {Promise<{ ok: boolean, reason?: string, digest?: string }>} 磁盘月文件是否与 manifest 一致
 */
export async function assertArchiveMonthFileMatchesManifest(username, groupId, channelId, month, manifest) {
	const expected = expectedMonthDigest(manifest, channelId, month)
	if (!expected) return { ok: false, reason: 'missing_manifest_digest' }
	const { digest } = await digestArchiveMonthFile(
		channelArchivePath(username, groupId, channelId, month),
	)
	if (!digest) return { ok: false, reason: 'missing_or_corrupt_file' }
	if (digest !== expected) return { ok: false, reason: 'digest_mismatch', digest }
	return { ok: true, digest }
}

/**
 * 联邦赢家落盘或本地 append 后，用月正文刷新 archivedEventIds。
 * @param {object} manifest 可变 manifest
 * @param {string} channelId 频道
 * @param {string} month `YYYY-MM`
 * @param {object[]} snapshots PostSnapshot 列表
 * @returns {number} 新登记 eventId 数
 */
export function syncArchivedEventIdsFromMonthBody(manifest, channelId, month, snapshots) {
	if (!manifest.archivedEventIds[channelId]) manifest.archivedEventIds[channelId] = {}
	const idMap = manifest.archivedEventIds[channelId]
	let added = 0
	for (const snap of snapshots) {
		const eventId = String(snap.eventId || '').trim().toLowerCase()
		if (!isHex64(eventId)) continue
		const wall = Number(snap.hlc?.wall)
		const snapMonth = Number.isFinite(wall) ? archiveMonthKey(wall) : month
		if (snapMonth !== month) continue
		if (!Object.prototype.hasOwnProperty.call(idMap, eventId)) added++
		idMap[eventId] = month
	}
	return added
}

/**
 * @param {Array<{ peerNodeHash: string, tmpPath?: string, complete?: boolean }>} candidates 各 peer 应答
 * @param {object} manifest archive manifest
 * @param {string} channelId 频道
 * @param {string} month `YYYY-MM`
 * @param {{ pickScore?: (peerNodeHash: string) => number, activeMemberCount?: number }} [opts] 测试可注入 pickScore；activeMemberCount 用于缩放 strictMin
 * @returns {Promise<{ winner: object | null, digest: string, reason: string }>} 仲裁结果
 */
export async function pickArchiveMonthByReputation(candidates, manifest, channelId, month, opts = {}) {
	/** @type {(peer: string) => number} */
	let scoreOf = opts.pickScore
	if (!scoreOf) {
		const rep = loadReputation()
		scoreOf = pickNodeScoreFromReputation.bind(null, rep)
	}
	/** @type {Map<string, { digest: string, snapshots: object[], peers: string[] }>} */
	const byDigest = new Map()
	for (const row of candidates) {
		if (!row.complete) continue
		const peer = String(row.peerNodeHash || '').trim()
		if (!peer) continue
		if (!row.tmpPath) continue
		/** @type {{ digest: string, snapshots: object[] }} */
		const parsed = await digestArchiveMonthFile(row.tmpPath)
		const { digest, snapshots } = parsed
		if (!digest) continue
		const bucket = byDigest.get(digest) || {
			digest,
			snapshots,
			peers: [],
			tmpPath: row.tmpPath || '',
		}
		if (row.tmpPath && !bucket.tmpPath) bucket.tmpPath = row.tmpPath
		bucket.peers.push(peer)
		byDigest.set(digest, bucket)
	}
	if (!byDigest.size) return { winner: null, digest: '', reason: 'no_valid_candidate' }

	const expectedDigest = expectedMonthDigest(manifest, channelId, month)
	/** @type {{ digest: string, score: number, bucket: object }[]} */
	const ranked = []
	for (const bucket of byDigest.values()) {
		let score = 0
		for (const peer of bucket.peers)
			score = Math.max(score, scoreOf(peer))
		if (expectedDigest && bucket.digest === expectedDigest) score += 0.001
		ranked.push({ digest: bucket.digest, score, bucket })
	}
	ranked.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score
		if (b.bucket.peers.length !== a.bucket.peers.length)
			return b.bucket.peers.length - a.bucket.peers.length
		return a.digest.localeCompare(b.digest, 'en')
	})

	const best = ranked[0]
	const candidatePeerCount = Math.max(...[...byDigest.values()].map(b => b.peers.length), 0)
	const quorumN = Math.max(Number(opts.activeMemberCount) || 0, candidatePeerCount)
	const strictMin = resolveArchiveQuorumPeerStrictMin(quorumN, archiveTunables)
	const soleHighRepDictator = best.bucket.peers.length === 1 && best.score > 0
	const quorumOk = !soleHighRepDictator && (
		best.score > 0
		|| best.bucket.peers.length >= strictMin
	)
	if (!quorumOk) return { winner: null, digest: '', reason: 'quorum_failed' }

	return {
		winner: {
			tmpPath: best.bucket.tmpPath || undefined,
			channelId,
			utcMonth: month,
			peers: best.bucket.peers,
		},
		digest: best.digest,
		reason: 'ok',
	}
}

/**
 * 从磁盘月文件刷新 manifest.monthDigests。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道
 * @param {string} month `YYYY-MM`
 * @param {object} manifest 可变 manifest
 * @returns {Promise<void>}
 */
export async function refreshManifestMonthDigest(username, groupId, channelId, month, manifest) {
	try {
		const { digest } = await digestArchiveMonthFile(
			channelArchivePath(username, groupId, channelId, month),
		)
		if (!digest) return
		if (!manifest.monthDigests) manifest.monthDigests = {}
		if (!manifest.monthDigests[channelId]) manifest.monthDigests[channelId] = {}
		manifest.monthDigests[channelId][month] = digest
	}
	catch { /* missing file */ }
}
