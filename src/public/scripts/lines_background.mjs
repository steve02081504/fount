import chroma from 'https://esm.run/chroma-js'

// 兼容不同浏览器的 requestAnimationFrame
const requestAnimationFrame = window.requestAnimationFrame ||
	window.webkitRequestAnimationFrame ||
	window.mozRequestAnimationFrame ||
	window.oRequestAnimationFrame ||
	window.msRequestAnimationFrame ||
	function (callback) { window.setTimeout(callback, 1000 / 45) }

/**
 * 获取元素的属性值，如果属性不存在则返回默认值。
 * @param {HTMLElement} element - 要获取属性的元素。
 * @param {string} attributeName - 属性名称。
 * @param {*} defaultValue - 默认值。
 * @returns {*} 属性值或默认值。
 */
function getAttributeOrDefault(element, attributeName, defaultValue) {
	return element.getAttribute(attributeName) || defaultValue
}

/**
 * 获取指定标签名的所有元素。
 * @param {string} tagName - 标签名称。
 * @returns {HTMLCollectionOf<Element>} 元素集合。
 */
function getElementsByTagName(tagName) {
	return document.getElementsByTagName(tagName)
}

/**
 * 从最后一个 script 标签获取配置信息。
 * @returns {object} 配置对象。
 */
function getConfig() {
	const scriptElements = getElementsByTagName('script')
	const scriptCount = scriptElements.length
	const lastScriptElement = scriptElements[scriptCount - 1]
	return {
		scriptCount,
		zIndex: getAttributeOrDefault(lastScriptElement, 'zIndex', -1),
		opacity: getAttributeOrDefault(lastScriptElement, 'opacity', 0.5),
		color: getAttributeOrDefault(lastScriptElement, 'color', '0,0,0'), // 初始颜色，会被 updateColors 更新
		count: getAttributeOrDefault(lastScriptElement, 'count', 99)
	}
}

let canvas, ctx, canvasWidth, canvasHeight, config, dots, mouse

/**
 * 更新画布大小。
 */
function resizeCanvas() {
	canvasWidth = canvas.width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth
	canvasHeight = canvas.height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight

	// 每次重设大小，都应该重新设置背景颜色。
	ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-base-200').trim()
	ctx.fillRect(0, 0, canvasWidth, canvasHeight)

	// 动态调整点的数量
	adjustDotCount()
}

/**
 * 根据当前配置调整点的数量
 */
function adjustDotCount() {
	const density = 0.0001 // 密度因子，可以根据需要调整
	const targetCount = Math.max(10, Math.floor(canvasWidth * canvasHeight * density)) // 最小数量限制
	const currentCount = dots.length

	if (targetCount > currentCount)
		// 添加点
		for (let i = 0; i < targetCount - currentCount; i++) {
			const x = Math.random() * canvasWidth
			const y = Math.random() * canvasHeight
			const dx = 2 * Math.random() - 1
			const dy = 2 * Math.random() - 1
			dots.push({ x, y, dx, dy, max: 6000, color: config.color })
		}
	else if (targetCount < currentCount)
		// 移除多余的点
		dots.splice(0, currentCount - targetCount)

	updateColors()
}

/**
 * 绘制动画帧。
 */
function draw() {
	ctx.clearRect(0, 0, canvasWidth, canvasHeight) // 清空画布
	// 重新绘制背景 (缓存)
	ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-base-200').trim()
	ctx.fillRect(0, 0, canvasWidth, canvasHeight)

	const configColor = config.color //提前获取颜色，避免重复读取

	// 使用局部变量优化性能
	const numDots = dots.length
	for (let i = 0; i < numDots; i++) {
		const dot = dots[i]

		// 提前计算，避免重复计算
		let nextX = dot.x + dot.dx
		let nextY = dot.y + dot.dy

		// 边界反弹
		if (nextX > canvasWidth || nextX < 0) {
			dot.dx *= -1
			nextX = dot.x + dot.dx // 更新 nextX
		}
		if (nextY > canvasHeight || nextY < 0) {
			dot.dy *= -1
			nextY = dot.y + dot.dy // 更新 nextY
		}

		dot.x = nextX
		dot.y = nextY

		// 绘制点 (整数坐标)
		ctx.fillStyle = 'rgba(' + dot.color + ', 1)'
		ctx.fillRect(Math.round(dot.x - 0.5), Math.round(dot.y - 0.5), 1, 1)
	}

	// 循环优化：减少内部循环中的条件判断和计算, 使用局部变量
	for (let i = 0; i < numDots; i++) {
		const dot = dots[i]
		const combinedDots = [mouse].concat(dots) // 每次只合并当前 dot 需要比较的数组

		for (let j = 0; j < combinedDots.length; j++) {
			const otherDot = combinedDots[j]

			if (dot !== otherDot && otherDot.x !== null && otherDot.y !== null) {
				const dx = dot.x - otherDot.x
				const dy = dot.y - otherDot.y
				const distanceSquared = dx * dx + dy * dy
				const otherDotMax = otherDot.max

				if (distanceSquared < otherDotMax) {
					const lineOpacityFactor = (otherDotMax - distanceSquared) / otherDotMax
					if (lineOpacityFactor <= 0) continue // 优化：提前跳过

					if (otherDot === mouse)
						if (distanceSquared >= otherDotMax / 2) {
							dot.x -= 0.03 * dx
							dot.y -= 0.03 * dy
						}


					// 绘制连接线
					ctx.beginPath()
					ctx.lineWidth = lineOpacityFactor * 0.5 // 优化：提前计算
					ctx.strokeStyle = 'rgba(' + configColor + ',' + (lineOpacityFactor + 0.2) + ')'
					ctx.moveTo(dot.x, dot.y)
					ctx.lineTo(otherDot.x, otherDot.y)
					ctx.stroke()
					ctx.closePath() // 明确关闭路径
				}
			}
		}
	}

	requestAnimationFrame(draw) // 请求下一帧动画
}

/**
 * 初始化线条背景。
 */
export function initLinesBackground() {
	// 初始化 dots 数组和 mouse 对象，确保它们在 resizeCanvas 之前被定义
	dots = []
	mouse = { x: null, y: null, max: 20000 }

	canvas = document.createElement('canvas')
	config = getConfig()
	const canvasId = 'c_n' + config.scriptCount
	ctx = canvas.getContext('2d')

	canvas.id = canvasId
	canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:' + config.zIndex + ';opacity:' + config.opacity
	// 将 canvas 添加到 body 的开始，使其遮盖 body
	document.body.insertBefore(canvas, document.body.firstChild)

	resizeCanvas() // 初始化画布大小和点的数量
	window.addEventListener('resize', resizeCanvas) // 监听窗口大小变化

	window.addEventListener('mousemove', function (event) {
		event = event || window.event
		mouse.x = event.clientX // 更新鼠标位置
		mouse.y = event.clientY
	})

	window.addEventListener('mouseout', function () {
		mouse.x = null // 鼠标移出画布时，重置鼠标位置
		mouse.y = null
	})

	updateColors() // 初始化时更新颜色

	draw()
}

/**
 * 实时修改配置。
 * @param {object} newConfig - 新的配置对象。
 */
export function updateConfig(newConfig) {
	config = { ...config, ...newConfig } // 合并新的配置

	if (newConfig.count !== undefined || newConfig.color !== undefined)
		adjustDotCount() //数量或颜色变化，都重新计算。
	else
		updateColors()
}

/**
 *  更新颜色配置
 */
export function updateColors() {
	const rootStyle = getComputedStyle(document.documentElement)
	const primaryColor = rootStyle.getPropertyValue('--color-primary').trim()

	try {
		const color = chroma(primaryColor) // 使用 chroma-js 解析颜色
		const rgbColor = color.rgb().join(',') // 获取 RGB 值

		config.color = rgbColor
		dots.forEach(dot => {
			dot.color = rgbColor
		})

	} catch (error) {
		console.error('Error parsing color with chroma-js:', error) // 日志：chroma-js 解析错误
		// 处理错误，例如使用默认颜色
		config.color = '0,0,0'
		dots.forEach(dot => { dot.color = '0,0,0' })
	}
}
