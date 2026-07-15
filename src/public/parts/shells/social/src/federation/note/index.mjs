import path from 'node:path'

import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { writeJsonAtomic } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'
import { createLruMap } from 'npm:@steve02081504/fount-p2p/utils/lru'

import { getUserDictionary } from '../../../../../../../server/auth/index.mjs'
import { noteHelpfulScore } from '../../lib/noteScore.mjs'
import { socialPostKey } from '../post_key.mjs'

const NOTE_TEXT_MAX = 2000
const NOTE_INDEX_CACHE_MAX = 512
/** @type {ReturnType<typeof createLruMap<string, object>>} */
const noteIndexCache = createLruMap(NOTE_INDEX_CACHE_MAX)

/**
 *
 */
export const NOTE_PULL_BATCH = 200

/**
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {{ target: string, postId: string } | null} 规范化键
 */
function normalizeNoteTarget(targetEntityHash, postId) {
	const target = String(targetEntityHash || '').trim().toLowerCase()
	const id = normalizeHex64(String(postId || '').trim())
	if (!parseEntityHash(target) || !isHex64(id)) return null
	return { target, postId: id }
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {string} 投影路径
 */
export function noteIndexPath(username, targetEntityHash, postId) {
	const normalized = normalizeNoteTarget(targetEntityHash, postId)
	if (!normalized) throw new Error('invalid note target')
	return path.join(
		getUserDictionary(username),
		'shells/social/note_tally',
		normalized.target,
		`${normalized.postId}.json`,
	)
}

/**
 * @returns {{ notes: Record<string, object>, votes: Record<string, Record<string, boolean>> }} 空投影
 */
function emptyNoteIndex() {
	return { notes: {}, votes: {} }
}

/**
 * @param {object | null | undefined} raw 原始
 * @returns {{ notes: Record<string, object>, votes: Record<string, Record<string, boolean>> }} 规范化
 */
function normalizeNoteIndex(raw) {
	return {
		notes: raw?.notes && typeof raw.notes === 'object' ? raw.notes : {},
		votes: raw?.votes && typeof raw.votes === 'object' ? raw.votes : {},
	}
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ notes: Record<string, object>, votes: Record<string, Record<string, boolean>> }>} 投影
 */
export async function readNoteIndex(username, targetEntityHash, postId) {
	const ids = normalizeNoteTarget(targetEntityHash, postId)
	if (!ids) return emptyNoteIndex()
	const key = `${ids.target}:${ids.postId}`
	const cached = noteIndexCache.get(key)
	if (cached) {
		noteIndexCache.touch(key, cached)
		return cached
	}
	const { readFile } = await import('node:fs/promises')
	try {
		const raw = JSON.parse(await readFile(noteIndexPath(username, ids.target, ids.postId), 'utf8'))
		const normalized = normalizeNoteIndex(raw)
		noteIndexCache.touch(key, normalized)
		return normalized
	}
	catch (err) {
		if (err?.code !== 'ENOENT') throw err
		const empty = emptyNoteIndex()
		noteIndexCache.touch(key, empty)
		return empty
	}
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @param {object} data 投影
 * @returns {Promise<void>}
 */
async function writeNoteIndex(username, targetEntityHash, postId, data) {
	const ids = normalizeNoteTarget(targetEntityHash, postId)
	if (!ids) return
	const key = `${ids.target}:${ids.postId}`
	const { mkdir } = await import('node:fs/promises')
	await mkdir(path.dirname(noteIndexPath(username, ids.target, ids.postId)), { recursive: true })
	await writeJsonAtomic(noteIndexPath(username, ids.target, ids.postId), data)
	noteIndexCache.touch(key, data)
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @param {string} noteEventId note 事件 id
 * @param {object} entry note 条目
 * @returns {Promise<void>}
 */
export async function upsertNote(username, targetEntityHash, postId, noteEventId, entry) {
	const ids = normalizeNoteTarget(targetEntityHash, postId)
	const noteId = normalizeHex64(String(noteEventId || '').trim())
	if (!ids || !isHex64(noteId)) return
	const mutexKey = socialPostKey(ids.target, ids.postId)
	await withAsyncMutex(`note-index:${mutexKey}`, async () => {
		const current = await readNoteIndex(username, ids.target, ids.postId)
		const notes = {
			...current.notes,
			[noteId]: {
				noteEventId: noteId,
				authorEntityHash: String(entry.authorEntityHash || '').toLowerCase(),
				text: String(entry.text || '').trim().slice(0, NOTE_TEXT_MAX),
				at: Number(entry.at) || Date.now(),
				...entry.event ? { event: entry.event } : {},
			},
		}
		await writeNoteIndex(username, ids.target, ids.postId, { notes, votes: current.votes })
	})
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @param {string} noteEventId note id
 * @param {string} voterEntityHash 投票者
 * @param {boolean} helpful 是否有用
 * @returns {Promise<void>}
 */
export async function upsertNoteVote(username, targetEntityHash, postId, noteEventId, voterEntityHash, helpful) {
	const ids = normalizeNoteTarget(targetEntityHash, postId)
	const noteId = normalizeHex64(String(noteEventId || '').trim())
	const voter = String(voterEntityHash || '').trim().toLowerCase()
	if (!ids || !isHex64(noteId) || !parseEntityHash(voter)) return
	const mutexKey = socialPostKey(ids.target, ids.postId)
	await withAsyncMutex(`note-index:${mutexKey}`, async () => {
		const current = await readNoteIndex(username, ids.target, ids.postId)
		const voteMap = { ...current.votes[noteId] || {} }
		voteMap[voter] = helpful === true
		await writeNoteIndex(username, ids.target, ids.postId, {
			notes: current.notes,
			votes: { ...current.votes, [noteId]: voteMap },
		})
	})
}

/**
 * @param {string} replicaUsername replica
 * @param {string} timelineOwnerEntityHash 事件作者
 * @param {object} event 签名事件
 * @returns {Promise<void>}
 */
export async function projectNoteFromTimelineEvent(replicaUsername, timelineOwnerEntityHash, event) {
	if (event.type === 'post_note') {
		await upsertNote(
			replicaUsername,
			event.content?.targetEntityHash,
			event.content?.targetPostId,
			event.id,
			{
				authorEntityHash: timelineOwnerEntityHash,
				text: event.content?.text,
				at: Number(event.hlc?.wall) || Number(event.timestamp) || Date.now(),
				event,
			},
		)
		return
	}
	if (event.type === 'note_vote')
		await upsertNoteVote(
			replicaUsername,
			event.content?.targetEntityHash,
			event.content?.targetPostId,
			event.content?.noteEventId,
			timelineOwnerEntityHash,
			event.content?.helpful === true,
		)
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @param {string | null} [afterAuthor] 游标作者 hash（不含）
 * @param {number} [limit] 返回上限
 * @returns {Promise<object[]>} 签名 post_note 事件
 */
export async function listNoteEvents(username, targetEntityHash, postId, afterAuthor = null, limit = NOTE_PULL_BATCH) {
	const index = await readNoteIndex(username, targetEntityHash, postId)
	const rows = Object.values(index.notes)
		.filter(note => note?.event && note.authorEntityHash)
		.sort((a, b) => String(a.authorEntityHash).localeCompare(String(b.authorEntityHash)))
	const filtered = afterAuthor
		? rows.filter(note => note.authorEntityHash > afterAuthor)
		: rows
	return filtered.slice(0, limit).map(note => note.event)
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ notes: object[], topNote: object | null }>} 汇总
 */
export async function summarizeNotes(username, targetEntityHash, postId) {
	const index = await readNoteIndex(username, targetEntityHash, postId)
	const notes = Object.values(index.notes).map(note => {
		const votes = index.votes[note.noteEventId] || {}
		const score = noteHelpfulScore(note, votes)
		const { event: _event, ...rest } = note
		return {
			...rest,
			score,
			helpfulCount: Object.values(votes).filter(Boolean).length,
			unhelpfulCount: Object.values(votes).filter(v => !v).length,
		}
	}).sort((a, b) => b.score - a.score || b.at - a.at)
	const topNote = notes.find(note => note.score > 0) || null
	return { notes, topNote }
}

