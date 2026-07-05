/**
 * control 通道名：低延迟、小载荷与路由类消息。
 */
export const CHANNEL_CONTROL = 'control'
/**
 * bulk 通道名：大载荷与低优先级消息。
 */
export const CHANNEL_BULK = 'bulk'
/**
 * bufferedAmount 低水位默认阈值（256 KiB）。
 */
export const CHANNEL_LOW_THRESHOLD_BYTES = 256 * 1024
/**
 * 发送队列高水位默认阈值（1 MiB）。
 */
export const CHANNEL_HIGH_WATERMARK_BYTES = 1024 * 1024
/**
 * 超过此字节数优先走 bulk 通道（64 KiB）。
 */
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
 * 根据 action 名称解析发送优先级，数值越小越优先。
 * @param {string} action 消息 action 名称
 * @returns {number} 优先级（未知 action 默认 5）
 */
export function resolveActionPriority(action) {
	return DEFAULT_ACTION_PRIORITIES[String(action || '').trim()] ?? 5
}

/**
 * 根据 action 与载荷大小选择 control 或 bulk 通道。
 * @param {string} action 消息 action 名称
 * @param {number} byteLength 载荷字节长度
 * @returns {'control' | 'bulk'} 目标通道名
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
 * 读取 RTC 数据通道当前 bufferedAmount，失败时返回 0。
 * @param {RTCDataChannel} channel RTC 数据通道
 * @returns {number} 缓冲区待发送字节数
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
 * 配置数据通道的 bufferedAmountLowThreshold。
 * @param {RTCDataChannel} channel RTC 数据通道
 * @param {number} [thresholdBytes=CHANNEL_LOW_THRESHOLD_BYTES] 低水位阈值（字节）
 * @returns {number | null} 实际生效的阈值，不支持时返回 null
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
 * 订阅 bufferedamountlow 事件，返回取消订阅函数。
 * @param {RTCDataChannel} channel RTC 数据通道
 * @param {() => void} cb 低水位回调
 * @returns {() => void} 取消订阅函数
 */
export function onBufferedAmountLow(channel, cb) {
	/**
	 * bufferedamountlow 事件处理函数。
	 * @returns {void}
	 */
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
 * 创建带优先级队列的双通道发送器（control/bulk）。
 * @param {{ getChannel: (name: 'control' | 'bulk') => RTCDataChannel | null | undefined, highWatermarkBytes?: number }} opts 通道访问与高水位配置
 * @returns {{ enqueue: (action: string, bytes: Uint8Array, preferredChannel?: 'control' | 'bulk') => void, flush: (channelName?: 'control' | 'bulk') => void, pending: () => { control: number, bulk: number }, clear: () => void }} 发送队列 API
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
	 * 在 microtask 中调度指定通道的 flush。
	 * @param {'control' | 'bulk'} channelName 通道名
	 * @returns {void}
	 */
	const scheduleFlush = channelName => {
		if (scheduled[channelName]) return
		scheduled[channelName] = true
		queueMicrotask(() => flush(channelName))
	}

	/**
	 * 将队列中的帧写入指定通道，受高水位限制。
	 * @param {'control' | 'bulk'} channelName 通道名
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
		/**
		 * 按优先级将字节帧入队并调度发送。
		 * @param {string} action 消息 action（用于选通道与优先级）
		 * @param {Uint8Array} bytes 待发送帧字节
		 * @param {'control' | 'bulk'} [preferredChannel] 强制使用的通道，省略则自动选择
		 * @returns {void}
		 */
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
		/**
		 * 调度 flush：指定通道或双通道。
		 * @param {'control' | 'bulk'} [channelName] 通道名，省略则 flush 全部
		 * @returns {void}
		 */
		flush(channelName) {
			if (channelName) scheduleFlush(channelName)
			else {
				scheduleFlush(CHANNEL_CONTROL)
				scheduleFlush(CHANNEL_BULK)
			}
		},
		/**
		 * 返回各通道待发送帧数量。
		 * @returns {{ control: number, bulk: number }} control 与 bulk 队列长度
		 */
		pending() {
			return { control: queues.control.length, bulk: queues.bulk.length }
		},
		/**
		 * 清空所有发送队列。
		 * @returns {void}
		 */
		clear() {
			queues.control.length = 0
			queues.bulk.length = 0
		},
	}
}
