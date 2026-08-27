/**
 * 【文件】`dag/entityBinding.mjs` — member_join 实体声明绑定签名。
 * 【职责】用实体 active 钥对（entityHash, 群成员 pubKeyHash）签发 / 校验 bindingSig；并证明 active 钥确属该 entityHash（本机 identity 或 EVFS profile）。
 * 【原理】消息域 `fount-chat-member-bind\0${entityHash}\0${memberPubKeyHash}`；远端凭 content.entityActivePubKeyHex 验签后再对归属做二次证明。
 */
import { Buffer } from 'node:buffer'

import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { sign, verify } from 'npm:@steve02081504/fount-p2p/crypto'

const BIND_DOMAIN = 'fount-chat-member-bind'
const SIG_HEX_RE = /^[\da-f]{128}$/u

/**
 * @param {string} entityHash 128-hex
 * @param {string} memberPubKeyHash 64-hex 群成员键
 * @returns {Uint8Array} 待签字节
 */
export function memberBindMessage(entityHash, memberPubKeyHash) {
	return new TextEncoder().encode(`${BIND_DOMAIN}\0${entityHash}\0${memberPubKeyHash}`)
}

/**
 * @param {{ entityHash: string, memberPubKeyHash: string, entityActiveSecretKey: Uint8Array }} args 绑定参数
 * @returns {Promise<{ entityHash: string, bindingSig: string }>} 声明字段
 */
export async function buildMemberJoinBinding({ entityHash, memberPubKeyHash, entityActiveSecretKey }) {
	const eh = entityHash || ''
	const mh = memberPubKeyHash || ''
	if (!isEntityHash128(eh) || !isHex64(mh))
		throw new Error('buildMemberJoinBinding: invalid entityHash or memberPubKeyHash')
	const signature = await sign(memberBindMessage(eh, mh), entityActiveSecretKey)
	return { entityHash: eh, bindingSig: Buffer.from(signature).toString('hex') }
}

/**
 * @param {{ entityHash: string, memberPubKeyHash: string, bindingSig: string, entityActivePubKeyHex: string }} args 验签参数
 * @returns {Promise<boolean>} 合法为 true
 */
export async function verifyMemberJoinBinding({ entityHash, memberPubKeyHash, bindingSig, entityActivePubKeyHex }) {
	const eh = entityHash || ''
	const mh = memberPubKeyHash || ''
	const sig = (bindingSig || '').replace(/^0x/iu, '')
	if (!isEntityHash128(eh) || !isHex64(mh) || !SIG_HEX_RE.test(sig) || !isHex64(entityActivePubKeyHex))
		return false
	return verify(
		new Uint8Array(Buffer.from(sig, 'hex')),
		memberBindMessage(eh, mh),
		new Uint8Array(Buffer.from(entityActivePubKeyHex, 'hex')),
	)
}

/**
 * 证明 `entityActivePubKeyHex` 确为 `entityHash` 当前活跃钥（本机 identity 或 EVFS 公开 profile）。
 * 仅验 bindingSig 不够——攻击者可用自备钥签任意 entityHash 声明。
 * @param {string} username replica（读本机 identity / EVFS 缓存）
 * @param {string} entityHash 128-hex
 * @param {string} entityActivePubKeyHex 64-hex 声明活跃公钥
 * @returns {Promise<{ ok: boolean, deferrable?: boolean, reason?: string }>} 归属结果
 */
export async function verifyEntityActivePubKeyBelongs(username, entityHash, entityActivePubKeyHex) {
	const eh = entityHash || ''
	const user = username || ''
	if (!user || !isEntityHash128(eh) || !isHex64(entityActivePubKeyHex))
		return { ok: false, reason: 'invalid entity active key ownership args' }

	try {
		const { findLocalEntityActivePubKey, getEntityActivePubKey } = await import('../../entity/identity.mjs')
		try {
			const localActive = await getEntityActivePubKey(user, eh)
			if (localActive === entityActivePubKeyHex) return { ok: true }
			return { ok: false, reason: 'entityActivePubKeyHex mismatch local identity' }
		}
		catch {
			// 同进程其他 replica 已托管该实体（联邦仿真 / 单机多用户）
			const hosted = findLocalEntityActivePubKey(eh)
			if (hosted) {
				if (hosted === entityActivePubKeyHex) return { ok: true }
				return { ok: false, reason: 'entityActivePubKeyHex mismatch local identity' }
			}
		}
	}
	catch {
		/* 非本机托管实体 → EVFS */
	}

	const { readPublicFile } = await import('npm:@steve02081504/fount-p2p/files/evfs')
	let plain
	try {
		plain = await readPublicFile(user, eh, 'profile.json')
	}
	catch {
		return { ok: false, deferrable: true, reason: 'entity profile fetch failed' }
	}
	if (!plain)
		return { ok: false, deferrable: true, reason: 'entity profile unavailable for active key check' }

	let payload
	try {
		payload = JSON.parse(plain.toString('utf8'))
	}
	catch {
		return { ok: false, reason: 'entity profile unreadable' }
	}
	if (String(payload?.entityHash || '') !== eh)
		return { ok: false, reason: 'entity profile entityHash mismatch' }
	if (isHex64(payload.activePubKeyHex) !== entityActivePubKeyHex)
		return { ok: false, reason: 'entityActivePubKeyHex mismatch EVFS profile' }
	return { ok: true }
}

/**
 * 为本机实体生成 member_join content 所需的绑定字段。
 * @param {string} username replica 所有者
 * @param {string} entityHash 128-hex
 * @param {string} memberPubKeyHash 群成员 pubKeyHash
 * @returns {Promise<{ entityHash: string, entityActivePubKeyHex: string, bindingSig: string }>} member_join 绑定字段
 */
export async function buildMemberJoinBindingFields(username, entityHash, memberPubKeyHash) {
	const {
		getEntityActivePubKey,
		getEntitySecretKey,
	} = await import('../../entity/identity.mjs')
	const eh = entityHash || ''
	const entityActivePubKeyHex = await getEntityActivePubKey(username, eh)
	const secretHex = await getEntitySecretKey(username, eh)
	const entityActiveSecretKey = new Uint8Array(Buffer.from(secretHex, 'hex'))
	const { bindingSig } = await buildMemberJoinBinding({
		entityHash: eh,
		memberPubKeyHash,
		entityActiveSecretKey,
	})
	return { entityHash: eh, entityActivePubKeyHex, bindingSig }
}
