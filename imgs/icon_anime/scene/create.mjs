/**
 * 动画状态创建与图标放置。
 */

import { createWorld } from '../fluid/world/index.mjs'
import { createLightGesture } from '../gesture/light.mjs'
import { createWindGesture } from '../gesture/wind.mjs'
import {
	ICON_W, ICON_H, ICON_BASE_ROWS, ICON_BASE_X0, ICON_BASE_X1,
} from '../icon.mjs'
import { terminalSize } from '../io.mjs'
import { generateTerrain } from '../terrain/index.mjs'

import { onParticleHit } from './particle_hit.mjs'
import { spawnRain } from './rain.mjs'

/** @typedef {ReturnType<typeof createAnimState>} AnimState */
/** @typedef {ReturnType<typeof createWorld>} FluidWorld */

/** 视口外的世界边距。 */
export const VIEW_MARGIN = 28
/** 视口下方的额外世界行数。 */
export const BOTTOM_EXTRA = 6

/**
 * 默认视口尺寸（取自终端，回退到图标边界）。
 * @returns {{ width: number, height: number }} 视口尺寸
 */
export const defaultSize = () => {
	const { columns, rows } = terminalSize()
	return {
		width: Math.max(ICON_W, columns || ICON_W),
		height: Math.max(ICON_H + 1, (rows || 25) - 1),
	}
}

/**
 * 给定视口尺寸下图标在世界坐标中的原点。
 * @param {FluidWorld} world 流体世界
 * @param {number} width 视口宽
 * @param {number} height 视口高
 * @returns {{ iconOx: number, iconOy: number }} 图标原点
 */
export const iconOrigin = (world, width, height) => ({
	iconOx: world.ox + Math.floor((width - ICON_W) / 2),
	iconOy: Math.floor((height - ICON_H) / 2),
})

/**
 * 放置图标原点，并生成以基座锚定的地形。
 * @param {FluidWorld} world 流体世界
 * @param {number} width 视口宽
 * @param {number} height 视口高
 * @param {number} seed 地形种子
 * @returns {{ iconOx: number, iconOy: number, terrain: import('../terrain/index.mjs').TerrainData }} 放置结果
 */
export const placeIcon = (world, width, height, seed) => {
	const { iconOx, iconOy } = iconOrigin(world, width, height)
	return {
		iconOx, iconOy,
		terrain: generateTerrain(world, {
			iconOx, iconOy, seed,
			iconBaseRows: ICON_BASE_ROWS,
			iconBaseX0: ICON_BASE_X0,
			iconBaseX1: ICON_BASE_X1,
		}),
	}
}

/**
 * 创建带地形与空流体世界的新动画状态。
 * @param {{ width?: number, height?: number, seed?: number }} [opts] 尺寸与种子覆盖
 * @returns {AnimState} 新动画状态
 */
export const createAnimState = (opts = {}) => {
	const { width: dw, height: dh } = defaultSize()
	const width = opts.width ?? dw
	const height = opts.height ?? dh
	const seed = opts.seed ?? (Math.random() * 1e9 | 0)
	const world = createWorld({ width, height, margin: VIEW_MARGIN, bottomExtra: BOTTOM_EXTRA })
	const { iconOx, iconOy, terrain } = placeIcon(world, width, height, seed)
	const state = {
		width, height, seed,
		world, iconOx, iconOy, terrain,
		baseBot: 0,
		baseTop: 0,
		pillars: 0,
		bodyReach: -1,
		bodyMinD: 0,
		frame: 0,
		rainUntil: Infinity,
		softBase: false,
		softPillars: false,
		softBody: false,
		matKey: -1,
		light: createLightGesture(),
		wind: createWindGesture(),
		frameCh: null,
		frameFg: null,
	}
	state.fluidOpts = {
		time: 0,
		seed: 0,
		driveUx: undefined,
		driveUy: undefined,
		onHit: onParticleHit,
		state,
		/** @returns {void} 粒子积分前每 tick 降雨 */
		beforeParticles: () => spawnRain(state),
	}
	return state
}
