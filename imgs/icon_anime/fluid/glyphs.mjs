/**
 * 由水量 × 液体速度（非气体风）驱动的水 / 水滴字形集。
 */

import { COND_DRAW, COND_DRIP, SUBSTANCE, VISC_SOLID, rhoOf, viscOf } from './mat.mjs'

/** 垂直下落 / 水流达到此量时优先使用密竖条字形。 */
export const FALL_HEAVY = 0.5
/** 速度低于此值 → 静水字形。 */
export const STILL_SPEED = 0.06
/** |vx| 超过此值（相对垂直）视为水平/斜向运动。 */
export const SLANT_SPEED = 0.08
/** |vx| 主导 |vy| → 平坦 `-`。 */
export const FLAT_RATIO = 1.2
/** 动量（水量·速度）达到/超过此值使用高动量斜线字形。 */
export const HIGH_MOMENTUM = 0.28
/** 绝对速度达到/超过此值亦视为高动量。 */
export const HIGH_SPEED = 0.55

/** 高动量左斜。 */
export const WATER_HIGH_L = ['/', '∕']
/** 高动量右斜。 */
export const WATER_HIGH_R = ['\\', '∖']
/** 低动量朝左下。 */
export const WATER_LOW_DL = ['‚', '´', '′', '‘', '’', '″', '“', '„', '‴', '⁗']
/** 低动量朝右下。 */
export const WATER_LOW_DR = ['‵', '‛', '‶', '‟', '‷', '⁏']
/** 纯垂直下落（重 → 轻）。 */
export const WATER_FALL = ['|', '¦', '‖', '⁞', '⁚', '⁝', '.']
/** 近静水池（轻 → 重）。 */
export const WATER_STILL = ['‥', '…', '~', '⁓', '–']
/** 高粘滞熔岩块状。 */
export const LAVA_THICK = ['█', '▓', '▒', '░', '#', '%', '*']

/**
 * 熔岩字形：高粘滞块状，低粘滞复用流动水字形。
 * @param {number} amount 质量
 * @param {number} temp 温度
 * @param {number} [phase=0] 相位
 * @param {number} [vx=0] 水平速度
 * @param {number} [vy=0] 垂直速度
 * @returns {string} 字形
 */
export const lavaChar = (amount, temp, phase = 0, vx = 0, vy = 0) => {
	const visc = viscOf(rhoOf(SUBSTANCE.ROCK, temp))
	if (visc >= VISC_SOLID)
		return pickWaterGlyph(LAVA_THICK, amount * (0.4 + Math.min(1, visc) * 0.6), phase, true)
	return waterChar(amount, phase, vx, vy)
}

/**
 * 按水量（+ 相位抖动）从字形集中选取。
 * @param {readonly string[]} chars 字形集
 * @param {number} amount [0, 1+] 水量
 * @param {number} phase 闪烁种子
 * @param {boolean} [heavyFirst=false] 为 true 时水量越大 → 越靠前字符
 * @returns {string} 字形
 */
export const pickWaterGlyph = (chars, amount, phase, heavyFirst = false) => {
	const n = chars.length
	const t = heavyFirst ? 1 - Math.min(0.999, Math.max(0, amount)) : Math.min(0.999, Math.max(0, amount))
	let i = (t * n) | 0
	if ((phase | 0) & 1) i = Math.min(n - 1, i + 1)
	return chars[i]
}

/**
 * 由水量 + 液体/粒子速度（非气体风）选取水字形。
 * @param {number} amount 水量
 * @param {number} [phase=0] 闪烁种子
 * @param {number} [vx=0] 水平速度
 * @param {number} [vy=0] 垂直速度（向下 +）
 * @returns {string} 字形
 */
export const waterChar = (amount, phase = 0, vx = 0, vy = 0) => {
	const ax = Math.abs(vx)
	const ay = Math.abs(vy)
	const speed2 = vx * vx + vy * vy
	const still2 = STILL_SPEED * STILL_SPEED

	if (speed2 < still2)
		return pickWaterGlyph(WATER_STILL, amount, phase)

	const speed = Math.sqrt(speed2)
	if (ax >= SLANT_SPEED && ax > ay * FLAT_RATIO) return '-'

	const slant = ax >= SLANT_SPEED
	const high = amount * speed >= HIGH_MOMENTUM || speed >= HIGH_SPEED

	if (slant) {
		if (high)
			return pickWaterGlyph(vx > 0 ? WATER_HIGH_R : WATER_HIGH_L, amount, phase, true)
		return pickWaterGlyph(vx > 0 ? WATER_LOW_DR : WATER_LOW_DL, amount, phase, true)
	}

	const fallAmt = amount >= FALL_HEAVY ? 1 : amount / FALL_HEAVY * 0.4
	return pickWaterGlyph(WATER_FALL, fallAmt, phase, true)
}

/**
 * 自由液体字形；可选 `falling` 使平静格偏向向下。
 * @param {number} amount 水量
 * @param {number} phase 闪烁种子
 * @param {boolean} [falling=false] 下方无支撑
 * @param {number} [vx=0] 水平速度
 * @param {number} [vy=0] 垂直速度
 * @returns {string} 字形
 */
export const liquidChar = (amount, phase, falling = false, vx = 0, vy = 0) => {
	if (falling && vx * vx + vy * vy < STILL_SPEED * STILL_SPEED) vy = 0.55
	return waterChar(amount, phase, vx, vy)
}

/**
 * 土壤天花板悬挂水滴，按凝结量选取。
 * @param {number} amount 凝结质量
 * @param {number} phase 闪烁种子
 * @returns {string} 字形
 */
export const dripChar = (amount, phase) => {
	if (amount >= COND_DRIP) return 'o'
	if (amount >= 0.6) return phase & 1 ? 'o' : '*'
	if (amount >= COND_DRAW) return phase & 1 ? ',' : '.'
	return ' '
}
