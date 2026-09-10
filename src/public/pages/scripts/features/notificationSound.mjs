/**
 * fount 标志性通知音。
 * 使用 Web Audio API 在页面内生成，无需外部音频文件。
 * 播放失败时由调用方决定 fallback（通常是回退到系统通知）。
 */

/**
 * 播放一个短促的水晶双音提示音。
 * @returns {Promise<void>} 播放结束 resolve；若无法播放则 reject
 */
export async function playNotificationSound() {
	const AudioContext = window.AudioContext || window.webkitAudioContext
	if (!AudioContext) throw new Error('Web Audio API not supported')

	const ctx = new AudioContext()
	try {
		if (ctx.state === 'suspended') await ctx.resume()
		if (ctx.state !== 'running') throw new Error('AudioContext not running')

		const t0 = ctx.currentTime

		// 第一个音：C5 -> G5 滑音，0.28s
		const o1 = ctx.createOscillator()
		const g1 = ctx.createGain()
		o1.type = 'sine'
		o1.frequency.setValueAtTime(523.25, t0) // C5
		o1.frequency.exponentialRampToValueAtTime(783.99, t0 + 0.12) // G5
		g1.gain.setValueAtTime(0, t0)
		g1.gain.linearRampToValueAtTime(0.08, t0 + 0.02)
		g1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28)
		o1.connect(g1).connect(ctx.destination)
		o1.start(t0)
		o1.stop(t0 + 0.28)

		// 第二个音：高八度 C6 轻点，延后 0.12s
		const o2 = ctx.createOscillator()
		const g2 = ctx.createGain()
		o2.type = 'sine'
		o2.frequency.setValueAtTime(1046.5, t0 + 0.12) // C6
		g2.gain.setValueAtTime(0, t0 + 0.12)
		g2.gain.linearRampToValueAtTime(0.05, t0 + 0.14)
		g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.36)
		o2.connect(g2).connect(ctx.destination)
		o2.start(t0 + 0.12)
		o2.stop(t0 + 0.36)

		// 等待播放结束（上限 500ms 兜底），再关闭 context 释放资源
		await new Promise(resolve => setTimeout(resolve, 500))
	}
	finally {
		try { await ctx.close() } catch { /* empty */ }
	}
}
