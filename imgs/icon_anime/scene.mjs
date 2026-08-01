/**
 * 动画场景：状态、材质、降雨、水池渗漏、阶段。
 */

import { composeFrame, renderBuffers } from './compose.mjs'
import {
	MAT, LIQ_DRAW, createWorld, clearMaterials, clearDynamics, setMat, addLiquid, addMoisture,
	spawnParticle, queueSplash, stepFluid, labelAirRegions, stepLiquid,
	windProfileAt, idx, inWorld, isLiquidBarrier, releaseNonSoilWater,
	soilAbsorbFactor, SOIL_CAP, SOIL_HIT_ABSORB_FRAC, scratch,
} from './fluid/index.mjs'
import { createLightGesture, tickLightGesture } from './gesture/light.mjs'
import { createWindGesture, tickWindGesture, fillWindDrive } from './gesture/wind.mjs'
import { hash01 } from './hash.mjs'
import {
	ICON_W, ICON_H, ICON_BASE_ROWS, ICON_BASE_X0, ICON_BASE_X1,
	BODY, maxBodyD, maxPillarH,
} from './icon.mjs'
import { terminalSize } from './player.mjs'
import { generateTerrain, resizeTerrain } from './terrain.mjs'

/** @typedef {ReturnType<typeof createAnimState>} AnimState */
/** @typedef {ReturnType<typeof createWorld>} FluidWorld */
/** @typedef {{ softBase?: boolean, softPillars?: boolean, softBody?: boolean }} SoftOpts */
/** @typedef {import('./fluid/particles.mjs').ParticleView} ParticleView */

/** 视口外的世界边距。 */
const VIEW_MARGIN = 28
/** 视口下方的额外世界行数。 */
const BOTTOM_EXTRA = 6
/** 扩张后新暴露地形应用的土壤沉降 tick 数。 */
export const RESIZE_WEATHER_TICKS = 12
/** 地表径流搜索偏移（近 → 远）。 */
const GROUND_DX = [0, -1, 1, -2, 2, -3, 3, -4, 4]

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

/** 底座板列跨度。 */
const BASE_WIDTH = ICON_BASE_X1 - ICON_BASE_X0

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
 * @returns {{ iconOx: number, iconOy: number, terrain: import('./terrain.mjs').TerrainData }} 放置结果
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
 * 围绕图标调整尺寸，保留既有地形/动力学，仅为新暴露区域生成地形。
 * 新土壤初始为雨饱和并短暂沉降。
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
			const moist = old.moisture[oi]
			const cond = old.condense[oi]
			if (amt < 0.05 && moist < 0.02 && cond < 0.02) continue
			const nx = (x + shiftX) | 0
			const ny = (y + shiftY) | 0
			if (!inWorld(newWorld, nx, ny)) continue
			if (amt >= 0.05 && !terrain.solid[ny * newWorld.worldW + nx])
				addLiquid(newWorld, nx, ny, amt)
			if ((moist > 0.02 || cond > 0.02) && terrain.solid[ny * newWorld.worldW + nx]) {
				const ni = idx(newWorld, nx, ny)
				newWorld.moisture[ni] = Math.min(SOIL_CAP, newWorld.moisture[ni] + moist)
				newWorld.condense[ni] += cond
			}
		}

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
		newWorld.moisture[i] = SOIL_CAP
		hasAddedSoil = true
	}
	if (hasAddedSoil)
		for (let tick = 0; tick < RESIZE_WEATHER_TICKS; tick++) {
			labelAirRegions(newWorld)
			stepLiquid(newWorld)
		}
	return state
}

/**
 * 在地表格打 HORIZON，地形填充其余为 SOLID。
 * @param {AnimState} state 动画状态
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
 * @param {AnimState} state 动画状态
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
 * 在 [bodyMinD, bodyReach] 范围内将体素格绘制为 BODY。
 * @param {AnimState} state 动画状态
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
 * @param {AnimState} state 动画状态
 * @returns {number} 打包的阶段键
 */
const matStageKey = (state) =>
	state.baseBot | (state.baseTop << 6) | ((state.bodyReach + 1) << 12) | (state.bodyMinD << 20) | (+state.softBase << 28)

/**
 * 打包阶段键变化时重建材质网格。
 * @param {AnimState} state 动画状态
 * @returns {void}
 */
const rebuildMaterials = (state) => {
	const key = matStageKey(state)
	if (state.matKey === key) return
	state.matKey = key
	clearMaterials(state.world)
	applyTerrain(state)
	if (state.baseBot > 0 || state.baseTop > 0) paintBaseMats(state)
	paintBodyMats(state)
	releaseNonSoilWater(state.world)
}

/**
 * 给定行下方下一层底座板世界 Y，无则 -1。
 * @param {AnimState} state 动画状态
 * @param {number} y 当前水池格的世界 Y
 * @returns {number} 下一水池行 Y，或 -1
 */
const nextPoolRow = (state, y) => {
	const local = y - state.iconOy
	for (const br of ICON_BASE_ROWS)
		if (br > local) return state.iconOy + br
	return -1
}

/**
 * 从溢出水池格排队 1–2 个飞溅液滴。
 * @param {FluidWorld} world 流体世界
 * @param {AnimState} state 动画状态
 * @param {number} x 世界 X
 * @param {number} y 世界 Y
 * @param {number} [targetY=-1] 向下飞溅的目标 Y
 * @returns {void}
 */
const overflowSplash = (world, state, x, y, targetY = -1) => {
	if (world.particles.count > 900) return
	const ny = targetY >= 0 ? targetY : nextPoolRow(state, y)
	const aimY = ny >= 0 ? ny : y + 2
	const n = hash01(x, state.frame) > 0.65 ? 2 : 1
	for (let i = 0; i < n; i++) {
		const splash = queueSplash(world,
			x + (hash01(x, i + 3) - 0.5) * 0.6,
			y + 0.6,
			(hash01(x + i, 5) - 0.5) * 0.35,
			0.45 + hash01(x, 8) * 0.35,
			14 + (hash01(x, 9) * 8 | 0),
		)
		if (splash >= 0 && aimY > y)
			world.pendingSplash.vy[splash] = Math.max(
				world.pendingSplash.vy[splash],
				Math.min(1.1, (aimY - y) * 0.2),
			)
	}
}

/**
 * 将游离液体沉积到 fromY 下方附近的地表列。
 * @param {FluidWorld} world 流体世界
 * @param {AnimState} state 动画状态
 * @param {number} x 源世界 X
 * @param {number} fromY 源世界 Y（仅在其下方沉积）
 * @param {number} amt 待放置量
 * @returns {number} 成功沉积量
 */
const depositOnGround = (world, state, x, fromY, amt) => {
	let left = amt
	for (const dx of GROUND_DX) {
		if (left < 0.02) break
		const gx = x + dx
		if (!inWorld(world, gx, 0)) continue
		const gy = state.terrain.surface[gx] - 1
		if (gy <= fromY || !inWorld(world, gx, gy)) continue
		const m = world.mat[idx(world, gx, gy)]
		if (isLiquidBarrier(m) || m === MAT.POOL) continue
		const got = addLiquid(world, gx, gy, left)
		if (got <= 0) continue
		left -= got
		if (hash01(gx, state.frame) > 0.4)
			queueSplash(world, gx + 0.2, gy - 0.1,
				(hash01(gx, 3) - 0.5) * 0.4,
				-0.12 - hash01(gx, 4) * 0.2,
				8)
	}
	return amt - left
}

/**
 * 排空水池格：飞溅、溢至下一层板或地表径流。
 * @param {FluidWorld} world 流体世界
 * @param {AnimState} state 动画状态
 * @param {number} x 世界 X
 * @param {number} y 世界 Y
 * @param {number} [force=0] 最小滴落量
 * @returns {void}
 */
const leakPool = (world, state, x, y, force = 0) => {
	const id = idx(world, x, y)
	const amt = world.liq[id]
	if (amt < 0.12 && force <= 0) return

	const ny = nextPoolRow(state, y)
	const drip = Math.min(amt, Math.max(force, amt * 0.35, 0.12))
	world.liq[id] -= drip
	overflowSplash(world, state, x, y, ny)

	if (ny >= 0) {
		addLiquid(world, x, ny, drip * 0.75)
		return
	}

	const rest = drip - depositOnGround(world, state, x, y, drip)
	if (rest < 0.05) return
	const side = hash01(x, state.frame) > 0.5 ? 1 : -1
	spawnParticle(world,
		x + side * (0.6 + hash01(x, 6) * 1.2),
		y + 0.4,
		side * (0.15 + hash01(x, 7) * 0.25),
		0.35 + hash01(x, 8) * 0.35,
		28,
		rest,
	)
}

/**
 * 粒子撞击处理：水池渗漏、体部飞溅、土壤吸收、斜坡。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 撞击格 X
 * @param {number} y 撞击格 Y
 * @param {number} m 撞击处材质
 * @param {ParticleView} particle 粒子视图
 * @param {boolean} wet 粒子是否带水质量
 * @param {AnimState} state 动画状态
 * @returns {void}
 */
const onParticleHit = (world, x, y, m, particle, wet, state) => {
	const { frame } = state

	if (m === MAT.POOL) {
		addLiquid(world, x, y, 0.15)
		if (hash01(x, frame) > 0.3)
			leakPool(world, state, x, y, 0.08)
		return
	}

	if (m === MAT.BODY) {
		const speed = Math.hypot(particle.vx, particle.vy) || 0.5
		queueSplash(world,
			x + (hash01(x, 1) - 0.5) * 0.5,
			y - 0.15,
			(hash01(x, frame) - 0.5) * speed * 0.85,
			-0.18 - hash01(x, 3) * 0.35,
			8 + (hash01(x, 4) * 6 | 0),
		)
		if (hash01(x, frame) > 0.45)
			queueSplash(world,
				x + (hash01(x, 5) - 0.5) * 0.4,
				y - 0.05,
				(hash01(x, 6) - 0.5) * speed * 0.5,
				-0.1 - hash01(x, 7) * 0.2,
				6,
			)
		return
	}

	if (m === MAT.HORIZON || m === MAT.SOLID) {
		const i = idx(world, x, y)
		const hit = 0.18
		const stored = addMoisture(world, x, y, hit * SOIL_HIT_ABSORB_FRAC * soilAbsorbFactor(world.moisture[i]))
		const rest = hit - stored
		if (rest > 0 && y > 0 && !isLiquidBarrier(world.mat[idx(world, x, y - 1)]))
			addLiquid(world, x, y - 1, rest)
		const wetSoil = world.moisture[i] > 0.15
		queueSplash(world, x, y - 0.25,
			(hash01(x, frame) - 0.5) * (wetSoil ? 0.45 : 0.3),
			-0.15 - hash01(x, 2) * (wetSoil ? 0.25 : 0.15),
			wetSoil ? 8 : 6,
		)
		return
	}

	if (m === MAT.SEAL) {
		const speed = Math.hypot(particle.vx, particle.vy) || 0.5
		queueSplash(world, x + (hash01(x, 1) - 0.5), y - 0.15,
			(hash01(x, frame) - 0.5) * speed,
			-0.2 - hash01(x, 3) * 0.3,
			10)
		return
	}

	if (m === MAT.SLOPE_R || m === MAT.SLOPE_L) {
		const side = m === MAT.SLOPE_R ? 1 : -1
		const speed = Math.hypot(particle.vx, particle.vy) || 0.6
		queueSplash(world, x + side * 0.4, y + 0.2, side * speed * 0.7, speed * 0.7, 14)
		if (hash01(x, frame) > 0.4)
			queueSplash(world, x + side * 0.2, y - 0.1, side * speed * 0.4, -speed * 0.2, 8)
		return
	}

	if (wet) {
		addLiquid(world, x, y, 0.2)
		const local = y - state.iconOy
		if (ICON_BASE_ROWS.some(br => Math.abs(br - local) <= 1))
			leakPool(world, state, x, y, 0.1)
	}
}

/**
 * 降雨活跃时，在逐渐变宽的中心带生成雨粒子。
 * @param {AnimState} state 动画状态
 * @returns {void}
 */
const spawnRain = (state) => {
	const { world, frame, rainUntil, width, height, seed } = state
	if (frame > rainUntil) return

	const unlock = Math.min(1, frame / Math.max(18, height * 0.55))
	const cols = Math.max(1, Math.floor(width * unlock))
	const x0 = world.ox + Math.floor((width - cols) / 2)
	const budget = Math.max(1, Math.floor(1 + unlock * 2.5))
	const skyWind = windProfileAt(0, world.worldH, frame, seed)

	for (let i = 0; i < budget; i++) {
		if (hash01(frame, i + 17) > 0.4 + unlock * 0.4) continue
		const lx = (hash01(frame * 3, i) * cols) | 0
		const x = x0 + lx + hash01(frame, i + 2) * 0.8
		const heavy = hash01(frame, i + 11) > 0.45
		spawnParticle(world, x, -hash01(frame, i + 9) * 1.5,
			skyWind * 0.55 + (hash01(frame, i) - 0.5) * 0.04,
			0.35 + hash01(x | 0, 1) * 0.4,
			70,
			heavy ? 0.55 + hash01(frame, i + 13) * 0.45 : 0.12 + hash01(frame, i + 13) * 0.32,
		)
	}
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
 * 显示一帧的软边标志，然后推进帧计数。
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
 * 拆解体 → 柱 → 底座，然后清空动力学。
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
