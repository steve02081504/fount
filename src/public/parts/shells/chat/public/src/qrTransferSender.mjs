/**
 * QR 凭证迁移发送端（浏览器侧）
 *
 * 流程：
 *   1. 从服务端取凭证包（群组列表 + 用户名）
 *   2. 浏览器生成随机 AES 密钥 + 迁移 ID
 *   3. 构造接收端 URL（GH Pages / 本地），展示 QR 码
 *   4. 通过 Trystero MQTT 等待接收端连入，连接后加密发送
 */

import { renderTemplate } from '../../../../../pages/scripts/template.mjs'
import { geti18n, setLocalizeLogic } from '../../../../../scripts/i18n.mjs'
import {
	encryptCredentialEnvelope,
	hexToBytes,
	trysteroPasswordFromAesKeyHex,
} from '../../../../../scripts/p2p/qr_transfer_protocol.mjs'

import { handleUIError, normalizeError } from './utils.mjs'

const TRYSTERO_PKG = 'https://esm.sh/@trystero-p2p/mqtt@0.23.0'
const QR_RECEIVER_PATH = '/shells/chat/qr-transfer'   // 本地接收页（若存在）

let currentModal = null

/**
 * 生成 32 字节随机 AES 密钥，返回 hex 字符串
 * @returns {string} 64 位十六进制密钥字符串
 */
function genAesKeyHex() {
	const bytes = crypto.getRandomValues(new Uint8Array(32))
	return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 生成安全的迁移 ID（仅字母数字，16 位）
 * @returns {string} 迁移会话唯一标识
 */
function genTransferId() {
	const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
	return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => chars[b % chars.length]).join('')
}

/**
 * 构造接收端 URL（含 hash）
 * @param {string} receiverBase 接收页基础 URL（末尾可带 /）
 * @param {string} transferId 迁移 ID
 * @param {string} aesKeyHex 对称密钥十六进制（置于 hash 中）
 * @returns {string} 供扫码打开的完整 URL
 */
function buildReceiverUrl(receiverBase, transferId, aesKeyHex) {
	return `${receiverBase}#transfer=${encodeURIComponent(transferId)}&key=${aesKeyHex}`
}

/**
 * 关闭当前弹窗
 */
function closeModal() {
	currentModal?.remove()
	currentModal = null
}

/**
 * 展示 QR 发送弹窗
 */
export async function showQrTransferModal() {
	closeModal()

	// 1. 取服务端凭证包
	let pkg = null
	try {
		const r = await fetch('/api/parts/shells:chat/qr-transfer/package')
		if (!r.ok) throw new Error(`HTTP ${r.status}`)
		pkg = await r.json()
	}
	catch (e) {
		handleUIError(normalizeError(e), 'chat.group.qrTransferFetchFailed', 'QR transfer: fetch package')
		return
	}

	// 2. 生成密钥与 ID
	const transferId = genTransferId()
	const aesKeyHex = genAesKeyHex()

	// 3. 构造接收 URL（固定走当前站点接收页）
	const receiverBase = `${location.origin}${QR_RECEIVER_PATH}/`
	const receiverUrl = buildReceiverUrl(receiverBase, transferId, aesKeyHex)

	// 4. 构建弹窗 DOM
	const modal = document.createElement('div')
	modal.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-base-300/80'
	modal.replaceChildren(await renderTemplate('qr_transfer_modal', {}))
	document.body.appendChild(modal)
	currentModal = modal

	const statusEl = modal.querySelector('#qr-modal-status')
	/**
	 * 更新弹窗底部状态文案。
	 * @param {string} s 状态文本
	 * @returns {void}
	 */
	const setStatus = s => { if (statusEl) statusEl.textContent = s }

	modal.querySelector('#qr-modal-close')?.addEventListener('click', () => {
		closeModal()
		void leaveRoom?.()
	})

	// 5. 生成二维码图片（使用 qrserver.com API）
	const qrContainer = modal.querySelector('#qr-modal-qr')
	const img = document.createElement('img')
	setLocalizeLogic(img, () => { img.alt = geti18n('chat.group.ghpages.qrCodeAlt') })
	img.width = 200
	img.height = 200
	img.className = 'rounded-lg border border-base-300'
	img.referrerPolicy = 'no-referrer'
	img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(receiverUrl)}`
	qrContainer?.appendChild(img)

	setStatus(geti18n('chat.group.qrTransferWaiting'))

	// 6. 启动 Trystero 房间，等待接收端连接后发送
	let leaveRoom = null
	const timeoutId = setTimeout(() => {
		setStatus(geti18n('chat.group.ghpages.qrTimeout'))
		void leaveRoom?.()
	}, 120_000)

	try {
		const password = trysteroPasswordFromAesKeyHex(aesKeyHex)

		const appId = 'fount-qr-transfer'
		const roomName = `fount-qr-${transferId}`

		const { joinRoom } = await import(TRYSTERO_PKG)
		const room = joinRoom({ appId, password, rtcPolyfill: globalThis.RTCPeerConnection }, roomName)
		/**
		 * 离开 Trystero 房间并忽略错误。
		 * @returns {void}
		 */
		leaveRoom = () => room.leave?.().catch(e => {
			if (e?.name === 'AbortError') return
			console.error('QR transfer room.leave failed:', e)
		})

		const [send] = room.makeAction('credential_transfer')

		room.onPeerJoin(async peerId => {
			setStatus(geti18n('chat.group.qrTransferSending'))
			try {
				const envelope = await encryptCredentialEnvelope(JSON.stringify(pkg), hexToBytes(aesKeyHex))
				await send(envelope, peerId)
				clearTimeout(timeoutId)
				setStatus(geti18n('chat.group.qrTransferDone'))
				setTimeout(() => closeModal(), 2500)
			}
			catch (e) {
				setStatus(geti18n('chat.group.qrTransferSendFailed'))
				console.error('QR transfer: send error', e)
			}
		})
	}
	catch (e) {
		clearTimeout(timeoutId)
		setStatus(geti18n('chat.group.qrTransferConnectFailed'))
		console.error('QR transfer: Trystero error', e)
	}
}
