/**
 * 主人远程更新被管实体资料：主人 EVFS 发布 + home 拉取应用 + mailbox poke/ack。
 * 路径：owned/{targetEntityHash}/profile_update/{profile.json,avatar,banner}
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { isEntityHash128, parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { readPublicFile } from 'npm:@steve02081504/fount-p2p/files/evfs'
import { publishPublicFile } from 'npm:@steve02081504/fount-p2p/files/public_manifest'
import {
	registerMailboxConsumer,
	unregisterMailboxConsumer,
} from 'npm:@steve02081504/fount-p2p/mailbox/consumer_registry'
import { publishMailboxRecord, requestMailboxFromNetwork } from 'npm:@steve02081504/fount-p2p/mailbox/deliver_or_store'
import { isWritableLocalEntity } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getEntityStore } from 'npm:@steve02081504/fount-p2p/node/instance'

import { assignEntityShellData, loadEntityShellData } from '../../../../../../server/setting_loader.mjs'

import {
	getEntityActivePubKey,
	getEntityRecoverySecretKey,
	getRecoveryPubKeyHex,
	loadEntityIdentity,
	resolveOperatorEntityHashForUser,
} from './identity.mjs'
import {
	fetchAndCacheRemoteProfile,
	getProfile,
	updateProfile,
	uploadAvatar,
	uploadBanner,
} from './profile.mjs'

const MAILBOX_APP_POKE = 'chat_owner_profile_poke'
const MAILBOX_APP_ACK = 'chat_owner_profile_ack'
const PENDING_DATANAME = 'ownerProfilePending'
const APPLIED_SIDECAR = 'ownerProfileUpdate.json'
const TOMBSTONE_MIME = 'application/x-fount-tombstone'

const UPDATE_FIELD_WHITELIST = new Set([
	'localized',
	'handle',
	'themeColor',
	'banner',
	'status',
	'customStatus',
	'ownerEntityHash',
])

/**
 * @param {string} targetEntityHash 被管实体
 * @param {string} leaf 文件名
 * @returns {string} EVFS logicalPath
 */
export function ownedProfileUpdatePath(targetEntityHash, leaf) {
	return `owned/${String(targetEntityHash).toLowerCase()}/profile_update/${leaf}`
}

/**
 * @param {string} targetEntityHash 被管实体
 * @returns {string} 前缀
 */
export function ownedProfilePrefix(targetEntityHash) {
	return `owned/${String(targetEntityHash).toLowerCase()}/`
}

/**
 * @param {object} body 无 contentHash 的正文
 * @returns {string} sha256 hex
 */
export function hashOwnerProfileUpdateBody(body) {
	const canonical = JSON.stringify(body)
	return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/**
 * @param {unknown} raw 原始 updates
 * @returns {object} 白名单字段
 */
export function sanitizeOwnerProfileUpdates(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
	/** @type {Record<string, unknown>} */
	const out = {}
	for (const key of UPDATE_FIELD_WHITELIST) {
		if (raw[key] === undefined) continue
		out[key] = raw[key]
	}
	return out
}

/**
 * @param {unknown} envelope mailbox envelope
 * @returns {{ targetEntityHash: string, ownerEntityHash: string, ts: number, contentHash: string } | null} 合法信封或 null
 */
function parsePokeOrAckEnvelope(envelope) {
	if (!envelope || typeof envelope !== 'object') return null
	const targetEntityHash = String(envelope.targetEntityHash || '').trim().toLowerCase()
	const ownerEntityHash = String(envelope.ownerEntityHash || '').trim().toLowerCase()
	const contentHash = String(envelope.contentHash || '').trim().toLowerCase()
	const ts = Number(envelope.ts)
	if (!isEntityHash128(targetEntityHash)) return null
	if (ownerEntityHash && !isEntityHash128(ownerEntityHash)) return null
	if (contentHash && !/^[0-9a-f]{64}$/.test(contentHash)) return null
	if (!Number.isFinite(ts) || ts <= 0) return null
	return { targetEntityHash, ownerEntityHash, ts, contentHash }
}

/**
 * @param {string} username replica
 * @param {string} ownerEntityHash 主人
 * @param {string} logicalPath 路径
 * @param {Buffer | Uint8Array} plaintext 明文
 * @param {string} [mimeType] MIME
 * @param {string} [name] 文件名
 * @returns {Promise<void>}
 */
async function publishAsOwner(username, ownerEntityHash, logicalPath, plaintext, mimeType, name) {
	const recoverySecretKeyHex = await getEntityRecoverySecretKey(username, ownerEntityHash)
	const recoveryPubKeyHex = await getRecoveryPubKeyHex(username, ownerEntityHash)
	if (!recoverySecretKeyHex || !recoveryPubKeyHex)
		throw new Error('owner recovery key unavailable')
	await publishPublicFile({
		ownerEntityHash,
		logicalPath,
		plaintext,
		name: name || logicalPath.split('/').pop(),
		mimeType: mimeType || 'application/octet-stream',
		entitySecretKey: Buffer.from(recoverySecretKeyHex, 'hex'),
		entityPubKeyHex: recoveryPubKeyHex,
	})
}

/**
 * 墓碑/清理主人 EVFS 上 `owned/{target}/` 前缀。
 * @param {string} username replica
 * @param {string} ownerEntityHash 主人（本机可写）
 * @param {string} targetEntityHash 被管
 * @returns {Promise<void>}
 */
export async function purgeOwnedProfilePublish(username, ownerEntityHash, targetEntityHash) {
	const prefix = ownedProfilePrefix(targetEntityHash)
	const known = [
		ownedProfileUpdatePath(targetEntityHash, 'profile.json'),
		ownedProfileUpdatePath(targetEntityHash, 'avatar'),
		ownedProfileUpdatePath(targetEntityHash, 'banner'),
	]
	/** @type {Set<string>} */
	const paths = new Set(known)
	try {
		for (const path of await getEntityStore().listEntityFiles(ownerEntityHash))
			if (String(path).startsWith(prefix)) paths.add(path)
	}
	catch { /* 无文件列表则只清已知三条 */ }

	const tombstone = Buffer.from(JSON.stringify({ tombstone: true, ts: Date.now() }), 'utf8')
	for (const logicalPath of paths) 
		try {
			await publishAsOwner(
				username,
				ownerEntityHash,
				logicalPath,
				tombstone,
				TOMBSTONE_MIME,
				logicalPath.split('/').pop(),
			)
		}
		catch { /* 单路径失败不阻断 */ }
	

	clearPending(username, ownerEntityHash, targetEntityHash)
}

/**
 * @param {string} username replica
 * @param {string} ownerEntityHash 主人
 * @returns {Record<string, { contentHash: string, ts: number }>} target → pending 行
 */
function loadPendingMap(username, ownerEntityHash) {
	const data = loadEntityShellData(username, 'chat', ownerEntityHash, PENDING_DATANAME)
	return data && typeof data === 'object' ? { ...data } : {}
}

/**
 * @param {string} username replica
 * @param {string} ownerEntityHash 主人
 * @param {string} targetEntityHash 被管
 * @param {{ contentHash: string, ts: number }} entry pending
 * @returns {void}
 */
function savePending(username, ownerEntityHash, targetEntityHash, entry) {
	const map = loadPendingMap(username, ownerEntityHash)
	map[String(targetEntityHash).toLowerCase()] = entry
	assignEntityShellData(username, 'chat', ownerEntityHash, PENDING_DATANAME, map)
}

/**
 * @param {string} username replica
 * @param {string} ownerEntityHash 主人
 * @param {string} targetEntityHash 被管
 * @returns {void}
 */
function clearPending(username, ownerEntityHash, targetEntityHash) {
	const map = loadPendingMap(username, ownerEntityHash)
	const key = String(targetEntityHash).toLowerCase()
	if (!(key in map)) return
	delete map[key]
	assignEntityShellData(username, 'chat', ownerEntityHash, PENDING_DATANAME, map)
}

/**
 * @param {string} entityHash 被管
 * @returns {Promise<number>} lastAppliedTs
 */
async function readLastAppliedTs(entityHash) {
	const row = await getEntityStore().readEntityJson(entityHash, APPLIED_SIDECAR)
	return Number(row?.lastAppliedTs) || 0
}

/**
 * @param {string} entityHash 被管
 * @param {number} ts 已应用 ts
 * @returns {Promise<void>}
 */
async function writeLastAppliedTs(entityHash, ts) {
	await getEntityStore().writeEntityJson(entityHash, APPLIED_SIDECAR, { lastAppliedTs: ts })
}

/**
 * 主人发布远端资料更新。
 * @param {string} username replica
 * @param {string} publisherEntityHash 发布者（通常 operator 或 agent 主人）
 * @param {string} targetEntityHash 被管
 * @param {object} updates 资料字段
 * @param {{ avatar?: { buffer: Buffer|Uint8Array, filename?: string, mimeType?: string }, banner?: { buffer: Buffer|Uint8Array, filename?: string, mimeType?: string } }} [files] 可选文件
 * @returns {Promise<{ queued: true, contentHash: string, ts: number }>} 已入队发布结果
 */
export async function publishOwnerProfileUpdate(username, publisherEntityHash, targetEntityHash, updates, files = {}) {
	const publisher = String(publisherEntityHash).toLowerCase()
	const target = String(targetEntityHash).toLowerCase()
	if (!isEntityHash128(publisher) || !isEntityHash128(target))
		throw new Error('invalid entityHash')

	const remote = await fetchAndCacheRemoteProfile(username, target)
		|| await getProfile(target, username, { skipPresentation: true, fetchRemote: true })
	const declaredOwner = String(remote?.ownerEntityHash || '').toLowerCase()
	if (declaredOwner !== publisher) {
		if (isWritableLocalEntity(publisher))
			await purgeOwnedProfilePublish(username, publisher, target)
		throw new Error('not declared owner of target entity')
	}

	const sanitized = sanitizeOwnerProfileUpdates(updates)
	const ts = Date.now()
	const bodyWithoutHash = {
		targetEntityHash: target,
		ownerEntityHash: publisher,
		updates: sanitized,
		ts,
	}
	const contentHash = hashOwnerProfileUpdateBody(bodyWithoutHash)
	const payload = { ...bodyWithoutHash, contentHash }

	await publishAsOwner(
		username,
		publisher,
		ownedProfileUpdatePath(target, 'profile.json'),
		Buffer.from(JSON.stringify(payload), 'utf8'),
		'application/json',
		'profile.json',
	)

	if (files.avatar?.buffer)
		await publishAsOwner(
			username,
			publisher,
			ownedProfileUpdatePath(target, 'avatar'),
			files.avatar.buffer,
			files.avatar.mimeType || 'image/png',
			files.avatar.filename || 'avatar',
		)

	if (files.banner?.buffer)
		await publishAsOwner(
			username,
			publisher,
			ownedProfileUpdatePath(target, 'banner'),
			files.banner.buffer,
			files.banner.mimeType || 'image/png',
			files.banner.filename || 'banner',
		)
	

	savePending(username, publisher, target, { contentHash, ts })

	const targetActivePub = normalizeHex64(remote?.activePubKeyHex || '')
		|| await (async () => {
			try {
				return normalizeHex64(await getEntityActivePubKey(username, target))
			}
			catch {
				return ''
			}
		})()
	if (isHex64(targetActivePub)) {
		const parsed = parseEntityHash(target)
		await publishMailboxRecord(username, targetActivePub, {
			app: MAILBOX_APP_POKE,
			envelope: {
				targetEntityHash: target,
				ownerEntityHash: publisher,
				ts,
				contentHash,
			},
			fromNodeHash: parsed?.nodeHash || '',
		}, parsed?.nodeHash || '')
	}

	return { queued: true, contentHash, ts }
}

/**
 * @param {Buffer | null} plain EVFS 明文
 * @returns {boolean} 是否墓碑
 */
function isTombstonePlain(plain) {
	if (!plain?.length) return true
	try {
		const obj = JSON.parse(plain.toString('utf8'))
		return !!obj?.tombstone
	}
	catch {
		return false
	}
}

/**
 * home 端拉取并应用主人发布的资料更新。
 * @param {string} username 宿主 replica
 * @param {string} targetEntityHash 本机被管实体
 * @returns {Promise<{ applied: boolean, contentHash?: string }>} 是否应用及 contentHash
 */
export async function pullOwnerProfileUpdate(username, targetEntityHash) {
	const target = String(targetEntityHash).toLowerCase()
	if (!isWritableLocalEntity(target)) return { applied: false }

	let ownerEntityHash
	try {
		ownerEntityHash = String((await loadEntityIdentity(username, target)).ownerEntityHash || '').toLowerCase()
	}
	catch {
		return { applied: false }
	}
	if (!isEntityHash128(ownerEntityHash)) return { applied: false }

	const plain = await readPublicFile(username, ownerEntityHash, ownedProfileUpdatePath(target, 'profile.json'))
	if (!plain || isTombstonePlain(plain)) return { applied: false }

	let payload
	try {
		payload = JSON.parse(plain.toString('utf8'))
	}
	catch {
		return { applied: false }
	}

	const payloadTarget = String(payload?.targetEntityHash || '').toLowerCase()
	const payloadOwner = String(payload?.ownerEntityHash || '').toLowerCase()
	const ts = Number(payload?.ts)
	const contentHash = String(payload?.contentHash || '').toLowerCase()
	if (payloadTarget !== target) return { applied: false }
	if (payloadOwner !== ownerEntityHash) return { applied: false }
	if (!Number.isFinite(ts) || ts <= 0) return { applied: false }
	if (!/^[0-9a-f]{64}$/.test(contentHash)) return { applied: false }

	const expectedHash = hashOwnerProfileUpdateBody({
		targetEntityHash: target,
		ownerEntityHash,
		updates: sanitizeOwnerProfileUpdates(payload.updates),
		ts,
	})
	if (expectedHash !== contentHash) return { applied: false }

	const lastTs = await readLastAppliedTs(target)
	if (ts <= lastTs) return { applied: false }

	const sanitized = sanitizeOwnerProfileUpdates(payload.updates)
	await updateProfile(username, target, sanitized, { skipPresentation: true })

	const avatarPlain = await readPublicFile(username, ownerEntityHash, ownedProfileUpdatePath(target, 'avatar'))
	if (avatarPlain?.length && !isTombstonePlain(avatarPlain)) 
		await uploadAvatar(username, target, avatarPlain, 'avatar.png', 'image/png')
	
	const bannerPlain = await readPublicFile(username, ownerEntityHash, ownedProfileUpdatePath(target, 'banner'))
	if (bannerPlain?.length && !isTombstonePlain(bannerPlain)) 
		await uploadBanner(username, target, bannerPlain, 'banner.png', 'image/png')
	

	await writeLastAppliedTs(target, ts)

	const ownerActivePub = normalizeHex64(
		(await getProfile(ownerEntityHash, username, { skipPresentation: true, fetchRemote: true }))?.activePubKeyHex || '',
	)
	if (isHex64(ownerActivePub)) {
		const parsed = parseEntityHash(ownerEntityHash)
		await publishMailboxRecord(username, ownerActivePub, {
			app: MAILBOX_APP_ACK,
			envelope: {
				targetEntityHash: target,
				ownerEntityHash,
				ts,
				contentHash,
			},
			fromNodeHash: parseEntityHash(target)?.nodeHash || '',
		}, parsed?.nodeHash || '')
	}

	return { applied: true, contentHash }
}

/**
 * 本机可写实体中声明了远端主人的，轮询拉取。
 * @param {string} username replica
 * @returns {Promise<number>} 应用条数
 */
export async function pollOwnedEntityProfileUpdates(username) {
	const { listEntityIdentities } = await import('./store.mjs')
	let applied = 0
	for (const row of await listEntityIdentities(username)) {
		const hash = String(row.entityHash).toLowerCase()
		if (!isWritableLocalEntity(hash)) continue
		const owner = row.ownerEntityHash ? String(row.ownerEntityHash).toLowerCase() : null
		if (!owner || !isEntityHash128(owner)) continue
		if (isWritableLocalEntity(owner)) {
			// 主人也在本机：仍可走直写；轮询可选跳过，但拉取无害
		}
		try {
			const activePub = await getEntityActivePubKey(username, hash)
			if (isHex64(activePub))
				await requestMailboxFromNetwork(username, activePub)
		}
		catch { /* ignore */ }
		const result = await pullOwnerProfileUpdate(username, hash)
		if (result.applied) applied++
	}
	return applied
}

/**
 * 处理 poke：门铃 → 拉取。
 * @param {string} username replica
 * @param {object[]} records mailbox
 * @returns {Promise<string[]>} 已消费 id
 */
async function consumePokeMailbox(username, records) {
	/** @type {string[]} */
	const delivered = []
	const store = getEntityStore()
	for (const row of records) {
		if (!row?.envelope || String(row.app || '') !== MAILBOX_APP_POKE) continue
		const parsed = parsePokeOrAckEnvelope(row.envelope)
		if (!parsed) continue
		if (!isWritableLocalEntity(parsed.targetEntityHash)) continue
		const hostUser = typeof store.findHostingUser === 'function'
			? await store.findHostingUser(parsed.targetEntityHash) || username
			: username
		await pullOwnerProfileUpdate(hostUser, parsed.targetEntityHash)
		delivered.push(row.id)
	}
	return delivered
}

/**
 * 处理 ack：contentHash 匹配则 purge。
 * @param {string} username replica
 * @param {object[]} records mailbox
 * @returns {Promise<string[]>} 已消费 id
 */
async function consumeAckMailbox(username, records) {
	/** @type {string[]} */
	const delivered = []
	for (const row of records) {
		if (!row?.envelope || String(row.app || '') !== MAILBOX_APP_ACK) continue
		const parsed = parsePokeOrAckEnvelope(row.envelope)
		if (!parsed?.contentHash || !parsed.ownerEntityHash) continue
		if (!isWritableLocalEntity(parsed.ownerEntityHash)) continue

		const pending = loadPendingMap(username, parsed.ownerEntityHash)[parsed.targetEntityHash]
		if (!pending || pending.contentHash !== parsed.contentHash) {
			delivered.push(row.id)
			continue
		}

		const remote = await getProfile(parsed.targetEntityHash, username, {
			skipPresentation: true,
			fetchRemote: true,
		}).catch(() => null)
		const declared = String(remote?.ownerEntityHash || '').toLowerCase()
		if (declared !== parsed.ownerEntityHash) {
			await purgeOwnedProfilePublish(username, parsed.ownerEntityHash, parsed.targetEntityHash)
			delivered.push(row.id)
			continue
		}

		await purgeOwnedProfilePublish(username, parsed.ownerEntityHash, parsed.targetEntityHash)
		delivered.push(row.id)
	}
	return delivered
}

/**
 * @returns {void}
 */
export function registerOwnerProfileUpdateMailbox() {
	registerMailboxConsumer(MAILBOX_APP_POKE, consumePokeMailbox)
	registerMailboxConsumer(MAILBOX_APP_ACK, consumeAckMailbox)
}

/**
 * @returns {void}
 */
export function unregisterOwnerProfileUpdateMailbox() {
	unregisterMailboxConsumer(MAILBOX_APP_POKE)
	unregisterMailboxConsumer(MAILBOX_APP_ACK)
}

/**
 * 统一入口：本机直写或远端 EVFS 队列。
 * @param {string} username replica
 * @param {string} actorEntityHash 操作者实体（HTTP 恒为 operator；ChatClient 可为 agent）
 * @param {string} targetEntityHash 目标
 * @param {object} updates 字段（可含 avatar/banner buffer）
 * @param {{ locales?: string[], groupId?: string }} [options] 选项
 * @returns {Promise<object>} `{ profile }` 或 `{ queued, contentHash, ts }`
 */
export async function updateEntityProfileAsActor(username, actorEntityHash, targetEntityHash, updates, options = {}) {
	const { isWritableLocalEntityForUser } = await import('./http.mjs')
	const { avatar, banner, ...fields } = updates
	const target = String(targetEntityHash).toLowerCase()
	const actor = String(actorEntityHash).toLowerCase()
	const operatorHash = await resolveOperatorEntityHashForUser(username)

	let canLocalWrite = false
	if (isWritableLocalEntity(target)) 
		if (actor === target)
			canLocalWrite = true
		else if (operatorHash && actor === operatorHash && await isWritableLocalEntityForUser(username, target))
			canLocalWrite = true
		else 
			try {
				const row = await loadEntityIdentity(username, target)
				canLocalWrite = String(row.ownerEntityHash || '').toLowerCase() === actor
			}
			catch { /* 非本用户托管 */ }
		
	

	if (canLocalWrite) {
		if (avatar?.buffer)
			await uploadAvatar(username, target, avatar.buffer, avatar.filename || 'avatar.png', avatar.mimeType)
		if (banner?.buffer)
			await uploadBanner(username, target, banner.buffer, banner.filename || 'banner.png', banner.mimeType)
		const profile = await updateProfile(username, target, fields, {
			groupId: options.groupId,
			locales: options.locales,
		})
		return { profile }
	}

	const profile = await getProfile(target, username, { skipPresentation: true, fetchRemote: true })
	if (String(profile?.ownerEntityHash || '').toLowerCase() !== actor)
		throw Object.assign(new Error('Permission denied'), { status: 403 })

	return publishOwnerProfileUpdate(username, actor, target, fields, {
		...avatar?.buffer ? { avatar } : {},
		...banner?.buffer ? { banner } : {},
	})
}
