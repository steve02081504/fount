const MAX_SAMPLES = 10
const histories = new Map()

/**
 * 记录一次真实的连通性延迟。
 * @param {string} key 稳定的检查标识。
 * @param {number} duration 延迟毫秒数。
 */
export function recordLatency(key, duration) {
	if (!Number.isFinite(duration) || duration < 0) return
	const samples = histories.get(key) || []
	samples.push(duration)
	if (samples.length > MAX_SAMPLES) samples.shift()
	histories.set(key, samples)
}

/**
 * 根据已有样本绘制单个延迟趋势图。重绘不会新增样本。
 * @param {HTMLCanvasElement} canvas 目标画布。
 * @param {string} key 稳定的检查标识。
 */
export function drawLatencySparkline(canvas, key) {
	const samples = histories.get(key) || []
	const context = canvas.getContext('2d')
	if (!context) return

	const ratio = window.devicePixelRatio || 1
	const { width, height } = canvas.getBoundingClientRect()
	canvas.width = Math.max(1, Math.round(width * ratio))
	canvas.height = Math.max(1, Math.round(height * ratio))
	context.scale(ratio, ratio)
	context.clearRect(0, 0, width, height)
	if (!samples.length) return

	const color = getComputedStyle(canvas).color
	context.strokeStyle = color
	context.fillStyle = color
	context.lineWidth = Math.max(1.5, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--border')) || 1)
	context.lineJoin = 'round'
	context.lineCap = 'round'
	if (samples.length < 2) {
		context.beginPath()
		context.arc(width / 2, height / 2, context.lineWidth, 0, Math.PI * 2)
		context.fill()
		return
	}

	const min = Math.min(...samples)
	const max = Math.max(...samples)
	const range = max - min
	const points = samples.map((value, index) => ({
		x: index * width / (samples.length - 1),
		y: range ? height - 2 - (value - min) / range * (height - 4) : height / 2,
	}))
	context.beginPath()
	context.moveTo(points[0].x, points[0].y)
	for (let index = 1; index < points.length - 1; index++) {
		const point = points[index], next = points[index + 1]
		context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2)
	}
	const last = points.at(-1)
	context.lineTo(last.x, last.y)
	context.stroke()
}

/**
 * 重绘指定根节点中的全部趋势图。
 * @param {ParentNode} root 查询根节点。
 */
export function redrawLatencySparklines(root = document) {
	for (const canvas of root.querySelectorAll('.latency-sparkline'))
		drawLatencySparkline(canvas, canvas.dataset.latencyKey)
}
