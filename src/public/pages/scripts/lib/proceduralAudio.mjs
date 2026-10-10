/**
 * 程序化音频小工具：自动播放受限时等首个用户手势再发声、噪声缓冲、合成混响冲激与包络。
 * 页面自己的音乐/音效逻辑在此之上搭建。
 */

const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click']

/**
 * 尽早发声：立刻创建 `AudioContext`，浏览器允许自动播放（站点互动度高等）就马上回调；
 * 否则上下文处于挂起状态（Chrome 会打一条 warning，不是 error），等首个用户手势恢复后再回调。回调只发生一次。
 * @param {(context: AudioContext) => void} callback 拿到可发声上下文后的回调。
 * @returns {() => void} 取消等待。
 */
export function whenAudioAllowed(callback) {
	const context = new AudioContext({ latencyHint: 'interactive' })
	let done = false
	/** 上下文进入运行状态：回调一次并解绑。 */
	function ready() {
		if (done || context.state !== 'running') return
		done = true
		cancel()
		callback(context)
	}
	/** 用户手势：尝试恢复上下文。 */
	function handler() {
		context.resume().then(ready, () => { })
	}
	context.addEventListener('statechange', ready)
	/** 解绑全部手势监听。 */
	function cancel() {
		for (const type of GESTURE_EVENTS) removeEventListener(type, handler, true)
	}
	for (const type of GESTURE_EVENTS) addEventListener(type, handler, { capture: true, passive: true })
	queueMicrotask(ready)
	return cancel
}

/**
 * 生成单声道白噪声缓冲。
 * @param {BaseAudioContext} context 音频上下文。
 * @param {number} [seconds=2] 时长（秒）。
 * @returns {AudioBuffer} 噪声缓冲（适合循环播放）。
 */
export function createNoiseBuffer(context, seconds = 2) {
	const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate)
	const data = buffer.getChannelData(0)
	for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1
	return buffer
}

/**
 * 合成立体声混响冲激（指数衰减噪声），给 `ConvolverNode` 用。
 * @param {BaseAudioContext} context 音频上下文。
 * @param {number} [seconds=4] 尾音长度（秒）。
 * @param {number} [decay=3] 衰减指数，越大尾音越短促。
 * @returns {AudioBuffer} 冲激缓冲。
 */
export function createImpulse(context, seconds = 4, decay = 3) {
	const length = Math.ceil(context.sampleRate * seconds)
	const buffer = context.createBuffer(2, length, context.sampleRate)
	for (let channel = 0; channel < 2; channel++) {
		const data = buffer.getChannelData(channel)
		for (let index = 0; index < length; index++) data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** decay
	}
	return buffer
}

/**
 * 在 `AudioParam` 上排一个起音-衰减包络（从 0 线性升到峰值，再指数落回接近 0）。
 * @param {AudioParam} param 目标参数（通常是增益）。
 * @param {number} at 开始时间（上下文时间，秒）。
 * @param {number} peak 峰值。
 * @param {number} attack 起音时长（秒）。
 * @param {number} release 衰减时长（秒）。
 * @returns {number} 包络结束时间，可用来 `stop()` 声源。
 */
export function envelope(param, at, peak, attack, release) {
	param.cancelScheduledValues(at)
	param.setValueAtTime(0, at)
	param.linearRampToValueAtTime(peak, at + attack)
	param.exponentialRampToValueAtTime(0.0001, at + attack + release)
	return at + attack + release + 0.05
}
