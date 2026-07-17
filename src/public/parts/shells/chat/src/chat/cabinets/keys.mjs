import { Buffer } from 'node:buffer'

import { HEX_ID_64 as PUB_KEY_HEX_64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { wrapKeyEcies, unwrapKeyEcies } from 'npm:@steve02081504/fount-p2p/crypto/key'

import {
	importSharedCabinetGrant,
	loadSharedKeys,
	rotateSharedReadKey,
} from '../../../../cabinet/src/shared/keys.mjs'
import { appendSignedLocalEvent } from '../dag/append.mjs'
import { resolveLocalEventSigner } from '../dag/localSigner.mjs'
import { getState } from '../dag/materialize.mjs'

/**
 * 成员对某柜的访问级别。
 * @param {object} state 群状态
 * @param {string} memberKey pubKeyHash
 * @param {object} cabinetBind 绑定
 * @returns {'rw' | 'ro' | null} 级别
 */
export function memberCabinetAccess(state, memberKey, cabinetBind) {
	const member = state.members?.[memberKey]
	if (!member || member.status !== 'active') return null
	const roles = member.roles || []
	let best = null
	for (const roleId of roles) {
		const level = cabinetBind.role_access?.[roleId]
		if (level === 'rw') return 'rw'
		if (level === 'ro') best = 'ro'
	}
	return best
}

/**
 * 展开柜访问收件人。
 * @param {object} state 状态
 * @param {object} cabinetBind 绑定
 * @returns {{ rw: string[], ro: string[] }} 成员 pubKeyHash
 */
export function listCabinetAccessMembers(state, cabinetBind) {
	/** @type {string[]} */
	const rw = []
	/** @type {string[]} */
	const ro = []
	for (const memberKey of Object.keys(state.members || {})) {
		const level = memberCabinetAccess(state, memberKey, cabinetBind)
		if (level === 'rw') rw.push(memberKey)
		else if (level === 'ro') ro.push(memberKey)
	}
	return { rw, ro }
}

/**
 * @param {object} state 状态
 * @param {string} cabinetId 柜
 * @param {import('../../../../cabinet/src/shared/keys.mjs').SharedCabinetKeys} keys 密钥
 * @param {{ includeWrite?: boolean, readGens?: number[] }} [opts] 选项
 * @returns {Record<string, { read: object[], write?: object }>} keyWraps
 */
export function buildCabinetKeyWraps(state, cabinetId, keys, opts = {}) {
	const bind = state.cabinets?.[cabinetId]
	if (!bind) return {}
	const { rw, ro } = listCabinetAccessMembers(state, bind)
	const gens = opts.readGens || keys.read_keys.map(row => row.gen)
	/** @type {Record<string, { read: object[], write?: object }>} */
	const wraps = {}

	/**
	 * @param {string} memberKey 成员
	 * @param {boolean} withWrite 是否写私钥
	 * @returns {void}
	 */
	function addMember(memberKey, withWrite) {
		const edPubHex = String(state.members[memberKey]?.pubKeyHex || '').trim().toLowerCase()
		if (!PUB_KEY_HEX_64.test(edPubHex)) return
		/** @type {{ read: object[], write?: object }} */
		const packet = { read: [] }
		for (const gen of gens) {
			const row = keys.read_keys.find(item => item.gen === gen)
			if (!row) continue
			packet.read.push({ gen, encryptedKey: wrapKeyEcies(row.key, edPubHex) })
		}
		if (withWrite && keys.write_privkey)
			packet.write = wrapKeyEcies(keys.write_privkey, edPubHex)
		wraps[memberKey] = packet
	}

	for (const memberKey of rw) addMember(memberKey, opts.includeWrite !== false)
	for (const memberKey of ro) addMember(memberKey, false)
	return wraps
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {{
 *   cabinet_id: string,
 *   name?: string,
 *   write_pubkey: string,
 *   role_access: Record<string, 'rw' | 'ro'>,
 * }} spec 绑定
 * @returns {Promise<object>} 事件
 */
export async function appendCabinetBind(username, groupId, spec) {
	const keys = await loadSharedKeys(username, spec.cabinet_id)
	if (!keys) throw new Error('shared cabinet keys missing on this node')
	const { state } = await getState(username, groupId)
	const provisional = {
		...spec,
		role_access: spec.role_access || {},
	}
	const wraps = buildCabinetKeyWraps(
		{ ...state, cabinets: { ...state.cabinets, [spec.cabinet_id]: provisional } },
		spec.cabinet_id,
		keys,
		{ includeWrite: true },
	)
	return appendSignedLocalEvent(username, groupId, {
		type: 'cabinet_bind',
		content: {
			cabinet_id: spec.cabinet_id,
			name: spec.name || keys.write_pubkey.slice(0, 8),
			write_pubkey: spec.write_pubkey || keys.write_pubkey,
			role_access: spec.role_access,
			keyWraps: wraps,
			read_generation: keys.current_gen,
		},
	})
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} cabinetId 柜
 * @returns {Promise<object>} 事件
 */
export async function appendCabinetUnbind(username, groupId, cabinetId) {
	return appendSignedLocalEvent(username, groupId, {
		type: 'cabinet_unbind',
		content: { cabinet_id: cabinetId },
	})
}

/**
 * 踢人/改角色后：升代并 rewrap。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @returns {Promise<void>}
 */
export async function rotateBoundCabinetKeys(username, groupId) {
	const { state } = await getState(username, groupId)
	const cabinets = state.cabinets || {}
	for (const cabinetId of Object.keys(cabinets)) {
		const keys = await loadSharedKeys(username, cabinetId)
		if (!keys?.write_privkey) continue
		const rotated = await rotateSharedReadKey(username, cabinetId)
		const nextKeys = await loadSharedKeys(username, cabinetId)
		const wraps = buildCabinetKeyWraps(state, cabinetId, nextKeys, {
			includeWrite: true,
			readGens: [rotated.gen],
		})
		await appendSignedLocalEvent(username, groupId, {
			type: 'cabinet_key_update',
			content: {
				cabinet_id: cabinetId,
				keyWraps: wraps,
				read_generation: rotated.gen,
			},
		})
	}
}

/**
 * 从 DAG 事件导入本机 wraps。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {object} event 事件
 * @returns {Promise<void>}
 */
export async function tryImportCabinetKeyWraps(username, groupId, event) {
	if (!['cabinet_bind', 'cabinet_key_update'].includes(event?.type)) return
	const cabinetId = String(event.content?.cabinet_id || '').trim().toLowerCase()
	if (!cabinetId) return
	const { sender, secretKey } = await resolveLocalEventSigner(username, groupId)
	const packet = event.content?.keyWraps?.[sender]
	if (!packet) return

	/** @type {Array<{ gen: number, key: string }>} */
	const readKeys = []
	for (const row of packet.read || []) {
		const key = unwrapKeyEcies(row.encryptedKey, secretKey)
		if (key) readKeys.push({ gen: Number(row.gen) || 0, key })
	}
	let writePriv = undefined
	if (packet.write) {
		const unwrapped = unwrapKeyEcies(packet.write, secretKey)
		if (unwrapped) writePriv = unwrapped
	}
	await importSharedCabinetGrant(username, cabinetId, {
		write_pubkey: String(event.content?.write_pubkey || ''),
		write_privkey: writePriv,
		read_keys: readKeys,
		name: event.content?.name,
	})
	void Buffer
}
