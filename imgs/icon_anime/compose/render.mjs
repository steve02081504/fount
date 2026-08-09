/**
 * 扁平 ch/fg 缓冲 → ANSI 帧（含指针光照）。
 */

import { sampleLight, RIPPLE_SPEED, RIPPLE_WIDTH, torchEase, LIGHT_RADIUS, lightFalloff } from '../gesture/light.mjs'

import {
	RESET, emitCell, flushRun, litSgr, runGlyphs,
} from './palette.mjs'

/** 复用的 sampleLight 输出（compose 热路径）。 */
const sampleOut = { ambient: 0, lift: 0 }
/** 复用的 ANSI 片段列表——每帧一次 join。 */
const frameParts = /** @type {string[]} */[]

/**
 * 将扁平 ch/fg 缓冲拼成无光照的 ANSI 帧字符串。
 * @param {string[]} ch 字符
 * @param {(string | null)[]} fg ANSI 前景码（null = 默认）
 * @param {number} width 列数
 * @param {number} height 行数
 * @returns {string} ANSI 帧
 */
const renderPlain = (ch, fg, width, height) => {
	const parts = frameParts
	parts.length = 0
	runGlyphs.length = 0
	for (let y = 0; y < height; y++) {
		if (y) {
			flushRun(parts)
			parts.push('\n')
		}
		let cur = null
		const row = y * width
		for (let x = 0; x < width; x++) {
			const f = fg[row + x]
			const glyph = f == null ? ' ' : ch[row + x]
			cur = emitCell(parts, cur, f, glyph)
		}
		if (cur !== null) {
			flushRun(parts)
			parts.push(RESET)
		}
	}
	flushRun(parts)
	return parts.join('')
}

/**
 * 涟漪环在当前龄期的轴对齐包围垫（视口格）。
 * @param {number} age 涟漪龄
 * @returns {number} 半宽
 */
const ripplePad = (age) => ((age * RIPPLE_SPEED + RIPPLE_WIDTH) / 2) + 1

/**
 * 将扁平 ch/fg 缓冲拼成 ANSI 帧字符串。
 * @param {string[]} ch 字符
 * @param {(string | null)[]} fg ANSI 前景码（null = 默认）
 * @param {number} width 列数
 * @param {number} height 行数
 * @param {import('../gesture/light.mjs').LightGesture} [light] 指针光效手势
 * @returns {string} ANSI 帧
 */
export const renderBuffers = (ch, fg, width, height, light = null) => {
	const torchBlend = light?.torchBlend ?? 0
	const hasTorch = torchBlend > 0
	const ripples = light?.ripples
	const hasRipple = !!ripples?.length
	if (!hasTorch && !hasRipple) return renderPlain(ch, fg, width, height)

	const parts = frameParts
	parts.length = 0
	runGlyphs.length = 0
	const torchR2 = LIGHT_RADIUS * LIGHT_RADIUS
	const torchAmbient = hasTorch ? torchEase(torchBlend) : 0

	for (let y = 0; y < height; y++) {
		if (y) {
			flushRun(parts)
			parts.push('\n')
		}
		let cur = null
		const row = y * width
		for (let x = 0; x < width; x++) {
			const f = fg[row + x]
			let needSample = hasTorch
			if (!needSample && hasRipple)
				for (const ripple of ripples) {
					const pad = ripplePad(ripple.age)
					if (Math.abs(x - ripple.x) <= pad * 2 && Math.abs(y - ripple.y) <= pad) {
						needSample = true
						break
					}
				}

			if (!needSample) {
				const glyph = f == null ? ' ' : ch[row + x]
				cur = emitCell(parts, cur, f, glyph, true)
				continue
			}

			if (hasTorch) {
				const dx = x - light.x
				const dy = y - light.y
				if (dx * dx + 4 * dy * dy >= torchR2 && !hasRipple) {
					const sgr = litSgr(f, 0, torchAmbient)
					if (sgr == null) {
						cur = emitCell(parts, cur, null, ' ', true)
						continue
					}
					cur = emitCell(parts, cur, sgr, f == null ? ' ' : ch[row + x], true)
					continue
				}
			}

			sampleLight(light, x, y, lightFalloff, sampleOut)
			const { ambient, lift } = sampleOut

			if (!(ambient > 0) && lift < 0.04) {
				const glyph = f == null ? ' ' : ch[row + x]
				cur = emitCell(parts, cur, f, glyph, true)
				continue
			}

			const sgr = litSgr(f, lift, ambient)
			if (sgr == null) {
				cur = emitCell(parts, cur, null, ' ', true)
				continue
			}
			cur = emitCell(parts, cur, sgr, f == null ? ' ' : ch[row + x], true)
		}
		if (cur !== null) {
			flushRun(parts)
			parts.push(RESET)
		}
	}
	flushRun(parts)
	return parts.join('')
}

/**
 * 薄适配：Cell[][] → 经 renderBuffers 的 ANSI 帧。
 * @param {({ ch?: string, fg?: string | null } | null)[][]} grid 行优先单元格
 * @param {number} width 列数
 * @param {number} height 行数
 * @returns {string} ANSI 帧
 */
export const renderGrid = (grid, width, height) => {
	const cells = width * height
	const ch = Array(cells)
	const fg = Array(cells)
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const cell = grid[y][x]
			const i = y * width + x
			ch[i] = cell?.ch ?? ' '
			fg[i] = cell?.fg ?? null
		}
	return renderBuffers(ch, fg, width, height)
}
