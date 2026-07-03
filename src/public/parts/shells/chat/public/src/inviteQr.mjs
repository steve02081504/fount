/**
 * 【文件】public/src/inviteQr.mjs
 * 【职责】入群邀请 QR 与 run URI / protocol 分享链接组装。
 */
import { formatJoinRunUri, wrapProtocolHttpsUrl } from '../shared/runUri.mjs'

/**
 * @param {string} url 完整入群 URL
 * @param {number} [size] 边长像素
 * @returns {string} img src URL
 */
export function inviteJoinQrImageUrl(url, size = 200) {
	return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`
}

/**
 * @param {string} groupId 群 ID
 * @param {string} [inviteCode] 邀请码
 * @param {string} [roomSecret] 群房间传输密钥
 * @param {string} [introducerPubKeyHash] 邀请人公钥 hex（64 字符）
 * @returns {string} `https://steve02081504.github.io/fount/protocol?url=…`
 */
export function buildInviteJoinShareUrl(groupId, inviteCode, roomSecret, introducerPubKeyHash) {
	return wrapProtocolHttpsUrl(formatJoinRunUri(groupId, inviteCode, roomSecret, introducerPubKeyHash))
}
