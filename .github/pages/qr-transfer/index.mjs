import { geti18n, initTranslations } from '../scripts/i18n.mjs'
import {
	ERR_QR_KEY_FORMAT,
	ERR_QR_TRANSFER_ID,
	QR_TRANSFER_ACTION,
	QR_TRANSFER_APP_ID,
	decryptCredentialEnvelope,
	hexToBytes,
	qrTransferRoomId,
	sanitizeTransferId,
	trysteroPasswordFromAesKeyHex,
} from './protocol.mjs'

const PREFIX = 'chat.group.ghpages'

/**
 * @param {string} key
 * @param {Record<string, string | number | boolean>} [vars]
 */
function t(key, vars = {}) {
	return geti18n(`${PREFIX}.${key}`, vars)
}

const pre = document.getElementById('payload')
const qrEl = document.getElementById('qr')
const statusEl = document.getElementById('qr-status')

function setStatus(s) {
	if (statusEl) statusEl.textContent = s
}

function log(line) {
	if (!pre) return
	pre.textContent += `${line}\n`
	pre.scrollTop = pre.scrollHeight
}

/** @returns {object | null} */
function parseHash() {
	const raw = (location.hash || '').replace(/^#/, '')
	if (!raw) return null
	const params = new URLSearchParams(raw)
	const transferRaw = params.get('transfer')
	const key = (params.get('key') || '').trim()
	if (!transferRaw || !key) return null
	try {
		const transfer = sanitizeTransferId(transferRaw)
		hexToBytes(key)
		return { transfer, key }
	}
	catch {
		return null
	}
}

function showQrPlaceholder() {
	if (!qrEl) return
	qrEl.classList.remove('hidden')
	qrEl.innerHTML = ''
	const img = document.createElement('img')
	img.alt = t('qrCodeAlt')
	img.width = 200
	img.height = 200
	img.className = 'rounded-lg border border-base-300'
	const fullUrl = location.href
	img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(fullUrl)}`
	img.referrerPolicy = 'no-referrer'
	qrEl.appendChild(img)
}

/**
 * @param {string} text
 */
function putPendingCredential(text) {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open('fount-qr-transfer', 1)
		req.onupgradeneeded = () => {
			const db = req.result
			if (!db.objectStoreNames.contains('pending'))
				db.createObjectStore('pending', { keyPath: 'id' })
		}
		req.onsuccess = () => {
			const db = req.result
			const tx = db.transaction('pending', 'readwrite')
			tx.objectStore('pending').put({
				id: 'latest',
				receivedAt: Date.now(),
				payload: text,
			})
			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(tx.error)
		}
		req.onerror = () => reject(req.error)
	})
}

async function runReceiver(parsed) {
	if (qrEl) qrEl.classList.add('hidden')
	if (pre) pre.textContent = ''
	setStatus(t('qrConnecting'))
	log(t('qrLogJoin', { room: qrTransferRoomId(parsed.transfer) }))

	let room
	let waitTimer
	try {
		const keyBytes = hexToBytes(parsed.key)
		const password = trysteroPasswordFromAesKeyHex(parsed.key)
		const { joinRoom } = await import('https://esm.sh/@trystero-p2p/mqtt@0.23.0')
		const config = {
			appId: QR_TRANSFER_APP_ID,
			password,
			rtcPolyfill: globalThis.RTCPeerConnection,
		}
		const roomName = qrTransferRoomId(parsed.transfer)
		room = await joinRoom(config, roomName)

		const [send, registerReceive] = room.makeAction(QR_TRANSFER_ACTION)
		void send
		let done = false
		waitTimer = setTimeout(() => {
			if (!done) {
				setStatus(t('qrTimeout'))
				log(t('qrTimeout'))
				void room?.leave?.().catch(() => {})
			}
		}, 120_000)

		registerReceive(async (payload) => {
			if (done) return
			if (!payload || typeof payload !== 'object' || typeof payload.iv !== 'string' || typeof payload.ct !== 'string')
				return
			try {
				const text = await decryptCredentialEnvelope(
					{ iv: payload.iv, ct: payload.ct },
					keyBytes,
				)
				await putPendingCredential(text)
				done = true
				clearTimeout(waitTimer)
				setStatus(t('qrStored'))
				log(t('qrStoredDetail'))
				await room.leave()
			}
			catch (e) {
				const code = e instanceof Error ? e.message : String(e)
				const msg = code === ERR_QR_KEY_FORMAT ? t('qrErrKeyFormat')
					: code === ERR_QR_TRANSFER_ID ? t('qrErrTransferId')
					: code
				setStatus(t('qrDecryptFail', { msg }))
				log(t('qrDecryptFail', { msg }))
			}
		})

		setStatus(t('qrWaiting'))
		log(t('qrWaiting'))
	}
	catch (e) {
		const code = e instanceof Error ? e.message : String(e)
		const msg = code === ERR_QR_KEY_FORMAT ? t('qrErrKeyFormat')
			: code === ERR_QR_TRANSFER_ID ? t('qrErrTransferId')
			: code
		setStatus(t('qrTrysteroFail', { msg }))
		log(t('qrTrysteroFail', { msg }))
		if (waitTimer) clearTimeout(waitTimer)
		try {
			await room?.leave?.()
		}
		catch { /* ignore */ }
	}
}

async function main() {
	await initTranslations('chat.group.ghpages')
	document.title = t('qrPageTitle')
	const dm = document.querySelector('meta[name="description"]')
	if (dm) dm.content = t('qrMetaDescription')

	const parsed = parseHash()
	const hasHash = !!(location.hash || '').replace(/^#/, '')

	if (!hasHash) {
		if (pre) pre.textContent = t('qrNoHash')
		showQrPlaceholder()
		setStatus('')
		return
	}

	if (!parsed) {
		if (pre) pre.textContent = t('qrBadHash')
		showQrPlaceholder()
		setStatus(t('qrBadHash'))
		return
	}

	await runReceiver(parsed)
}

void main()
