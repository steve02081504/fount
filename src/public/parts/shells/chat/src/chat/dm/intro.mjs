/**
 * 【文件】dm/intro.mjs
 * 【职责】§16 DM 介绍 nonce 的签发、轮换与持久化（shellData），供 First Contact 链接与入站校验。
 * 【原理】rotateDmIntroNonce 写 dmIntro 键；signDmIntroLink 用本地联邦 identity 私钥签 nonce；dmIntroNonceMatches 比对。buildDmIntroLink 组装 fount://run URI。
 * 【数据结构】shellData chat/dmIntro：{ nonce, rotatedAt }；签名走 dmLinkSignableBytes。
 * 【关联】dm/linkValidate、lib/dmLinkSignature、lib/runUri formatDmRunUri；setting_loader、federation/config。
 */
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

import { sign } from '../../../../../../../scripts/p2p/crypto.mjs'
import { HEX_ID_64 as PUB_KEY_HEX_64, normalizeHex64 as normalizePubKeyHex } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { assignShellData, loadShellData } from '../../../../../../../server/setting_loader.mjs'
import { dmLinkSignableBytes } from '../lib/dmLinkSignature.mjs'
import { formatDmRunUri } from '../lib/runUri.mjs'

const STORE_KEY = 'dmIntro'

/**
 * @param {string} username 用户
 * @returns {{ nonce: string, rotatedAt: number }} 当前 nonce 行
 */
function loadDmIntro(username) {
	const raw = loadShellData(username, 'chat', STORE_KEY)
	const nonce = String(raw?.nonce || '').trim()
	if (nonce.length >= 16)
		return { nonce, rotatedAt: Number(raw?.rotatedAt) || 0 }
	return rotateDmIntroNonce(username)
}

/**
 * @param {string} username 用户
 * @returns {{ nonce: string, rotatedAt: number }} 新 nonce 行
 */
export function rotateDmIntroNonce(username) {
	const row = { nonce: randomBytes(32).toString('base64url'), rotatedAt: Date.now() }
	assignShellData(username, 'chat', STORE_KEY, row)
	return row
}

/**
 * @param {string} username 用户
 * @returns {{ nonce: string, rotatedAt: number }} 当前 nonce 行
 */
export function getDmIntroNonce(username) {
	return loadDmIntro(username)
}

/**
 * 将客户端轮换后的 nonce 写入本节点 shellData（§16；供入站 DM Link 校验）。
 * @param {string} username 用户
 * @param {string} nonce base64url nonce
 * @returns {{ nonce: string, rotatedAt: number }} 持久化行
 */
export function setDmIntroNonce(username, nonce) {
	const normalized = String(nonce || '').trim()
	if (normalized.length < 16) throw new Error('dmIntro nonce too short')
	const row = { nonce: normalized, rotatedAt: Date.now() }
	assignShellData(username, 'chat', STORE_KEY, row)
	return row
}

/**
 * @param {string} username 用户
 * @param {string} nonceBase64Url 待校验 nonce
 * @returns {boolean} 是否与当前有效 nonce 一致
 */
export function dmIntroNonceMatches(username, nonceBase64Url) {
	const normalized = String(nonceBase64Url || '').trim()
	return normalized.length > 0 && getDmIntroNonce(username).nonce === normalized
}

/**
 * @param {string} username 用户
 * @param {string} pubKeyHex 64 hex 介绍者公钥
 * @param {Uint8Array} secretKey32 私钥种子
 * @param {string} [nodeUrl] 可选节点 URL
 * @returns {Promise<{ url: string, nonce: string, pubKeyHex: string, introSignatureHex: string }>} 签名后的链接
 */
export async function buildDmIntroLink(username, pubKeyHex, secretKey32, nodeUrl) {
	const pubKey = normalizePubKeyHex(pubKeyHex)
	if (!PUB_KEY_HEX_64.test(pubKey)) throw new Error('pubKeyHex must be 64 hex chars')
	if (!secretKey32 || secretKey32.length < 32) throw new Error('secretKeyHex required (32 bytes)')

	const { nonce } = getDmIntroNonce(username)
	const introSignatureHex = Buffer.from(await sign(dmLinkSignableBytes(pubKey, nonce), secretKey32.slice(0, 32))).toString('hex')
	const url = formatDmRunUri({
		pubKeyHex: pubKey,
		nonceBase64Url: nonce,
		introSignatureHex,
		nodeUrl: nodeUrl ? String(nodeUrl).trim() : undefined,
	})
	return { url, nonce, pubKeyHex: pubKey, introSignatureHex }
}
