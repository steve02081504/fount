/**
 * 动画场景：状态、阶段、入场/保持/退场。
 */

import { composeFrame } from '../compose/frame.mjs'
import { renderBuffers } from '../compose/render.mjs'
import { MAT, LIQ_DRAW, SOIL_CAP, T_AMB } from '../fluid/mat.mjs'
import {
	createWorld, clearDynamics, addLiquid, addMelt,
	idx, inWorld, scratch, applyGravityToWorld,
} from '../fluid/world.mjs'
import { spawnParticle } from '../fluid/particles.mjs'
import { stepFluid, stepResizeWeather } from '../fluid/step.mjs'
import { createLightGesture, tickLightGesture } from '../gesture/light.mjs'
import { createWindGesture, tickWindGesture, fillWindDrive } from '../gesture/wind.mjs'
import { tickGravity } from '../gravity.mjs'
import { hash01 } from '../hash.mjs'
import {
	ICON_W, ICON_H, ICON_BASE_ROWS, ICON_BASE_X0, ICON_BASE_X1,
	maxBodyD, maxPillarH,
} from '../icon.mjs'
import { terminalSize } from '../terminal.mjs'
import { generateTerrain, resizeTerrain } from '../terrain/index.mjs'
import { BASE_WIDTH, rebuildMaterials, refreshLandGeometry } from './materials.mjs'
import { onParticleHit } from './particle_hit.mjs'
import { leakPool } from './pool.mjs'
import { spawnRain } from './rain.mjs'

/** @typedef {ReturnType<typeof createAnimState>} AnimState */
/** @typedef {ReturnType<typeof createWorld>} FluidWorld */
/** @typedef {{ softBase?: boolean, softPillars?: boolean, softBody?: boolean }} SoftOpts */

/** 视口外的世界边距。 */
const VIEW_MARGIN = 28
/** 视口下方的额外世界行数。 */
const BOTTOM_EXTRA = 6
/** 扩张后新暴露地形应用的土壤沉降 tick 数。 */
export const RESIZE_WEATHER_TICKS = 12

/**
 * 默认视口尺寸（取自终端，回退到图标边界）。
 * @returns {{ width: number, height: number }} 视口尺寸
 */
const defaultSize = () => {
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
const iconOrigin = (world, width, height) => ({
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
const placeIcon = (world, width, height, seed) => {
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
	return {
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
}

/**
 * BFS 从保留格向新暴露土壤格传播温度衰减。
 * @param {FluidWorld} world 流体世界
 * @param {boolean[]} addedSolid 新暴露格掩码
 * @returns {void}
 */
const seedTempIntoAddedCells = (world, addedSolid) => {
	const W = world.worldW
	const queue = []
	for (let i = 0; i < addedSolid.length; i++) {
		if (!addedSolid[i]) continue
		const x = i % W
		const y = (i / W) | 0
		let best = T_AMB
		for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const nx = x + ox
			const ny = y + oy
			if (!inWorld(world, nx, ny)) continue
			const ni = ny * W + nx
			if (addedSolid[ni]) continue
			best = Math.max(best, world.temp[ni], world.melt[ni] >= 0.05 ? world.temp[ni] : T_AMB)
		}
		if (best > T_AMB + 0.05) {
			world.temp[i] = best * 0.85
			queue.push(i)
		}
	}
	for (let qi = 0; qi < queue.length; qi++) {
		const i = queue[qi]
		const x = i % W
		const y = (i / W) | 0
		const t0 = world.temp[i]
		if (t0 < 0.2) continue
		const next = t0 * 0.7
		for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const nx = x + ox
			const ny = y + oy
			if (!inWorld(world, nx, ny)) continue
			const ni = ny * W + nx
			if (!addedSolid[ni]) continue
			if (next > world.temp[ni] + 0.02) {
				world.temp[ni] = next
				queue.push(ni)
			}
		}
	}
}

/**
 * 围绕图标调整尺寸，保留既有地形/动力学，仅为新暴露区域生成地形。
 * @param {AnimState} state 动画状态
 * @param {{ width: number, height: number }} size 新视口尺寸
 * @returns {AnimState} 同一状态，原地 resize
 */
export const resizeAnimState = (state, { width, height }) => {
	width = Math.max(ICON_W, width)
	height = Math.max(ICON_H + 1, height)
	if (width === state.width && height === state.height) return state

	const old = state.world

	const newWorld = createWorld({ width, height, margin: VIEW_MARGIN, bottomExtra: BOTTOM_EXTRA })
	const { iconOx, iconOy } = iconOrigin(newWorld, width, height)
	const { terrain, addedSolid } = resizeTerrain(state.terrain, newWorld, {
		iconOx, iconOy, seed: state.seed,
		iconBaseRows: ICON_BASE_ROWS,
		iconBaseX0: ICON_BASE_X0,
		iconBaseX1: ICON_BASE_X1,
	})

	const shiftX = iconOx - state.iconOx
	const shiftY = iconOy - state.iconOy

	for (let y = 0; y < old.worldH; y++)
		for (let x = 0; x < old.worldW; x++) {
			const oi = y * old.worldW + x
			const amt = old.liq[oi]
			const meltAmt = old.melt[oi]
			const moist = old.moisture[oi]
			const cond = old.condense[oi]
			const cellTemp = old.temp[oi]
			if (amt < 0.05 && meltAmt < 0.05 && moist < 0.02 && cond < 0.02 && cellTemp <= T_AMB + 0.02) continue
			const nx = (x + shiftX) | 0
			const ny = (y + shiftY) | 0
			if (!inWorld(newWorld, nx, ny)) continue
			if (amt >= 0.05 && !terrain.solid[ny * newWorld.worldW + nx])
				addLiquid(newWorld, nx, ny, amt)
			if (meltAmt >= 0.05)
				addMelt(newWorld, nx, ny, meltAmt, cellTemp)
			else if (cellTemp > T_AMB + 0.02)
				newWorld.temp[idx(newWorld, nx, ny)] = Math.max(newWorld.temp[idx(newWorld, nx, ny)], cellTemp)
			if ((moist > 0.02 || cond > 0.02) && terrain.solid[ny * newWorld.worldW + nx]) {
				const ni = idx(newWorld, nx, ny)
				newWorld.moisture[ni] = Math.min(SOIL_CAP, newWorld.moisture[ni] + moist)
				newWorld.condense[ni] += cond
				newWorld.temp[ni] = Math.max(newWorld.temp[ni], cellTemp)
			}
		}

	seedTempIntoAddedCells(newWorld, addedSolid)

	const src = old.particles
	for (let i = 0; i < src.count; i++) {
		const nx = src.x[i] + shiftX
		const ny = src.y[i] + shiftY
		if (nx < -2 || nx >= newWorld.worldW + 2) continue
		spawnParticle(newWorld, nx, ny, src.vx[i], src.vy[i], src.life[i], src.amt[i])
	}

	state.width = width
	state.height = height
	state.world = newWorld
	state.iconOx = iconOx
	state.iconOy = iconOy
	state.terrain = terrain
	state.matKey = -1
	state.frameCh = null
	state.frameFg = null
	rebuildMaterials(state)

	let hasAddedSoil = false
	for (let i = 0; i < addedSolid.length; i++) {
		if (!addedSolid[i] || (newWorld.mat[i] !== MAT.HORIZON && newWorld.mat[i] !== MAT.SOLID)) continue
		hasAddedSoil = true
		break
	}
	if (hasAddedSoil)
		stepResizeWeather(newWorld, RESIZE_WEATHER_TICKS)
	refreshLandGeometry(state)
	return state
}

/**
 * 推进一帧模拟并合成 ANSI 帧。
 * @param {AnimState} state 动画状态
 * @returns {string} ANSI 帧
 */
const simFrame = (state) => {
	rebuildMaterials(state)
	tickWindGesture(state.wind)
	tickLightGesture(state.light)
	applyGravityToWorld(state.world, tickGravity())
	const { world } = state
	/** @type {Float32Array | undefined} */
	let driveUx
	/** @type {Float32Array | undefined} */
	let driveUy
	if (state.wind.down) {
		const n = world.worldW * world.worldH
		driveUx = scratch(world, 'windDriveUx', n, Float32Array)
		driveUy = scratch(world, 'windDriveUy', n, Float32Array)
		fillWindDrive(state.wind, world, driveUx, driveUy)
	}
	const opts = state.fluidOpts ??= {
		time: 0,
		seed: 0,
		driveUx: undefined,
		driveUy: undefined,
		onHit: onParticleHit,
		state,
		/** @returns {void} 粒子积分前每 tick 降雨 */
		beforeParticles: () => spawnRain(state),
	}
	opts.time = state.frame
	opts.seed = state.seed
	opts.driveUx = driveUx
	opts.driveUy = driveUy
	stepFluid(world, opts)
	refreshLandGeometry(state)
	const { iconOx, iconOy } = state
	for (const ly of ICON_BASE_ROWS) {
		const y = iconOy + ly
		for (let i = 0; i < BASE_WIDTH; i++) {
			const x = iconOx + ICON_BASE_X0 + i
			if (!inWorld(world, x, y)) continue
			const id = idx(world, x, y)
			if (world.mat[id] !== MAT.POOL) continue
			if (world.liq[id] >= LIQ_DRAW && hash01(x, state.frame) > 0.35)
				leakPool(world, state, x, y)
		}
	}
	return composeFrame(state)
}

/**
 * 写软边标志，推进一帧模拟并合成。
 * @param {AnimState} state 动画状态
 * @param {SoftOpts} [soft] 软边选项
 * @returns {Generator<string, void, unknown>} 一帧 ANSI
 */
function* show(state, soft = {}) {
	state.softBase = !!soft.softBase
	state.softPillars = !!soft.softPillars
	state.softBody = !!soft.softBody
	yield simFrame(state)
	state.frame++
}

/**
 * 底座 → 柱 → 体，生长为完整图标。
 * @param {AnimState} [state] 动画状态
 * @returns {Generator<string, void, unknown>} 入场帧
 */
export function* enter(state = createAnimState()) {
	for (let n = 0; n <= BASE_WIDTH; n++) {
		state.baseBot = state.baseTop = n
		yield* show(state, { softBase: n < BASE_WIDTH })
	}
	for (let g = 1; g <= maxPillarH; g++) {
		state.pillars = g
		yield* show(state, { softPillars: g < maxPillarH })
		if (g < maxPillarH)
			yield* show(state, { softPillars: false })
	}
	state.pillars = maxPillarH
	yield* show(state)
	for (let reach = 0; reach <= maxBodyD; reach++) {
		state.bodyReach = reach
		state.bodyMinD = 0
		yield* show(state, { softBody: reach < maxBodyD })
	}
	state.bodyReach = maxBodyD
	yield* show(state)
}

/**
 * 在持续降雨下保持已长成的图标。
 * @param {AnimState} [state] 动画状态
 * @returns {Generator<string, void, unknown>} 保持帧
 */
export function* hold(state = createAnimState()) {
	state.baseBot = state.baseTop = BASE_WIDTH
	state.pillars = maxPillarH
	state.bodyReach = maxBodyD
	state.bodyMinD = 0
	for (; ;)
		yield* show(state)
}

/**
 * 拆解体 → 柱 → 底座；流体继续模拟。
 * @param {AnimState} [state] 动画状态
 * @returns {Generator<string, void, unknown>} 退场帧
 */
export function* exit(state = createAnimState()) {
	if (state.rainUntil === Infinity)
		state.rainUntil = Math.max(0, state.frame - 1)

	if (state.bodyReach >= 0) {
		const reach = state.bodyReach
		for (let gone = 0; gone <= reach + 1; gone++) {
			state.bodyMinD = gone
			yield* show(state, { softBody: gone <= reach })
		}
		state.bodyReach = -1
		state.bodyMinD = 0
	}

	if (state.pillars > 0) {
		const from = state.pillars
		for (let g = from; g >= 0; g--) {
			state.pillars = g
			if (g > 0) {
				yield* show(state, { softPillars: true })
				yield* show(state, { softPillars: false })
			}
			else
				yield* show(state)
		}
	}

	if (state.baseBot > 0 || state.baseTop > 0) {
		const from = Math.max(state.baseBot, state.baseTop)
		for (let n = from; n >= 1; n--) {
			state.baseBot = state.baseTop = n
			yield* show(state, { softBase: n < BASE_WIDTH })
		}
		state.baseBot = state.baseTop = 0
	}

	clearDynamics(state.world)
	const cells = state.width * state.height
	yield renderBuffers(Array(cells).fill(' '), Array(cells).fill(null), state.width, state.height)
}
