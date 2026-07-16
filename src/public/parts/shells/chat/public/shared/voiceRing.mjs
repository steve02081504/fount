/**
 * 纯音频直播/通话：头像 + 主题色环形声波。
 */
/* eslint-disable jsdoc/require-returns-description */

const BAR_COUNT = 48

/**
 * @param {object} opts 选项
 * @param {HTMLElement} opts.container 宿主
 * @param {string} [opts.avatarUrl] 头像 URL
 * @param {string} [opts.themeColor] CSS 颜色
 * @param {() => number[]} opts.getLevels 频带电平 0..1
 * @returns {{ destroy: () => void }}
 */
export function mountVoiceRing(opts) {
	const { container, avatarUrl = '', themeColor = '#888', getLevels } = opts
	container.replaceChildren()
	container.classList.add('voice-ring-host')

	const canvas = document.createElement('canvas')
	canvas.className = 'voice-ring-canvas'
	const avatar = document.createElement('img')
	avatar.className = 'voice-ring-avatar'
	avatar.alt = ''
	if (avatarUrl) avatar.src = avatarUrl
	container.append(canvas, avatar)

	let raf = 0
	/** @type {() => void} */
	const draw = () => {
		const rect = container.getBoundingClientRect()
		const size = Math.min(rect.width, rect.height) || 240
		const dpr = window.devicePixelRatio || 1
		canvas.width = size * dpr
		canvas.height = size * dpr
		canvas.style.width = `${size}px`
		canvas.style.height = `${size}px`
		const ctx = canvas.getContext('2d')
		if (!ctx) return
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		ctx.clearRect(0, 0, size, size)

		const cx = size / 2
		const cy = size / 2
		const baseR = size * 0.34
		const levels = getLevels?.() || []
		const idle = 0.06

		for (let i = 0; i < BAR_COUNT; i++) {
			const src = levels[i % levels.length] ?? idle
			const amp = Math.max(idle, Math.min(1, src))
			const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2
			const barLen = 8 + amp * size * 0.14
			const inner = baseR
			const outer = inner + barLen
			const x0 = cx + Math.cos(angle) * inner
			const y0 = cy + Math.sin(angle) * inner
			const x1 = cx + Math.cos(angle) * outer
			const y1 = cy + Math.sin(angle) * outer
			ctx.strokeStyle = themeColor
			ctx.globalAlpha = 0.25 + amp * 0.75
			ctx.lineWidth = 3
			ctx.lineCap = 'round'
			ctx.beginPath()
			ctx.moveTo(x0, y0)
			ctx.lineTo(x1, y1)
			ctx.stroke()
		}
		ctx.globalAlpha = 1
		raf = requestAnimationFrame(draw)
	}
	raf = requestAnimationFrame(draw)

	return {
		/** @returns {void} */
		destroy() {
			cancelAnimationFrame(raf)
			container.replaceChildren()
			container.classList.remove('voice-ring-host')
		},
	}
}

/**
 * 从 AnalyserNode 取样环形频带。
 * @param {AnalyserNode} analyser 分析器
 * @param {number} [bands=16] 频带数
 * @returns {number[]} 0..1
 */
export function sampleAnalyserRing(analyser, bands = 16) {
	const data = new Uint8Array(analyser.frequencyBinCount)
	analyser.getByteFrequencyData(data)
	const out = []
	const step = Math.max(1, Math.floor(data.length / bands))
	for (let i = 0; i < bands; i++) {
		let sum = 0
		const start = i * step
		for (let j = start; j < start + step && j < data.length; j++) sum += data[j]
		out.push((sum / step) / 255)
	}
	return out
}
