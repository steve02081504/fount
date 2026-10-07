import { parseDmRunUri } from '../../../chat/public/shared/runUri.mjs'

/**
 * 解析签名私聊链接或指向实体的私聊页面链接。
 * @param {string} input 用户输入
 * @returns {object} 私聊载荷；页面链接稍后从签名资料解析公钥
 */
export function parseInvitationLink(input) {
	let raw = String(input || '').trim()
	if (raw.startsWith('https://')) {
		const url = new URL(raw)
		if (url.hostname === 'steve02081504.github.io' && url.pathname === '/fount/protocol')
			raw = url.searchParams.get('url') || ''
	}
	if (raw.startsWith('fount://page/')) raw = raw.slice('fount://page'.length)
	if (/^(?:https?:\/\/|\/parts\/)/u.test(raw)) {
		const url = new URL(raw, 'http://localhost')
		const entityHash = url.searchParams.get('contact')
		if (url.pathname !== '/parts/shells:chat/hub/' || !/^[\da-f]{128}$/u.test(entityHash || ''))
			throw new Error('Invalid private chat contact link')
		// 本机页面的 origin 不代表邀请者地址；实体身份携带真正的节点哈希。
		return { entityHash, nodeHash: entityHash.slice(0, 64) }
	}
	const dm = parseDmRunUri(raw)
	if (!dm || !/^[\da-f]{64}$/u.test(dm.pubKeyHex || '') || !/^[\w-]{16,}$/u.test(dm.nonce || '')
		|| !/^[\da-f]{128}$/iu.test(dm.introSignatureHex || ''))
		throw new Error('Invalid private chat invitation link')
	return dm
}
