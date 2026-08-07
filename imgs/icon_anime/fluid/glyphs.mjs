/**
 * 由水量 × 液体速度（非气体风）驱动的流体字形集。
 * 水 / 熔岩 / 雨滴共用同一套运动字形；粘滞只改物理流速，不改字母表。
 */

import { COND_DRAW, COND_DRIP } from './mat.mjs'

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
 * 由水量 + 液体/粒子速度（非气体风）选取流体字形。
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
 * 自由液体字形；可选 `falling` 在低速时沿 ĝ 偏向下落字形。
 * @param {number} amount 水量
 * @param {number} phase 闪烁种子
 * @param {boolean} [falling=false] 重力下无支撑
 * @param {number} [vx=0] 水平速度
 * @param {number} [vy=0] 垂直速度
 * @param {number} [gx=0] 重力 x（单位）
 * @param {number} [gy=1] 重力 y（单位）
 * @returns {string} 字形
 */
export const liquidChar = (amount, phase, falling = false, vx = 0, vy = 0, gx = 0, gy = 1) => {
	if (falling && vx * vx + vy * vy < STILL_SPEED * STILL_SPEED) {
		const len = Math.hypot(gx, gy) || 1
		vx = gx / len * 0.55
		vy = gy / len * 0.55
	}
	return waterChar(amount, phase, vx, vy)
}

/**
 * 熔岩字形：与水同一套雨滴/流向字母表；`temp` 仅保留调用签名（着色在 compose）。
 * @param {number} amount 质量
 * @param {number} _temp 温度（未用于选字）
 * @param {number} [phase=0] 相位
 * @param {number} [vx=0] 水平速度
 * @param {number} [vy=0] 垂直速度
 * @param {boolean} [falling=false] 重力下方无支撑
 * @param {number} [gx=0] 重力 x
 * @param {number} [gy=1] 重力 y
 * @returns {string} 字形
 */
export const lavaChar = (amount, _temp, phase = 0, vx = 0, vy = 0, falling = false, gx = 0, gy = 1) =>
	liquidChar(amount, phase, falling, vx, vy, gx, gy)

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
