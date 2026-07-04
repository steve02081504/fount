export const CHANNEL_CONTROL = 'control'
export const CHANNEL_BULK = 'bulk'
export const CHANNEL_LOW_THRESHOLD_BYTES = 256 * 1024
export const CHANNEL_HIGH_WATERMARK_BYTES = 1024 * 1024
export const BULK_CHANNEL_MIN_BYTES = 64 * 1024

const DEFAULT_ACTION_PRIORITIES = Object.freeze({
	dag_event: 0,
	gossip_request: 1,
	gossip_response: 2,
	channel_history_want: 2,
	fed_bootstrap_request: 2,
	fed_bootstrap_response: 2,
	fed_join_snapshot_request: 2,
	fed_archive_month_want: 2,
	fed_archive_month_response: 2,
	mailbox_put: 2,
	mailbox_want: 2,
	mailbox_give: 2,
	fed_tip_ping: 3,
	discovery_announce: 3,
	discovery_query: 3,
	discovery_query_response: 3,
	part_invoke: 3,
	part_invoke_response: 3,
	char_rpc: 3,
	fed_chunk_put: 5,
	fed_chunk_get: 5,
	fed_chunk_data: 5,
	fed_chunk_ack: 5,
	fed_partition_bridge: 5,
	fed_volatile: 10,
})

/**
 * @param {string} action
 * @returns {number}
 */
export function resolveActionPriority(action) {
	return DEFAULT_ACTION_PRIORITIES[String(action || '').trim()] ?? 5
}

/**
 * @param {string} action
 * @param {number} byteLength
 * @returns {'control' | 'bulk'}
 */
export function pickChannel(action, byteLength) {
	const normalized = String(action || '').trim()
	if (normalized === 'ping' || normalized === 'pong' || normalized.startsWith('route_'))
		return CHANNEL_CONTROL
	if (Number(byteLength) > BULK_CHANNEL_MIN_BYTES)
		return CHANNEL_BULK
	return resolveActionPriority(normalized) <= 3 ? CHANNEL_CONTROL : CHANNEL_BULK
}

/**
 * @param {RTCDataChannel} channel
 * @returns {number}
 */
export function readBufferedAmount(channel) {
	try {
		return Number.isFinite(channel?.bufferedAmount) ? Number(channel.bufferedAmount) : 0
	}
	catch {
		return 0
	}
}

/**
 * @param {RTCDataChannel} channel
 * @param {number} [thresholdBytes=CHANNEL_LOW_THRESHOLD_BYTES]
 * @returns {number | null}
 */
export function configureBufferedAmountLowThreshold(channel, thresholdBytes = CHANNEL_LOW_THRESHOLD_BYTES) {
	try {
		channel.bufferedAmountLowThreshold = thresholdBytes
		return Number.isFinite(channel.bufferedAmountLowThreshold)
			? Number(channel.bufferedAmountLowThreshold)
			: null
	}
	catch {
		return null
	}
}

/**
 * @param {RTCDataChannel} channel
 * @param {() => void} cb
 * @returns {() => void}
 */
export function onBufferedAmountLow(channel, cb) {
	const handler = () => cb()
	channel.addEventListener?.('bufferedamountlow', handler)
	channel.onbufferedamountlow = handler
	if (channel.bufferedAmountLow?.subscribe)
		channel.bufferedAmountLow.subscribe(handler)
	return () => {
		channel.removeEventListener?.('bufferedamountlow', handler)
		if (channel.onbufferedamountlow === handler) channel.onbufferedamountlow = null
	}
}

/**
 * @param {{ getChannel: (name: 'control' | 'bulk') => RTCDataChannel | null | undefined, highWatermarkBytes?: number }} opts
 * @returns {{ enqueue: (action: string, bytes: Uint8Array, preferredChannel?: 'control' | 'bulk') => void, flush: (channelName?: 'control' | 'bulk') => void, pending: () => { control: number, bulk: number }, clear: () => void }}
 */
export function createChannelSendQueues(opts) {
	const getChannel = opts.getChannel
	const highWatermarkBytes = Math.max(CHANNEL_LOW_THRESHOLD_BYTES, Number(opts.highWatermarkBytes) || CHANNEL_HIGH_WATERMARK_BYTES)
	/** @type {{ control: Array<{ priority: number, seq: number, bytes: Uint8Array }>, bulk: Array<{ priority: number, seq: number, bytes: Uint8Array }> }} */
	const queues = { control: [], bulk: [] }
	/** @type {{ control: boolean, bulk: boolean }} */
	const scheduled = { control: false, bulk: false }
	let seq = 0

	/**
	 * @param {'control' | 'bulk'} channelName
	 * @returns {void}
	 */
	const scheduleFlush = channelName => {
		if (scheduled[channelName]) return
		scheduled[channelName] = true
		queueMicrotask(() => flush(channelName))
	}

	/**
	 * @param {'control' | 'bulk'} channelName
	 * @returns {void}
	 */
	const flush = channelName => {
		scheduled[channelName] = false
		const channel = getChannel(channelName)
		if (!channel || channel.readyState !== 'open') return
		const queue = queues[channelName]
		while (queue.length) {
			if (readBufferedAmount(channel) > highWatermarkBytes) return
			const item = queue.shift()
			channel.send(item.bytes)
		}
	}

	return {
		enqueue(action, bytes, preferredChannel) {
			const channelName = preferredChannel ?? pickChannel(action, bytes.byteLength)
			const queue = queues[channelName]
			const priority = resolveActionPriority(action)
			const item = { priority, seq: ++seq, bytes }
			let lo = 0
			let hi = queue.length
			while (lo < hi) {
				const mid = (lo + hi) >> 1
				const compare = priority - queue[mid].priority || item.seq - queue[mid].seq
				if (compare < 0) hi = mid
				else lo = mid + 1
			}
			queue.splice(lo, 0, item)
			scheduleFlush(channelName)
		},
		flush(channelName) {
			if (channelName) scheduleFlush(channelName)
			else {
				scheduleFlush(CHANNEL_CONTROL)
				scheduleFlush(CHANNEL_BULK)
			}
		},
		pending() {
			return { control: queues.control.length, bulk: queues.bulk.length }
		},
		clear() {
			queues.control.length = 0
			queues.bulk.length = 0
		},
	}
}
