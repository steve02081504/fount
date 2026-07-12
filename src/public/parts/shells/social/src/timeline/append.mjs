import { Buffer } from 'node:buffer'

import { pubKeyHash, publicKeyFromSeed } from '../../../../../../scripts/p2p/crypto.mjs'
import { appendJsonlSynced, readJsonl } from '../../../../../../scripts/p2p/dag/storage.mjs'
import { parseEntityHash } from '../../../../../../scripts/p2p/entity_id.mjs'
import { getNodeHash } from '../../../../../../scripts/p2p/node/identity.mjs'
import { recoverySubjectHashFromPubKeyHex } from '../../../../../../scripts/p2p/operator_key_chain.mjs'
import { projectFollowerIndexFromTimelineEvent } from '../federation/follower_index.mjs'
import { computeAppendHlcAndPrev, signTimelineEvent } from '../../../../../../scripts/p2p/timeline/append_core.mjs'
import { getAgentCharResolver } from '../../../../../../scripts/p2p/entity/hosting_registry.mjs'
import {
	consumePendingRecoverySecret,
	getOperatorSecretKey,
	getRecoveryPubKeyHex,
} from '../../../../../../server/p2p_server/operator_identity.mjs'
import { groupIdForTimeline, timelineEventsPath } from '../paths.mjs'


import { canonicalizeLocalTimelineEvent } from './canonicalizeEvent.mjs'
import { publishTimelineEvent } from './fanout.mjs'
import { invalidateTimelineMaterializedCache, maintainSocialTimeline } from './materialize.mjs'
import { invalidateTimelineOwnerIndex } from './ownerIndex.mjs'

const NODE_ID = 'social-local'

/**
 * @param {string} username replica 登录名
 * @returns {Promise<Uint8Array | null>} 活跃 operator 私钥
 */
async function loadActiveSecretKey(username) {
	const secretHex = await getOperatorSecretKey(username)
	if (!secretHex || secretHex.length !== 64) return null
	return new Uint8Array(Buffer.from(secretHex, 'hex'))
}

/**
 * @param {string} username replica 登录名
 * @param {Uint8Array} secretKey 签名私钥
 * @returns {{ sender: string, secretKey: Uint8Array }} 时间线签名者
 */
function timelineSignerFromSecret(secretKey) {
	return { sender: pubKeyHash(publicKeyFromSeed(secretKey)), secretKey }
}

/**
 * @param {string} username replica 登录名
 * @returns {Promise<{ sender: string, secretKey: Uint8Array }>} 活跃钥签名者
 */
async function resolveActiveTimelineSigner(username) {
	const secretKey = await loadActiveSecretKey(username)
	if (!secretKey) throw new Error('configure federation identity before posting')
	return timelineSignerFromSecret(secretKey)
}

/**
 * @param {Uint8Array} recoverySecretKey recovery 私钥
 * @returns {{ sender: string, secretKey: Uint8Array }} recovery 签名者
 */
function resolveRecoveryTimelineSigner(recoverySecretKey) {
	return timelineSignerFromSecret(recoverySecretKey)
}

/**
 * 本 replica 是否可代写该 entity 的时间线。
 * @param {string} username replica 登录名
 * @param {string} entityHash 128 位 entityHash
 * @returns {Promise<boolean>} 是否可写
 */
export async function canWriteTimeline(username, entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed || parsed.nodeHash !== getNodeHash()) return false
	const secretKey = await loadActiveSecretKey(username)
	if (!secretKey) return false
	const activeSender = pubKeyHash(publicKeyFromSeed(secretKey))
	const recoveryPub = await getRecoveryPubKeyHex(username)
	if (parsed.subjectHash === recoverySubjectHashFromPubKeyHex(recoveryPub)) return true
	if (parsed.subjectHash === activeSender) return true
	const resolveAgentCharPartName = getAgentCharResolver()
	return resolveAgentCharPartName?.(username, parsed.entityHash) != null
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
	if (event.type !== 'social_meta' && event.type !== 'operator_key_rotate')
		await assertSocialMetaExists(username, entityHash)
	const groupId = groupIdForTimeline(entityHash)
	const previous = await readJsonl(timelineEventsPath(username, entityHash))
	const { hlc, prev_event_ids } = computeAppendHlcAndPrev(previous, event)
	const { sender } = timelineSignerFromSecret(secretKey)
	const base = {
		type: event.type,
		groupId,
		sender,
		charPartName: event.charPartName ?? null,
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
	await maintainSocialTimeline(username, entityHash)
	const { appendInboxFromTimelineEvent } = await import('../inbox.mjs')
	await appendInboxFromTimelineEvent(username, entityHash, row)
	const { indexTimelineEventForSearch } = await import('../searchIndex.mjs')
	await indexTimelineEventForSearch(username, entityHash, row)
	return row
}

/**
 * 向时间线追加一条签名事件（默认活跃钥签名）。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @param {object} event 未签名事件（type/content/timestamp）
 * @returns {Promise<object>} 签名事件
 */
export async function appendTimelineEvent(username, entityHash, event) {
	const { secretKey } = await resolveActiveTimelineSigner(username)
	return appendSignedTimelineEvent(username, entityHash, event, secretKey)
}

/**
 * 创建 social_meta + operator_key_rotate 创世事件。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @returns {Promise<void>}
 */
export async function ensureSocialMeta(username, entityHash) {
	const previous = await readJsonl(timelineEventsPath(username, entityHash))
	if (previous.some(event => event.type === 'social_meta')) return

	const recoveryPubKeyHex = await getRecoveryPubKeyHex(username)
	const { secretKey: activeSecret } = await resolveActiveTimelineSigner(username)
	const activePubKeyHex = Buffer.from(publicKeyFromSeed(activeSecret)).toString('hex')

	await appendSignedTimelineEvent(username, entityHash, {
		type: 'social_meta',
		content: {
			hideFromDiscovery: false,
			exploreBlurb: '',
			createdAt: Date.now(),
			recoveryPubKeyHex,
		},
	}, activeSecret)

	if (!previous.some(event => event.type === 'operator_key_rotate')) {
		const recoverySecretHex = consumePendingRecoverySecret(username)
		if (recoverySecretHex) {
			const recoverySecret = new Uint8Array(Buffer.from(recoverySecretHex, 'hex'))
			await appendSignedTimelineEvent(username, entityHash, {
				type: 'operator_key_rotate',
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
 * @param {{ fanout?: boolean }} [options] 默认 fanout=true
 * @returns {Promise<object>} 签名事件
 */
export async function commitTimelineEvent(username, entityHash, event, options = {}) {
	const signed = await appendTimelineEvent(username, entityHash, event)
	if (options.fanout !== false)
		await publishTimelineEvent(username, entityHash, signed)
	return signed
}

/**
 *
 */
export { commitOperatorKeyRotate, commitOperatorKeyRevoke } from './operator_key_commit.mjs'
