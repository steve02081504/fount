/**
 * 图标材质与土地 mat 绘制。
 */

import { MAT } from '../fluid/mat.mjs'
import { releaseNonSoilWater, setMat } from '../fluid/world.mjs'
import { refreshTerrainGeometry } from '../terrain/index.mjs'
import {
	BODY, ICON_BASE_ROWS, ICON_BASE_X0, ICON_BASE_X1,
} from '../icon.mjs'

/** 底座板列跨度。 */
export const BASE_WIDTH = ICON_BASE_X1 - ICON_BASE_X0

/**
 * 按 `world.land` 给暴露土地打 HORIZON / SOLID。
 * @param {import('./index.mjs').AnimState} state 动画状态
 * @returns {void}
 */
const applyTerrain = (state) => {
	const { world, terrain } = state
	const { worldW: W, worldH: H } = world
	const { surface, solid } = terrain
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			if (!solid[y * W + x]) continue
			setMat(world, x, y, y === surface[x] ? MAT.HORIZON : MAT.SOLID)
		}
}

/**
 * 将已生长的底座板列绘制为 POOL（软边为 SLOPE_*）。
 * @param {import('./index.mjs').AnimState} state 动画状态
 * @returns {void}
 */
const paintBaseMats = (state) => {
	const { world, iconOx, iconOy, baseBot, baseTop, softBase } = state
	for (const ly of ICON_BASE_ROWS) {
		const y = iconOy + ly
		const fromLeft = ly === 20 || ly === 22
		const n = fromLeft ? baseBot : baseTop
		for (let i = 0; i < BASE_WIDTH; i++) {
			const on = fromLeft ? i < n : i >= BASE_WIDTH - n
			if (!on) continue
			const x = iconOx + ICON_BASE_X0 + i
			const edge = softBase && (fromLeft ? i === n - 1 : i === BASE_WIDTH - n)
			setMat(world, x, y,
				edge && n < BASE_WIDTH
					? fromLeft ? MAT.SLOPE_R : MAT.SLOPE_L
					: MAT.POOL)
		}
	}
}

/**
 * 仅清除图标材质（BODY / POOL / SLOPE），保留土壤与 SEAL。
 * @param {import('../fluid/world.mjs').FluidWorld} world 流体世界
 * @returns {void}
 */
const clearIconMats = (world) => {
	const { mat } = world
	let touched = false
	for (let i = 0; i < mat.length; i++) {
		const m = mat[i]
		if (m !== MAT.BODY && m !== MAT.POOL && m !== MAT.SLOPE_L && m !== MAT.SLOPE_R) continue
		mat[i] = MAT.AIR
		touched = true
	}
	if (!touched) return
	world.airDirty = true
	world.gasGeomDirty = true
}

/**
 * 土地占位变更后重算地表 / 轮廓。
 * @param {import('./index.mjs').AnimState} state 动画状态
 * @returns {void}
 */
export const refreshLandGeometry = (state) => {
	if (!state.world.soilGeomDirty) return
	state.world.soilGeomDirty = false
	refreshTerrainGeometry(state.terrain)
}

/**
 * 在 [bodyMinD, bodyReach] 范围内将体素格绘制为 BODY。
 * @param {import('./index.mjs').AnimState} state 动画状态
 * @returns {void}
 */
const paintBodyMats = (state) => {
	const { world, iconOx, iconOy, bodyReach, bodyMinD } = state
	if (bodyReach < 0) return
	for (let i = 0; i < BODY.count; i++) {
		const d = BODY.d[i]
		if (d > bodyReach || d < bodyMinD) continue
		setMat(world, iconOx + BODY.x[i], iconOy + BODY.y[i], MAT.BODY)
	}
}

/**
 * 将阶段字段打包为单个 int，用于跳过材质重建。
 * @param {import('./index.mjs').AnimState} state 动画状态
 * @returns {number} 打包的阶段键
 */
const matStageKey = (state) =>
	state.baseBot | (state.baseTop << 6) | ((state.bodyReach + 1) << 12) | (state.bodyMinD << 20) | (+state.softBase << 28)

/**
 * 打包阶段键变化时重建图标材质。
 * @param {import('./index.mjs').AnimState} state 动画状态
 * @returns {void}
 */
export const rebuildMaterials = (state) => {
	const key = matStageKey(state)
	if (state.matKey === key) return
	state.matKey = key
	clearIconMats(state.world)
	applyTerrain(state)
	if (state.baseBot > 0 || state.baseTop > 0) paintBaseMats(state)
	paintBodyMats(state)
	releaseNonSoilWater(state.world)
}
