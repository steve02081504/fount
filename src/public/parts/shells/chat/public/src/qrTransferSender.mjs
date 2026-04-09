/**
 * QR 凭证迁移发送端（浏览器侧）
 *
 * 流程：
 *   1. 从服务端取凭证包（群组列表 + 用户名）
 *   2. 浏览器生成随机 AES 密钥 + 迁移 ID
 *   3. 构造接收端 URL（GH Pages / 本地），展示 QR 码
 *   4. 通过 Trystero MQTT 等待接收端连入，连接后加密发送
 */

import { geti18n } from '../../../../../scripts/i18n.mjs'
import { showToastI18n } from '../../../../../scripts/toast.mjs'

const TRYSTERO_PKG = 'https://esm.sh/@trystero-p2p/mqtt@0.23.0'
const QR_RECEIVER_PATH = '/shells/chat/qr-transfer'   // 本地接收页（若存在）
const QR_GHPAGES_FALLBACK = null                       // 可设置为 GH Pages 接收页 URL

let currentModal = null

/**
 * 生成 32 字节随机 AES 密钥，返回 hex 字符串
 * @returns {string}
 */
function genAesKeyHex() {
	const bytes = crypto.getRandomValues(new Uint8Array(32))
	return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 生成安全的迁移 ID（仅字母数字，16 位）
 * @returns {string}
 */
function genTransferId() {
	const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
	return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => chars[b % chars.length]).join('')
}

/** @param {Uint8Array} u8 */
function u8ToB64(u8) {
	let s = ''
	for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
	return btoa(s)
}

/** @param {string} b64 */
function b64ToU8(b64) {
	const bin = atob(b64)
	const out = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}

/**
 * AES-GCM 加密
 * @param {string} plaintext
 * @param {string} aesKeyHex
 * @returns {Promise<{ iv: string, ct: string }>}
 */
async function encryptPackage(plaintext, aesKeyHex) {
	const keyBytes = b64ToU8(
		btoa(Array.from(aesKeyHex.match(/.{2}/g) || [], h => String.fromCharCode(parseInt(h, 16))).join(''))
	)
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)))
	return { iv: u8ToB64(iv), ct: u8ToB64(ct) }
}

/**
 * 构造接收端 URL（含 hash）
 * @param {string} receiverBase
 * @param {string} transferId
 * @param {string} aesKeyHex
 * @returns {string}
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
		showToastI18n('error', 'chat.group.qrTransferFetchFailed')
		console.error('QR transfer: failed to fetch package', e)
		return
	}

	// 2. 生成密钥与 ID
	const transferId = genTransferId()
	const aesKeyHex = genAesKeyHex()

	// 3. 构造接收 URL
	const receiverBase = QR_GHPAGES_FALLBACK
		?? `${location.origin}${QR_RECEIVER_PATH}/`
	const receiverUrl = buildReceiverUrl(receiverBase, transferId, aesKeyHex)

	// 4. 构建弹窗 DOM
	const modal = document.createElement('div')
	modal.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-base-300/80'
	modal.innerHTML = `
		<div class="bg-base-100 rounded-2xl shadow-xl p-6 max-w-sm w-full flex flex-col gap-4">
			<div class="flex items-center justify-between">
				<h3 class="text-lg font-bold" data-i18n="chat.group.qrTransferTitle"></h3>
				<button id="qr-modal-close" class="btn btn-sm btn-ghost">✕</button>
			</div>
			<p class="text-sm opacity-70" data-i18n="chat.group.qrTransferHint"></p>
			<div id="qr-modal-qr" class="flex justify-center"></div>
			<p id="qr-modal-status" class="text-sm text-center opacity-80"></p>
		</div>
	`
	document.body.appendChild(modal)
	currentModal = modal

	// i18n
	const { i18nElement, geti18n: _geti18n } = await import('../../../../../scripts/i18n.mjs').catch(() => ({ i18nElement: null, geti18n: null }))
	for (const el of modal.querySelectorAll('[data-i18n]'))
		if (i18nElement) i18nElement(el)
		else el.textContent = geti18n(el.dataset.i18n)

	const statusEl = modal.querySelector('#qr-modal-status')
	const setStatus = s => { if (statusEl) statusEl.textContent = s }

	modal.querySelector('#qr-modal-close')?.addEventListener('click', () => {
		closeModal()
		void leaveRoom?.()
	})

	// 5. 生成二维码图片（使用 qrserver.com API）
	const qrContainer = modal.querySelector('#qr-modal-qr')
	const img = document.createElement('img')
	img.alt = geti18n('chat.group.ghpages.qrCodeAlt')
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
		// trysteroPasswordFromAesKeyHex：将 hex key 转 base64 字节串作 password
		const keyBytes = Uint8Array.from((aesKeyHex.match(/.{2}/g) || []).map(h => parseInt(h, 16)))
		let s = ''
		for (let i = 0; i < keyBytes.length; i++) s += String.fromCharCode(keyBytes[i])
		const password = btoa(s)

		const appId = 'fount-qr-transfer'
		const roomName = `fount-qr-${transferId}`

		const { joinRoom } = await import(TRYSTERO_PKG)
		const room = joinRoom({ appId, password, rtcPolyfill: globalThis.RTCPeerConnection }, roomName)
		leaveRoom = () => room.leave?.().catch(() => {})

		const [send] = room.makeAction('credential_transfer')

		room.onPeerJoin(async peerId => {
			setStatus(geti18n('chat.group.qrTransferSending'))
			try {
				const envelope = await encryptPackage(JSON.stringify(pkg), aesKeyHex)
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
