import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { noteHelpfulScore } from '../../lib/noteScore.mjs'
import { createPostScopedJsonStore, normalizePostTarget } from '../postScopedJsonStore.mjs'

const NOTE_TEXT_MAX = 2000

/**
 *
 */
export const NOTE_PULL_BATCH = 200

const store = createPostScopedJsonStore({
	dirName: 'note_tally',
	mutexPrefix: 'note-index',
	/**
	 * @returns {{ notes: Record<string, object>, votes: Record<string, Record<string, boolean>> }} 空投影
	 */
	empty: () => ({ notes: {}, votes: {} }),
	/**
	 * @param {object | null | undefined} raw 原始
	 * @returns {{ notes: Record<string, object>, votes: Record<string, Record<string, boolean>> }} 规范化
	 */
	normalize: raw => ({
		notes: raw?.notes && typeof raw.notes === 'object' ? raw.notes : {},
		votes: raw?.votes && typeof raw.votes === 'object' ? raw.votes : {},
	}),
})

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {string} 投影路径
 */
export function noteIndexPath(username, targetEntityHash, postId) {
	return store.filePath(username, targetEntityHash, postId)
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ notes: Record<string, object>, votes: Record<string, Record<string, boolean>> }>} 投影
 */
export async function readNoteIndex(username, targetEntityHash, postId) {
	return store.read(username, targetEntityHash, postId)
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
	const ids = normalizePostTarget(targetEntityHash, postId)
	const noteId = normalizeHex64(String(noteEventId || '').trim())
	if (!ids || !isHex64(noteId)) return
	await store.withMutex(ids.target, ids.postId, async () => {
		const current = await store.read(username, ids.target, ids.postId)
		await store.write(username, ids.target, ids.postId, {
			notes: {
				...current.notes,
				[noteId]: {
					noteEventId: noteId,
					authorEntityHash: String(entry.authorEntityHash || '').toLowerCase(),
					text: String(entry.text || '').trim().slice(0, NOTE_TEXT_MAX),
					at: Number(entry.at) || Date.now(),
					...entry.event ? { event: entry.event } : {},
				},
			},
			votes: current.votes,
		})
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
	const ids = normalizePostTarget(targetEntityHash, postId)
	const noteId = normalizeHex64(String(noteEventId || '').trim())
	const voter = String(voterEntityHash || '').trim().toLowerCase()
	if (!ids || !isHex64(noteId) || !parseEntityHash(voter)) return
	await store.withMutex(ids.target, ids.postId, async () => {
		const current = await store.read(username, ids.target, ids.postId)
		const voteMap = { ...current.votes[noteId] }
		voteMap[voter] = helpful === true
		await store.write(username, ids.target, ids.postId, {
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
