import { Buffer } from 'node:buffer'

import { pubKeyHash, publicKeyFromSeed } from '../../../../../../scripts/p2p/crypto.mjs'
import { appendJsonlSynced, readJsonl } from '../../../../../../scripts/p2p/dag/storage.mjs'
import { resolveAgentCharPartName } from '../../../../../../scripts/p2p/entity/agentResolve.mjs'
import { getLocalNodeHash } from '../../../../../../scripts/p2p/entity/replica.mjs'
import { parseEntityHash } from '../../../../../../scripts/p2p/entity_id.mjs'
import { getFederationIdentitySecret } from '../../../../../../scripts/p2p/federation/identity.mjs'
import { publishTimelineEvent } from '../../../../../../scripts/p2p/part_wire.mjs'
import { projectFollowerIndexFromTimelineEvent } from '../../../../../../scripts/p2p/social/follower_index.mjs'
import { computeAppendHlcAndPrev, signTimelineEvent } from '../../../../../../scripts/p2p/timeline/append_core.mjs'
import { groupIdForTimeline, timelineEventsPath } from '../paths.mjs'


import { canonicalizeLocalTimelineEvent } from './canonicalizeEvent.mjs'
import { invalidateTimelineMaterializedCache } from './materialize.mjs'
import { invalidateTimelineOwnerIndex } from './ownerIndex.mjs'

const NODE_ID = 'social-local'

/**
 * 创建 social_meta 创世事件（仅 bootstrap 路径调用）。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @returns {Promise<void>}
 */
export async function ensureSocialMeta(username, entityHash) {
	const previous = await readJsonl(timelineEventsPath(username, entityHash))
	if (previous.some(event => event.type === 'social_meta')) return
	await appendTimelineEvent(username, entityHash, {
		type: 'social_meta',
		content: {
			isProtected: false,
			exploreBlurb: '',
			createdAt: Date.now(),
		},
	})
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
 * @param {string} username replica 登录名
 * @returns {Uint8Array | null} 联邦 identity 私钥
 */
function loadFederationIdentitySecretKey(username) {
	const secretHex = getFederationIdentitySecret(username)
	if (!secretHex || secretHex.length !== 64) return null
	return new Uint8Array(Buffer.from(secretHex, 'hex'))
}

/**
 * 解析本 replica 时间线事件的签名者身份与密钥。
 * @param {string} username replica 登录名
 * @returns {{ sender: string, secretKey: Uint8Array }} 时间线签名者
 */
function resolveTimelineSigner(username) {
	const secretKey = loadFederationIdentitySecretKey(username)
	if (!secretKey) throw new Error('configure federation identity before posting')
	return { sender: pubKeyHash(publicKeyFromSeed(secretKey)), secretKey }
}

/**
 * 本 replica 是否可代写该 entity 的时间线。
 * Social 账号 = Chat P2P 实体：用户 identity 或本机托管的 agent（chars/）。
 * @param {string} username replica 登录名
 * @param {string} entityHash 128 位 entityHash
 * @returns {boolean} 是否可写
 */
export function canWriteTimeline(username, entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed || parsed.nodeHash !== getLocalNodeHash(username)) return false
	const secretKey = loadFederationIdentitySecretKey(username)
	if (!secretKey) return false
	const sender = pubKeyHash(publicKeyFromSeed(secretKey))
	if (parsed.subjectHash === sender) return true
	return resolveAgentCharPartName(username, parsed.entityHash) !== null
}

/**
 * 校验当前 replica 是否可写入指定 entity 时间线。
 * @param {string} username replica 登录名
 * @param {string} entityHash 128 hex
 * @returns {Promise<void>}
 */
export async function assertWritableTimeline(username, entityHash) {
	if (!canWriteTimeline(username, entityHash))
		throw new Error('cannot write timeline for this entity on this replica')
}

/**
 * 向时间线追加一条签名事件并 canonicalize 入库。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @param {object} event 未签名事件（type/content/timestamp）
 * @returns {Promise<object>} 签名事件
 */
export async function appendTimelineEvent(username, entityHash, event) {
	await assertWritableTimeline(username, entityHash)
	if (event.type !== 'social_meta')
		await assertSocialMetaExists(username, entityHash)
	const groupId = groupIdForTimeline(entityHash)
	const previous = await readJsonl(timelineEventsPath(username, entityHash))
	const { hlc, prev_event_ids } = computeAppendHlcAndPrev(previous, event)

	const { sender, secretKey } = resolveTimelineSigner(username)
	const base = {
		type: event.type,
		groupId,
		sender,
		charId: event.charId ?? null,
		timestamp: event.timestamp,
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
	return row
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
