/**
 * 【文件】`dag/entityBinding.mjs` — member_join 实体声明绑定签名。
 * 【职责】用实体 active 钥对（entityHash, 群成员 pubKeyHash）签发 / 校验 bindingSig。
 * 【原理】消息域 `fount-chat-member-bind\0${entityHash}\0${memberPubKeyHash}`；远端凭 content.entityActivePubKeyHex 验签。
 */
import { Buffer } from 'node:buffer'

import { sign, verify } from 'npm:@steve02081504/fount-p2p/crypto'
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

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
	const eh = String(entityHash || '').trim().toLowerCase()
	const mh = String(memberPubKeyHash || '').trim().toLowerCase()
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
	const eh = String(entityHash || '').trim().toLowerCase()
	const mh = String(memberPubKeyHash || '').trim().toLowerCase()
	const sig = String(bindingSig || '').trim().toLowerCase().replace(/^0x/iu, '')
	const pub = normalizeHex64(entityActivePubKeyHex || '')
	if (!isEntityHash128(eh) || !isHex64(mh) || !SIG_HEX_RE.test(sig) || !isHex64(pub))
		return false
	return verify(
		new Uint8Array(Buffer.from(sig, 'hex')),
		memberBindMessage(eh, mh),
		new Uint8Array(Buffer.from(pub, 'hex')),
	)
}

/**
 * 为本机实体生成 member_join content 所需的绑定字段。
 * @param {string} username replica 所有者
 * @param {string} entityHash 128-hex
 * @param {string} memberPubKeyHash 群成员 pubKeyHash
 * @returns {Promise<{ entityHash: string, entityActivePubKeyHex: string, bindingSig: string }>}
 */
export async function buildMemberJoinBindingFields(username, entityHash, memberPubKeyHash) {
	const {
		getEntityActivePubKey,
		getEntitySecretKey,
	} = await import('../../../../../../../server/p2p_server/entity_identity.mjs')
	const eh = String(entityHash || '').trim().toLowerCase()
	const entityActivePubKeyHex = normalizeHex64(await getEntityActivePubKey(username, eh))
	const secretHex = await getEntitySecretKey(username, eh)
	const entityActiveSecretKey = new Uint8Array(Buffer.from(secretHex, 'hex'))
	const { bindingSig } = await buildMemberJoinBinding({
		entityHash: eh,
		memberPubKeyHash,
		entityActiveSecretKey,
	})
	return { entityHash: eh, entityActivePubKeyHex, bindingSig }
}
