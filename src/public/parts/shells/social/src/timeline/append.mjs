import { Buffer } from 'node:buffer'

import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { pubKeyHash, publicKeyFromSeed } from 'npm:@steve02081504/fount-p2p/crypto'
import { appendJsonlSynced, readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { recoverySubjectHashFromPubKeyHex } from 'npm:@steve02081504/fount-p2p/federation/entity_key_chain'
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { computeAppendHlcAndPrev, signTimelineEvent } from 'npm:@steve02081504/fount-p2p/timeline/append_core'

import {
	consumePendingRecoverySecret,
	getEntitySecretKey,
	getRecoveryPubKeyHex,
	loadEntityIdentity,
	resolveCharPartNameForEntity,
} from '../../../chat/src/entity/identity.mjs'
import { projectFollowerIndexFromTimelineEvent } from '../federation/follower/index.mjs'
import { projectNoteFromTimelineEvent } from '../federation/note/index.mjs'
import { projectPollVoteFromTimelineEvent } from '../federation/poll/index.mjs'
import { projectReactionFromTimelineEvent } from '../federation/reaction/index.mjs'
import { getEntityProfile } from '../lib/entityProfile.mjs'
import { groupIdForTimeline, timelineEventsPath } from '../paths.mjs'

import { canonicalizeLocalTimelineEvent } from './canonicalizeEvent.mjs'
import { publishTimelineEvent } from './fanout.mjs'
import { invalidateTimelineMaterializedCache, maintainSocialTimeline } from './materialize.mjs'
import { invalidateTimelineOwnerIndex } from './ownerIndex.mjs'

const NODE_ID = 'social-local'

/**
 * @param {Uint8Array} secretKey 签名私钥
 * @returns {{ sender: string, secretKey: Uint8Array }} 时间线签名者
 */
function timelineSignerFromSecret(secretKey) {
	return { sender: pubKeyHash(publicKeyFromSeed(secretKey)), secretKey }
}

/**
 * 按目标 entityHash 解析本机实体活跃钥签名者。
 * @param {string} username replica 登录名
 * @param {string} entityHash 时间线 owner
 * @returns {Promise<{ sender: string, secretKey: Uint8Array }>} 活跃钥签名者
 */
async function resolveActiveTimelineSigner(username, entityHash) {
	const secretHex = await getEntitySecretKey(username, entityHash)
	if (!secretHex || secretHex.length !== 64) throw new Error('configure entity identity before posting')
	return timelineSignerFromSecret(new Uint8Array(Buffer.from(secretHex, 'hex')))
}

/**
 * 本 replica 是否可写该 entity 的时间线（实体本人密钥）。
 * @param {string} username replica 登录名
 * @param {string} entityHash 128 位 entityHash
 * @returns {Promise<boolean>} 是否可写
 */
export async function canWriteTimeline(username, entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed || parsed.nodeHash !== getNodeHash()) return false
	try {
		const row = await loadEntityIdentity(username, parsed.entityHash)
		const secretHex = await getEntitySecretKey(username, parsed.entityHash)
		if (!secretHex || secretHex.length !== 64) return false
		const activeSender = pubKeyHash(publicKeyFromSeed(new Uint8Array(Buffer.from(secretHex, 'hex'))))
		const recoveryPub = normalizeRecovery(row.recoveryPubKeyHex)
		if (parsed.subjectHash === recoverySubjectHashFromPubKeyHex(recoveryPub)) return true
		if (parsed.subjectHash === activeSender) return true
		return true
	}
	catch {
		return false
	}
}

/**
 * @param {string} hex recovery pub
 * @returns {string} normalized
 */
function normalizeRecovery(hex) {
	return String(hex || '').trim().toLowerCase()
}

/**
 * @param {string} username replica 登录名
 * @param {string} entityHash 128 hex
 * @returns {Promise<void>}
 */
export async function assertWritableTimeline(username, entityHash) {
	if (!await canWriteTimeline(username, entityHash))
		throw new Error('cannot write timeline for this entity on this replica')
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @param {object} event 未签名事件
 * @param {Uint8Array} secretKey 签名私钥
 * @returns {Promise<object>} 签名事件
 */
async function appendSignedTimelineEvent(username, entityHash, event, secretKey) {
	await assertWritableTimeline(username, entityHash)
	if (event.type !== 'social_meta' && event.type !== 'entity_key_rotate')
		await assertSocialMetaExists(username, entityHash)
	const groupId = groupIdForTimeline(entityHash)
	const previous = await readJsonl(timelineEventsPath(username, entityHash))
	const { hlc, prev_event_ids } = computeAppendHlcAndPrev(previous, event)
	const { sender } = timelineSignerFromSecret(secretKey)
	const charPartName = event.charPartName
		?? await resolveCharPartNameForEntity(username, entityHash)
	const base = {
		type: event.type,
		groupId,
		sender,
		charPartName: charPartName ?? null,
		timestamp: event.timestamp ?? Date.now(),
		hlc,
		prev_event_ids,
		content: event.content ?? {},
		node_id: NODE_ID,
	}
	const signed = await signTimelineEvent(base, secretKey)
	const row = canonicalizeLocalTimelineEvent(signed)
	await appendJsonlSynced(timelineEventsPath(username, entityHash), row)
	invalidateTimelineMaterializedCache(username, entityHash)
	invalidateTimelineOwnerIndex(username)
	await projectFollowerIndexFromTimelineEvent(username, entityHash, row)
	await projectPollVoteFromTimelineEvent(username, entityHash, row)
	await projectReactionFromTimelineEvent(username, entityHash, row)
	await projectNoteFromTimelineEvent(username, entityHash, row)
	await maintainSocialTimeline(username, entityHash)
	const { appendInboxFromTimelineEvent } = await import('../inbox.mjs')
	await appendInboxFromTimelineEvent(username, entityHash, row)
	const { indexTimelineEventForSearch } = await import('../searchIndex.mjs')
	await indexTimelineEventForSearch(username, entityHash, row)
	return row
}

/**
 * 解析写事件签名者：缺省为时间线 owner；owner 改/删所属实体帖时可指定 signerEntityHash。
 * @param {string} username replica 登录名
 * @param {string} entityHash 时间线 owner
 * @param {object} event 未签名事件
 * @param {string} [signerEntityHash] 签名实体（缺省 = 时间线 owner）
 * @returns {Promise<string>} 规范化 signer entityHash
 */
async function resolveTimelineEventSigner(username, entityHash, event, signerEntityHash) {
	const timelineOwner = String(entityHash || '').trim().toLowerCase()
	const signer = String(signerEntityHash || timelineOwner).trim().toLowerCase()
	if (signer === timelineOwner) return signer
	if (event?.type !== 'post_delete' && event?.type !== 'post_edit')
		throw new Error('foreign signer only allowed for post_delete or post_edit')
	const profile = await getEntityProfile(username, timelineOwner)
	const owner = String(profile?.ownerEntityHash || '').trim().toLowerCase()
	if (!owner || owner !== signer)
		throw new Error('signer is not owner of timeline entity')
	return signer
}

/**
 * 向时间线追加一条签名事件（缺省实体自身活跃钥；owner 删帖可改 signer）。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @param {object} event 未签名事件（type/content/timestamp）
 * @param {{ signerEntityHash?: string }} [options] 签名选项
 * @returns {Promise<object>} 签名事件
 */
export async function appendTimelineEvent(username, entityHash, event, options = {}) {
	const signer = await resolveTimelineEventSigner(username, entityHash, event, options.signerEntityHash)
	const { secretKey } = await resolveActiveTimelineSigner(username, signer)
	return appendSignedTimelineEvent(username, entityHash, event, secretKey)
}

/**
 * 创建 social_meta + entity_key_rotate 创世事件。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @returns {Promise<void>}
 */
export async function ensureSocialMeta(username, entityHash) {
	const previous = await readJsonl(timelineEventsPath(username, entityHash))
	if (previous.some(event => event.type === 'social_meta')) return

	const recoveryPubKeyHex = await getRecoveryPubKeyHex(username, entityHash)
	const { secretKey: activeSecret } = await resolveActiveTimelineSigner(username, entityHash)
	const activePubKeyHex = Buffer.from(publicKeyFromSeed(activeSecret)).toString('hex')

	await appendSignedTimelineEvent(username, entityHash, {
		type: 'social_meta',
		content: {
			hideFromDiscovery: false,
			createdAt: Date.now(),
			recoveryPubKeyHex,
		},
	}, activeSecret)

	if (!previous.some(event => event.type === 'entity_key_rotate')) {
		const recoverySecretHex = consumePendingRecoverySecret(username, entityHash)
		if (recoverySecretHex) {
			const recoverySecret = new Uint8Array(Buffer.from(recoverySecretHex, 'hex'))
			await appendSignedTimelineEvent(username, entityHash, {
				type: 'entity_key_rotate',
				content: {
					generation: 0,
					activePubKeyHex,
					prevGeneration: null,
				},
			}, recoverySecret)
		}
	}
}

/**
 * 校验时间线已有 social_meta 创世事件。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @returns {Promise<void>}
 */
async function assertSocialMetaExists(username, entityHash) {
	const previous = await readJsonl(timelineEventsPath(username, entityHash))
	if (!previous.some(event => event.type === 'social_meta'))
		throw new Error('timeline missing social_meta; call ensureEntitySocialReady first')
}

/**
 * 读取时间线全部 events.jsonl 事件。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @returns {Promise<object[]>} 全部事件
 */
export async function readTimelineEvents(username, entityHash) {
	return readJsonl(timelineEventsPath(username, entityHash))
}

/**
 * 签名写盘并按需联邦 fanout。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @param {object} event 未签名事件
 * @param {{ fanout?: boolean, signerEntityHash?: string }} [options] 默认 fanout=true
 * @returns {Promise<object>} 签名事件
 */
export async function commitTimelineEvent(username, entityHash, event, options = {}) {
	const signed = await appendTimelineEvent(username, entityHash, event, {
		signerEntityHash: options.signerEntityHash,
	})
	if (options.fanout !== false)
		await publishTimelineEvent(username, entityHash, signed)
	if (signed.type === 'post') {
		const { dispatchSocialMessage } = await import('../dispatch.mjs')
		await dispatchSocialMessage(username, entityHash, signed)
		if (signed.content?.poll) {
			const { schedulePollDeadlineForPost } = await import('../lib/pollDeadlineWatcher.mjs')
			void schedulePollDeadlineForPost(username, entityHash, signed)
		}
	}
	return signed
}
