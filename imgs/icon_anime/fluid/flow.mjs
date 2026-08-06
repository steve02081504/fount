/**
 * 共用的压强 → 质量传递原语。
 *
 * 粘滞阶梯（唯一旋钮）：
 *   visc ≤ VISC_INERTIAL          → 惯性分支（气：速度场）
 *   VISC_INERTIAL < visc < VISC_SOLID → Stokes 通量（水 / 熔岩）
 *   visc ≥ VISC_SOLID             → 冻结
 *
 * 所有自由液体运动经 Torricelli √(ΔP/ρg) 或自由液面填平均衡。
 * 液压势 φ = P/(ρg) − depth 为连通器坐标。
 */

import { RHO_G, LIQ_FULL, VISC_SOLID, VISC_INERTIAL } from './mat.mjs'

/** 单 tick 压强驱动边传递的最大质量。 */
export const P_FLOW_CAP = 0.45
/** 比例系数：质量 ∝ √(ΔP / RHO_G) — 格点压头单位的 Torricelli 孔口。 */
export const P_FLOW_GAIN = 0.55
/** 自由液面薄层蠕动的填充分差比例。 */
export const SHEET_GAIN = 0.25

/**
 * 粘滞 → 流量增益 [0, 1]（Stokes 分支 mobility）。
 * @param {number} visc 粘滞
 * @returns {number} 增益
 */
export const viscGain = (visc) => {
	if (visc >= VISC_SOLID) return 0
	if (visc <= VISC_INERTIAL) return 1
	return Math.max(0, 1 - visc)
}

/**
 * 粘滞是否走惯性分支（气体速度场）。
 * @param {number} visc 粘滞
 * @returns {boolean} 惯性
 */
export const isInertialVisc = visc => visc <= VISC_INERTIAL

/**
 * 液压势 φ = P/(ρg) − depth（向下为正向深度）。
 * @param {number} pressure 绝对压强
 * @param {number} depth 重力深度
 * @returns {number} 势
 */
export const hydraulicPhi = (pressure, depth) => pressure / RHO_G - depth

/**
 * 压头（格点压头单位）下的 Torricelli 孔口质量。
 * @param {number} pSrc 源压强
 * @param {number} pDst 目标压强
 * @param {number} srcLiq 可用质量
 * @param {number} dstRoom 目标剩余容量
 * @param {number} [visc=0.05] 源粘滞
 * @returns {number} 转移量
 */
export const pressureMove = (pSrc, pDst, srcLiq, dstRoom, visc = 0.05) => {
	const gain = viscGain(visc)
	if (gain <= 0) return 0
	const head = (pSrc - pDst) / RHO_G
	if (head <= 0.02 || srcLiq <= 0 || dstRoom <= 0) return 0
	return Math.min(P_FLOW_CAP, srcLiq, dstRoom, Math.sqrt(head) * P_FLOW_GAIN * gain)
}

/**
 * 自由液面薄层均衡 — 仅填充分差，无加压射流。
 * @param {number} srcLiq 源填充
 * @param {number} dstLiq 目标填充
 * @param {number} dstRoom 剩余容量
 * @param {number} [visc=0.05] 源粘滞
 * @returns {number} 转移量
 */
export const sheetMove = (srcLiq, dstLiq, dstRoom, visc = 0.05) => {
	const gain = viscGain(visc)
	if (gain <= 0) return 0
	if (srcLiq <= dstLiq + 0.02 || dstRoom <= 0) return 0
	return Math.min((srcLiq - dstLiq) * SHEET_GAIN * gain, srcLiq, dstRoom)
}

/**
 * 执行 src → dst 质量转移，并累加流向 EMA。
 * @param {Float32Array} mass 质量场
 * @param {Float32Array} flowX 水平流累加器
 * @param {Float32Array} flowY 垂直流累加器
 * @param {number} i 源索引
 * @param {number} ni 目标索引
 * @param {number} dx 水平步长
 * @param {number} dy 垂直步长
 * @param {number} move 质量
 * @returns {number} 实际转移质量
 */
export const applyTransfer = (mass, flowX, flowY, i, ni, dx, dy, move) => {
	if (move <= 0) return 0
	const m = Math.min(move, mass[i], LIQ_FULL - mass[ni])
	if (m <= 0) return 0
	mass[i] -= m
	mass[ni] += m
	flowX[i] += dx * m
	flowY[i] += dy * m
	flowX[ni] += dx * m
	flowY[ni] += dy * m
	return m
}
