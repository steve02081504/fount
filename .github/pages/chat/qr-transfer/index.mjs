import { geti18n, initTranslations, onLanguageChange, setLocalizeLogic } from '../../scripts/i18n.mjs'

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

const pre = document.getElementById('payload')
const qrEl = document.getElementById('qr')
const statusEl = document.getElementById('qr-status')
/** @type {string} */
let statusI18nKey = ''
/** @type {Record<string, string | number | boolean>} */
let statusI18nVars = {}

/**
 * 更新页面状态文案。
 * @param {string} s 状态文本
 * @returns {void} 无返回值
 */
function setStatus(s) {
	if (statusEl) statusEl.textContent = s
}

/**
 * 以 i18n 键更新页面状态文案，并记录当前状态用于语言切换重渲染。
 * @param {string} key 状态文案键名
 * @param {Record<string, string | number | boolean>} [vars] 占位符变量
 * @returns {void} 无返回值
 */
function setStatusByI18n(key, vars = {}) {
	statusI18nKey = key
	statusI18nVars = vars
	setStatus(geti18n(`${PREFIX}.${key}`, vars))
}

/**
 * 清空页面状态文案，并清除状态的 i18n 记录。
 * @returns {void} 无返回值
 */
function clearStatus() {
	statusI18nKey = ''
	statusI18nVars = {}
	setStatus('')
}

/**
 * 向日志区域追加一行文本。
 * @param {string} line 日志文本
 * @returns {void} 无返回值
 */
function log(line) {
	if (!pre) return
	pre.textContent += `${line}\n`
	pre.scrollTop = pre.scrollHeight
}

/**
 * 从 URL hash 解析迁移 ID 与 AES 密钥十六进制串。
 * @returns {{ transfer: string, key: string } | null} 解析成功返回对象；缺字段或校验失败为 null
 */
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

/**
 * 展示占位二维码，引导用户用手机扫描当前页 URL。
 * @returns {void} 无返回值
 */
function showQrPlaceholder() {
	if (!qrEl) return
	qrEl.classList.remove('hidden')
	qrEl.innerHTML = ''
	const img = document.createElement('img')
	setLocalizeLogic(img, () => {
		img.alt = geti18n(`${PREFIX}.qrCodeAlt`)
	})
	img.width = 200
	img.height = 200
	img.className = 'rounded-lg border border-base-300'
	const fullUrl = location.href
	img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(fullUrl)}`
	img.referrerPolicy = 'no-referrer'
	qrEl.appendChild(img)
}

/**
 * 将收到的凭据明文写入 IndexedDB 待处理队列。
 * @param {string} text 凭据 JSON 字符串
 * @returns {Promise<void>} 写入完成时解析
 */
function putPendingCredential(text) {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open('fount-qr-transfer', 1)
		/**
		 * 首次打开时创建 pending 对象仓库。
		 * @returns {void} 无返回值
		 */
		req.onupgradeneeded = () => {
			const db = req.result
			if (!db.objectStoreNames.contains('pending'))
				db.createObjectStore('pending', { keyPath: 'id' })
		}
		/**
		 * 打开成功后写入 latest 记录并等待事务完成。
		 * @returns {void} 无返回值
		 */
		req.onsuccess = () => {
			const db = req.result
			const tx = db.transaction('pending', 'readwrite')
			tx.objectStore('pending').put({
				id: 'latest',
				receivedAt: Date.now(),
				payload: text,
			})
			/**
			 * 事务成功提交后结束外层 Promise。
			 * @returns {void} 无返回值
			 */
			tx.oncomplete = () => resolve()
			/**
			 * 事务失败时拒绝外层 Promise。
			 * @returns {void} 无返回值
			 */
			tx.onerror = () => reject(tx.error)
		}
		/**
		 * 打开数据库失败时拒绝 Promise。
		 * @returns {void} 无返回值
		 */
		req.onerror = () => reject(req.error)
	})
}

/**
 * 作为接收端加入 Trystero 房间并解密凭据信封。
 * @param {{ transfer: string, key: string }} parsed 自 parseHash 得到的参数
 * @returns {Promise<void>} 无有意义返回值
 */
async function runReceiver(parsed) {
	if (qrEl) qrEl.classList.add('hidden')
	if (pre) pre.textContent = ''
	setStatusByI18n('qrConnecting')
	log(geti18n(`${PREFIX}.qrLogJoin`, { room: qrTransferRoomId(parsed.transfer) }))

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
				setStatusByI18n('qrTimeout')
				log(geti18n(`${PREFIX}.qrTimeout`))
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
				setStatusByI18n('qrStored')
				log(geti18n(`${PREFIX}.qrStoredDetail`))
				await room.leave()
			}
			catch (e) {
				const code = e instanceof Error ? e.message : String(e)
				const msg = code === ERR_QR_KEY_FORMAT ? geti18n(`${PREFIX}.qrErrKeyFormat`)
					: code === ERR_QR_TRANSFER_ID ? geti18n(`${PREFIX}.qrErrTransferId`)
					: code
				setStatusByI18n('qrDecryptFail', { msg })
				log(geti18n(`${PREFIX}.qrDecryptFail`, { msg }))
			}
		})

		setStatusByI18n('qrWaiting')
		log(geti18n(`${PREFIX}.qrWaiting`))
	}
	catch (e) {
		const code = e instanceof Error ? e.message : String(e)
		const msg = code === ERR_QR_KEY_FORMAT ? geti18n(`${PREFIX}.qrErrKeyFormat`)
			: code === ERR_QR_TRANSFER_ID ? geti18n(`${PREFIX}.qrErrTransferId`)
			: code
		setStatusByI18n('qrTrysteroFail', { msg })
		log(geti18n(`${PREFIX}.qrTrysteroFail`, { msg }))
		if (waitTimer) clearTimeout(waitTimer)
		try {
			await room?.leave?.()
		}
		catch { /* ignore */ }
	}
}

/**
 * 页面入口：根据 hash 展示二维码或执行接收流程。
 * @returns {Promise<void>} 无有意义返回值
 */
async function main() {
	await initTranslations('chat.group.ghpages')
	const dm = document.querySelector('meta[name="description"]')
	/**
	 *
	 */
	const renderDocI18n = () => {
		document.title = geti18n(`${PREFIX}.qrPageTitle`)
		if (dm) dm.content = geti18n(`${PREFIX}.qrMetaDescription`)
	}
	renderDocI18n()
	onLanguageChange(renderDocI18n)
	if (statusEl)
		setLocalizeLogic(statusEl, () => {
			if (!statusI18nKey) {
				setStatus('')
				return
			}
			setStatus(geti18n(`${PREFIX}.${statusI18nKey}`, statusI18nVars))
		})

	const parsed = parseHash()
	const hasHash = !!(location.hash || '').replace(/^#/, '')

	if (!hasHash) {
		if (pre) pre.textContent = geti18n(`${PREFIX}.qrNoHash`)
		showQrPlaceholder()
		clearStatus()
		return
	}

	if (!parsed) {
		if (pre) pre.textContent = geti18n(`${PREFIX}.qrBadHash`)
		showQrPlaceholder()
		setStatusByI18n('qrBadHash')
		return
	}

	await runReceiver(parsed)
}

void main()
