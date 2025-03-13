import chroma from 'https://esm.run/chroma-js'

'use strict'

const requestAnimationFrame = window.requestAnimationFrame || function (callback) { window.setTimeout(callback, 1000 / 45) }

// 使用 matchMedia 更可靠地判断是否为移动设备
const isMobile = window.matchMedia('(pointer: coarse)').matches

let canvas, ctx, canvasWidth, canvasHeight, config, dots, pointers // 改为 pointers

/**
 * 更新画布大小。
 */
function resizeCanvas() {
	canvasWidth = canvas.width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth
	canvasHeight = canvas.height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight

	// 使用配置的背景颜色
	ctx.fillStyle = config.backgroundColor
	ctx.fillRect(0, 0, canvasWidth, canvasHeight)

	// 动态调整点的数量
	adjustDotCount()
}

/**
 * 根据当前配置调整点的数量
 */
function adjustDotCount() {
	const targetCount = Math.max(10, Math.floor(canvasWidth * canvasHeight * config.density)) // 最小数量限制
	const currentCount = dots.length

	if (targetCount > currentCount)
		// 添加点
		for (let i = 0; i < targetCount - currentCount; i++) {
			const x = Math.random() * canvasWidth
			const y = Math.random() * canvasHeight
			const dx = 2 * Math.random() - 1
			const dy = 2 * Math.random() - 1
			dots.push({ x, y, dx, dy, max: 6000 })
		}
	else if (targetCount < currentCount)
		// 移除多余的点
		dots.splice(0, currentCount - targetCount)
}

/**
 * 绘制连接线
 * @param {CanvasRenderingContext2D} ctx - Canvas 渲染上下文
 * @param {string} configColor - 配置颜色
 * @param {object} dot1 - 第一个点对象
 * @param {object} dot2 - 第二个点对象
 * @param {boolean} isPointer - 是否是鼠标或触摸点
 */
function drawConnection(ctx, configColor, dot1, dot2, isPointer) {
	const dx = dot1.x - dot2.x
	const dy = dot1.y - dot2.y
	const distanceSquared = dx * dx + dy * dy
	const otherPointerMax = isPointer ? dot2.max : dot1.max // 根据连接对象选择 max 值

	if (distanceSquared < otherPointerMax) {
		const lineOpacityFactor = (otherPointerMax - distanceSquared) / otherPointerMax
		if (lineOpacityFactor <= 0) return

		if (isPointer && distanceSquared >= otherPointerMax / 2) {
			dot1.x -= 0.03 * dx
			dot1.y -= 0.03 * dy
		}

		ctx.beginPath()
		ctx.lineWidth = lineOpacityFactor * 0.5
		ctx.strokeStyle = 'rgba(' + configColor + ',' + (lineOpacityFactor + 0.2) + ')'
		ctx.moveTo(dot1.x, dot1.y)
		ctx.lineTo(dot2.x, dot2.y)
		ctx.stroke()
		ctx.closePath()
	}
}


/**
 * 绘制动画帧。
 */
function draw() {
	// 重新绘制背景 (缓存)
	ctx.fillStyle = config.backgroundColor // 使用配置的背景颜色
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
		ctx.fillStyle = 'rgba(' + configColor + ', 1)' // 使用 config.color
		ctx.fillRect(Math.round(dot.x - 0.5), Math.round(dot.y - 0.5), 1, 1)
	}

	// 优化后的连接线绘制循环
	for (let i = 0; i < numDots; i++) {
		const dot = dots[i]

		// 1. dots 连接到 pointers
		for (let j = 0; j < pointers.length; j++) {
			const pointer = pointers[j]
			if (pointer.x !== null && pointer.y !== null)  // 确保 pointer 可用
				drawConnection(ctx, configColor, dot, pointer, true) // dots 连接到 pointers
		}

		// 2. dots 之间互相连接 (可以根据需求调整，例如只连接索引比 i 大的点，避免重复连接)
		for (let j = i + 1; j < numDots; j++) { // 从 i+1 开始，避免重复连接和点自身连接
			const otherDot = dots[j]
			drawConnection(ctx, configColor, dot, otherDot, false) // dots 之间互相连接
		}
	}


	// 仅在移动端隐藏鼠标指针
	if (isMobile) {
		pointers[0].x = null // 将鼠标位置设置为 null，移动端不显示鼠标连接线
		pointers[0].y = null
	}
	requestAnimationFrame(draw) // 请求下一帧动画
}

/**
 * 初始化线条背景。
 */
export function initLinesBackground(initconfig) {
	dots = []
	// 使用数组来存储多个指针（鼠标和触摸点）
	pointers = [{ x: null, y: null, max: 20000, type: 'mouse', id: 'mouse' }] // 初始包含鼠标, 添加 id

	canvas = document.createElement('canvas')
	config = {
		zIndex: -1,
		opacity: 'opacity',
		color: '255, 255, 255', // 初始颜色，会被 updateColors 更新
		count: 99,
		backgroundColor: '#f0f0f0', // 新增 backgroundColor 配置
		density: 0.0001, // 默认密度因子
		...initconfig
	}
	ctx = canvas.getContext('2d')

	canvas.id = 'canvas-lines-bg'
	canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:' + config.zIndex + ';opacity:' + config.opacity
	document.body.insertBefore(canvas, document.body.firstChild)

	updateColors() // 初始化时更新颜色配置，包括 backgroundColor
	resizeCanvas()
	window.addEventListener('resize', resizeCanvas)

	// 鼠标事件 (保持鼠标事件监听，或者可以统一用 Pointer Events 处理所有输入)
	window.addEventListener('mousemove', handlePointerMove) // 使用统一的 pointermove 处理鼠标
	window.addEventListener('mouseout', handlePointerOut)   // 使用统一的 pointerout 处理鼠标移出

	// 使用 Pointer Events API 统一处理触摸和鼠标事件
	window.addEventListener('pointerdown', handlePointerDown, false)
	window.addEventListener('pointermove', handlePointerMove, false)
	window.addEventListener('pointerup', handlePointerEnd, false)
	window.addEventListener('pointercancel', handlePointerEnd, false)

	draw()
}


/**
 * 处理 pointerdown 事件
 * @param {PointerEvent} event
 */
function handlePointerDown(event) {
	if (event.pointerType === 'mouse') return // 鼠标事件由 mousemove/mouseout 单独处理

	const pointer = pointers.find(p => p.id === event.pointerId)

	if (!pointer)
		// 添加新的触摸点
		pointers.push({
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			max: 20000,
			type: event.pointerType
		})

}

/**
 * 处理 pointermove 事件 (统一处理鼠标和触摸移动)
 * @param {PointerEvent} event
 */
function handlePointerMove(event) {
	if (event.pointerType === 'mouse') {
		// 更新鼠标位置
		pointers[0].x = event.clientX
		pointers[0].y = event.clientY
	} else {
		// 更新触摸点位置
		const pointer = pointers.find(p => p.id === event.pointerId)
		if (pointer) {
			pointer.x = event.clientX
			pointer.y = event.clientY
		}
	}
}


/**
 * 处理 pointerout 事件 (鼠标移出)
 */
function handlePointerOut() {
	pointers[0].x = null // 鼠标移出，重置鼠标位置
	pointers[0].y = null
}


/**
 * 处理 pointerup 和 pointercancel 事件 (统一处理触摸结束)
 * @param {PointerEvent} event
 */
function handlePointerEnd(event) {
	if (event.pointerType === 'mouse') return // 鼠标事件不需要移除 pointer

	const index = pointers.findIndex(p => p.id === event.pointerId)
	if (index !== -1)
		pointers.splice(index, 1) // 移除触摸点

}

/**
 * 实时修改配置。
 * @param {object} newConfig - 新的配置对象。
 */
export function updateConfig(newConfig) {
	config = { ...config || {}, ...newConfig } // 合并新的配置

	if (newConfig.count !== undefined || newConfig.color !== undefined || newConfig.density !== undefined)
		adjustDotCount() //数量或颜色或密度变化，都重新计算。
	else if (newConfig.backgroundColor !== undefined)
		canvas && resizeCanvas() // 背景色变化，重新绘制背景
}

/**
 *  更新颜色配置
 */
export function updateColors() {
	if(!config) return
	const rootStyle = getComputedStyle(document.documentElement)
	const primaryColor = rootStyle.getPropertyValue('--color-primary').trim()
	const baseColor200 = rootStyle.getPropertyValue('--color-base-200').trim() // 获取背景色 css 变量

	try {
		config.color = chroma(primaryColor).rgb().join(',') // 获取 RGB 值
		config.backgroundColor = chroma(baseColor200).hex()
	} catch (error) {
		console.error('Error parsing color with chroma-js:', error) // 日志：chroma-js 解析错误
		// 处理错误，例如使用默认颜色
		config.color = '255, 255, 255'
		config.backgroundColor = '#f0f0f0'
	}
}
