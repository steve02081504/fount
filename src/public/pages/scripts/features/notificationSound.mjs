/**
 * fount 标志性通知音。
 * 使用 Web Audio API 在页面内生成，无需外部音频文件。
 * 首次用户手势时预初始化并复用同一个 AudioContext，避免自动播放策略拦截；
 * 播放失败时由调用方决定 fallback（通常是回退到系统通知）。
 */

/** 复用的 AudioContext；首次手势解锁后保持存活。 @type {AudioContext | null} */
let audioContext = null

/** 手势解锁监听是否已安装。 @type {boolean} */
let gestureUnlockInstalled = false

/**
 * 懒创建并复用 AudioContext。
 * @returns {AudioContext | null} 音频上下文；浏览器不支持时为 null
 */
function ensureAudioContext() {
	const AudioContext = window.AudioContext || window.webkitAudioContext
	if (!AudioContext) return null
	audioContext ??= new AudioContext()
	return audioContext
}

/**
 * 在首次用户手势时解锁（resume）共享 AudioContext。
 * @returns {void}
 */
function installGestureUnlock() {
	if (gestureUnlockInstalled) return
	gestureUnlockInstalled = true
	/**
	 * @returns {void} 手势回调：恢复上下文并移除监听
	 */
	const unlock = () => {
		const context = ensureAudioContext()
		if (context?.state === 'suspended') context.resume().catch(() => { /* 需稍后重试 */ })
		window.removeEventListener('pointerdown', unlock, true)
		window.removeEventListener('keydown', unlock, true)
		window.removeEventListener('touchstart', unlock, true)
	}
	window.addEventListener('pointerdown', unlock, true)
	window.addEventListener('keydown', unlock, true)
	window.addEventListener('touchstart', unlock, true)
}
installGestureUnlock()

/**
 * 主动预初始化通知音（可选）。调用方可提前在用户手势内调用，确保后续播放不被拦截。
 * @returns {Promise<void>} 上下文就绪后 resolve
 */
export async function initNotificationSound() {
	installGestureUnlock()
	const context = ensureAudioContext()
	if (context?.state === 'suspended') await context.resume()
}

/**
 * 播放一个短促的水晶双音提示音。
 * @returns {Promise<void>} 播放结束 resolve；若无法播放则 reject
 */
export async function playNotificationSound() {
	const context = ensureAudioContext()
	if (!context) throw new Error('Web Audio API not supported')

	if (context.state === 'suspended') await context.resume()
	if (context.state !== 'running') throw new Error('AudioContext not running')

	const t0 = context.currentTime

	// 第一个音：C5 -> G5 滑音，0.28s
	const o1 = context.createOscillator()
	const g1 = context.createGain()
	o1.type = 'sine'
	o1.frequency.setValueAtTime(523.25, t0) // C5
	o1.frequency.exponentialRampToValueAtTime(783.99, t0 + 0.12) // G5
	g1.gain.setValueAtTime(0, t0)
	g1.gain.linearRampToValueAtTime(0.08, t0 + 0.02)
	g1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28)
	o1.connect(g1).connect(context.destination)
	o1.start(t0)
	o1.stop(t0 + 0.28)

	// 第二个音：高八度 C6 轻点，延后 0.12s
	const o2 = context.createOscillator()
	const g2 = context.createGain()
	o2.type = 'sine'
	o2.frequency.setValueAtTime(1046.5, t0 + 0.12) // C6
	g2.gain.setValueAtTime(0, t0 + 0.12)
	g2.gain.linearRampToValueAtTime(0.05, t0 + 0.14)
	g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.36)
	o2.connect(g2).connect(context.destination)
	o2.start(t0 + 0.12)
	o2.stop(t0 + 0.36)

	// 等待播放结束（上限 500ms 兜底）；共享上下文不关闭，供下次复用。
	await new Promise(resolve => setTimeout(resolve, 500))
}
