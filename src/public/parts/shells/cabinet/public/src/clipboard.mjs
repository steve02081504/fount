/**
 * 跨窗口文件柜剪贴板（sessionStorage + BroadcastChannel）。
 */

const STORAGE_KEY = 'fount-cabinet-clipboard'
const CHANNEL_NAME = 'fount-cabinet-clipboard'

/** @type {BroadcastChannel | null} */
let channel = null

/**
 * @returns {BroadcastChannel | null} 频道；不支持时为 null
 */
function getChannel() {
	if (typeof BroadcastChannel === 'undefined') return null
	if (!channel) channel = new BroadcastChannel(CHANNEL_NAME)
	return channel
}

/**
 * @typedef {{ mode: 'copy' | 'cut', cabinet_id: string, entry_ids: string[], source_parent_id: string | null, at: number }} CabinetClipboard
 */

/**
 * @returns {CabinetClipboard | null} 当前剪贴板
 */
export function readClipboard() {
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY)
		if (!raw) return null
		const data = JSON.parse(raw)
		if (!data?.cabinet_id || !Array.isArray(data.entry_ids) || !data.entry_ids.length) return null
		return {
			mode: data.mode === 'cut' ? 'cut' : 'copy',
			cabinet_id: String(data.cabinet_id),
			entry_ids: data.entry_ids.map(String),
			source_parent_id: data.source_parent_id == null || data.source_parent_id === ''
				? null
				: String(data.source_parent_id),
			at: Number(data.at) || Date.now(),
		}
	}
	catch {
		return null
	}
}

/**
 * @param {CabinetClipboard | null} value 剪贴板
 * @returns {void}
 */
export function writeClipboard(value) {
	if (!value) {
		sessionStorage.removeItem(STORAGE_KEY)
		getChannel()?.postMessage({ type: 'clear' })
		return
	}
	const payload = {
		mode: value.mode,
		cabinet_id: value.cabinet_id,
		entry_ids: [...value.entry_ids],
		source_parent_id: value.source_parent_id ?? null,
		at: value.at || Date.now(),
	}
	sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
	getChannel()?.postMessage({ type: 'set', payload })
}

/**
 * @param {(value: CabinetClipboard | null) => void} listener 监听
 * @returns {() => void} 取消订阅
 */
export function subscribeClipboard(listener) {
	/**
	 * @param {StorageEvent} event storage
	 * @returns {void}
	 */
	function onStorage(event) {
		if (event.key !== STORAGE_KEY) return
		listener(readClipboard())
	}
	window.addEventListener('storage', onStorage)
	const ch = getChannel()
	/**
	 * @param {MessageEvent} event 消息
	 * @returns {void}
	 */
	function onMessage(event) {
		if (event.data?.type === 'clear') listener(null)
		else if (event.data?.type === 'set') listener(event.data.payload || null)
	}
	ch?.addEventListener('message', onMessage)
	return () => {
		window.removeEventListener('storage', onStorage)
		ch?.removeEventListener('message', onMessage)
	}
}
