/**
 * 共用的压强 → 质量传递原语。
 *
 * 所有自由液体运动（重力、孔口、薄层、气体推动）均经
 * Torricelli √(ΔP/ρg) 或自由液面填平均衡。
 * 液压势 φ = P/(ρg) − y 为连通器坐标。
 */

import { RHO_G, LIQ_FULL } from './mat.mjs'

/** 单 tick 压强驱动边传递的最大质量。 */
export const P_FLOW_CAP = 0.45
/** 比例系数：质量 ∝ √(ΔP / RHO_G) — 格点压头单位的 Torricelli 孔口。 */
export const P_FLOW_GAIN = 0.55
/** 自由液面薄层蠕动的填充分差比例。 */
export const SHEET_GAIN = 0.25

/**
 * 液压势 φ = P/(ρg) − y（y↓ 为正向深度）。
 * 相同 φ ↔ 相同空气压下的自由液面高度。
 * @param {number} pressure 绝对压强
 * @param {number} y 世界行
 * @returns {number} 势
 */
export const hydraulicPhi = (pressure, y) => pressure / RHO_G - y

/**
 * 压头（格点压头单位）下的 Torricelli 孔口质量。
 * @param {number} pSrc 源压强
 * @param {number} pDst 目标压强
 * @param {number} srcLiq 可用质量
 * @param {number} dstRoom 目标剩余容量
 * @returns {number} 转移量
 */
export const pressureMove = (pSrc, pDst, srcLiq, dstRoom) => {
	const head = (pSrc - pDst) / RHO_G
	if (head <= 0.02 || srcLiq <= 0 || dstRoom <= 0) return 0
	return Math.min(P_FLOW_CAP, srcLiq, dstRoom, Math.sqrt(head) * P_FLOW_GAIN)
}

/**
 * 自由液面薄层均衡 — 仅填充分差，无加压射流。
 * @param {number} srcLiq 源填充
 * @param {number} dstLiq 目标填充
 * @param {number} dstRoom 剩余容量
 * @returns {number} 转移量
 */
export const sheetMove = (srcLiq, dstLiq, dstRoom) => {
	if (srcLiq <= dstLiq + 0.02 || dstRoom <= 0) return 0
	return Math.min((srcLiq - dstLiq) * SHEET_GAIN, srcLiq, dstRoom)
}

/**
 * 执行 src → dst 质量转移，并累加流向 EMA。
 * @param {Float32Array} liq 液体场
 * @param {Float32Array} flowX 水平流累加器
 * @param {Float32Array} flowY 垂直流累加器
 * @param {number} i 源索引
 * @param {number} ni 目标索引
 * @param {number} dx 水平步长
 * @param {number} dy 垂直步长
 * @param {number} move 质量
 * @returns {number} 实际转移质量
 */
export const applyTransfer = (liq, flowX, flowY, i, ni, dx, dy, move) => {
	if (move <= 0) return 0
	const m = Math.min(move, liq[i], LIQ_FULL - liq[ni])
	if (m <= 0) return 0
	liq[i] -= m
	liq[ni] += m
	flowX[i] += dx * m
	flowY[i] += dy * m
	flowX[ni] += dx * m
	flowY[ni] += dy * m
	return m
}
