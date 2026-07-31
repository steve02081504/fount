/**
 * Animation scene: state, materials, rain, pool leak, stages.
 */

import { composeFrame, renderBuffers } from './compose.mjs'
import {
	MAT, createWorld, clearMaterials, clearDynamics, setMat, addLiquid, addMoisture,
	spawnParticle, queueSplash, stepGas, stepLiquid, stepParticles,
	windProfileAt, idx, inWorld, isLiquidBarrier, releaseNonSoilWater,
	soilAbsorbFactor, SOIL_CAP, SOIL_HIT_ABSORB_FRAC,
} from './fluid/index.mjs'
import { hash01 } from './hash.mjs'
import {
	ICON_W, ICON_H, ICON_BASE_ROWS, ICON_BASE_X0, BASE_WIDTH,
	bodyX, bodyY, bodyD, bodyCount, maxBodyD, maxPillarH,
} from './icon.mjs'
import { terminalSize } from './player.mjs'
import { generateTerrain } from './terrain.mjs'

/** @typedef {ReturnType<typeof createAnimState>} AnimState */
/** @typedef {ReturnType<typeof createWorld>} FluidWorld */
/** @typedef {{ softBase?: boolean, softPillars?: boolean, softBody?: boolean }} SoftOpts */
/** @typedef {import('./fluid/world.mjs').FluidParticle} FluidParticle */

/** Ground-runoff search offsets (near → far). */
const GROUND_DX = Object.freeze([0, -1, 1, -2, 2, -3, 3, -4, 4])

/**
 * Default view size from the terminal (falls back to icon bounds).
 * @returns {{ width: number, height: number }} view size
 */
const defaultSize = () => {
	const { columns, rows } = terminalSize()
	return {
		width: Math.max(ICON_W, columns || ICON_W),
		height: Math.max(ICON_H + 1, (rows || 25) - 1),
	}
}

/**
 * Create a fresh animation state with terrain and empty fluid world.
 * @param {{ width?: number, height?: number, seed?: number }} [opts] size and seed overrides
 * @returns {AnimState} new animation state
 */
export const createAnimState = (opts = {}) => {
	const { width: dw, height: dh } = defaultSize()
	const width = opts.width ?? dw
	const height = opts.height ?? dh
	const seed = opts.seed ?? (Math.random() * 1e9 | 0)
	const world = createWorld({ width, height, margin: 28, bottomExtra: 6 })
	const iconOx = world.ox + Math.floor((width - ICON_W) / 2)
	const iconOy = Math.floor((height - ICON_H) / 2)
	const terrain = generateTerrain(world, {
		iconOx, iconOy, seed,
		iconBaseRows: ICON_BASE_ROWS,
		iconBaseX0: ICON_BASE_X0,
		iconBaseX1: ICON_BASE_X0 + BASE_WIDTH,
	})
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
		matKey: 0,
		frameCh: null,
		frameFg: null,
	}
}

/**
 * Rebuild world/terrain for a new view size, reprojecting liquid/moisture/particles by centre shift.
 * @param {AnimState} state animation state
 * @param {{ width: number, height: number }} size new view size
 * @returns {AnimState} same state, resized in place
 */
export const resizeAnimState = (state, { width, height }) => {
	width = Math.max(ICON_W, width)
	height = Math.max(ICON_H + 1, height)
	if (width === state.width && height === state.height) return state

	const old = state.world
	const oldCx = old.ox + state.width / 2
	const oldCy = state.height / 2

	const newWorld = createWorld({ width, height, margin: 28, bottomExtra: 6 })
	const iconOx = newWorld.ox + Math.floor((width - ICON_W) / 2)
	const iconOy = Math.floor((height - ICON_H) / 2)
	const terrain = generateTerrain(newWorld, {
		iconOx, iconOy, seed: state.seed,
		iconBaseRows: ICON_BASE_ROWS,
		iconBaseX0: ICON_BASE_X0,
		iconBaseX1: ICON_BASE_X0 + BASE_WIDTH,
	})

	const shiftX = (newWorld.ox + width / 2) - oldCx
	const shiftY = (height / 2) - oldCy

	for (let y = 0; y < old.worldH; y++)
		for (let x = 0; x < old.worldW; x++) {
			const oi = y * old.worldW + x
			const nx = (x + shiftX) | 0
			const ny = (y + shiftY) | 0
			if (!inWorld(newWorld, nx, ny)) continue
			const amt = old.liq[oi]
			if (amt >= 0.05 && !terrain.solid[ny * newWorld.worldW + nx])
				addLiquid(newWorld, nx, ny, amt)
			const moist = old.moisture[oi]
			const cond = old.condense[oi]
			if ((moist > 0.02 || cond > 0.02) && terrain.solid[ny * newWorld.worldW + nx]) {
				const ni = idx(newWorld, nx, ny)
				newWorld.moisture[ni] = Math.min(SOIL_CAP, newWorld.moisture[ni] + moist)
				newWorld.condense[ni] += cond
			}
		}

	for (const p of old.particles) {
		const nx = p.x + shiftX
		const ny = p.y + shiftY
		if (nx < -2 || nx >= newWorld.worldW + 2) continue
		spawnParticle(newWorld, nx, ny, p.vx, p.vy, p.life, p.amt)
	}

	state.width = width
	state.height = height
	state.world = newWorld
	state.iconOx = iconOx
	state.iconOy = iconOy
	state.terrain = terrain
	state.matKey = 0
	state.frameCh = null
	state.frameFg = null
	return state
}

/**
 * Stamp HORIZON on surface cells and SOLID elsewhere in the terrain fill.
 * @param {AnimState} state animation state
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
 * Paint grown base slab columns as POOL (soft edges as SLOPE_*).
 * @param {AnimState} state animation state
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
 * Paint body cells within [bodyMinD, bodyReach] as BODY.
 * @param {AnimState} state animation state
 * @returns {void}
 */
const paintBodyMats = (state) => {
	const { world, iconOx, iconOy, bodyReach, bodyMinD } = state
	if (bodyReach < 0) return
	for (let i = 0; i < bodyCount; i++) {
		const d = bodyD[i]
		if (d > bodyReach || d < bodyMinD) continue
		setMat(world, iconOx + bodyX[i], iconOy + bodyY[i], MAT.BODY)
	}
}

/**
 * Pack stage fields into a single int for material rebuild skip.
 * @param {AnimState} s animation state
 * @returns {number} packed stage key
 */
const matStageKey = (s) =>
	s.baseBot | (s.baseTop << 6) | ((s.bodyReach + 1) << 12) | (s.bodyMinD << 20) | (+s.softBase << 28)

/**
 * Rebuild the material grid when the packed stage key changes.
 * @param {AnimState} state animation state
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
 * Next lower base-slab world Y below the given row, or -1 if none.
 * @param {AnimState} state animation state
 * @param {number} y world Y of the current pool cell
 * @returns {number} next pool row Y, or -1
 */
const nextPoolRow = (state, y) => {
	const local = y - state.iconOy
	for (const br of ICON_BASE_ROWS)
		if (br > local) return state.iconOy + br
	return -1
}

/**
 * Queue 1–2 splash droplets from an overflowing pool cell.
 * @param {FluidWorld} world fluid world
 * @param {AnimState} state animation state
 * @param {number} x world X
 * @param {number} y world Y
 * @param {number} [targetY=-1] aim Y for downward splash bias
 * @returns {void}
 */
const overflowSplash = (world, state, x, y, targetY = -1) => {
	if (world.particles.length > 900) return
	const ny = targetY >= 0 ? targetY : nextPoolRow(state, y)
	const aimY = ny >= 0 ? ny : y + 2
	const n = hash01(x, state.frame) > 0.65 ? 2 : 1
	for (let i = 0; i < n; i++) {
		queueSplash(world,
			x + (hash01(x, i + 3) - 0.5) * 0.6,
			y + 0.6,
			(hash01(x + i, 5) - 0.5) * 0.35,
			0.45 + hash01(x, 8) * 0.35,
			14 + (hash01(x, 9) * 8 | 0),
		)
		const last = world.pendingSplash[world.pendingSplash.length - 1]
		if (last && aimY > y)
			last.vy = Math.max(last.vy, Math.min(1.1, (aimY - y) * 0.2))
	}
}

/**
 * Deposit free liquid onto nearby ground columns below fromY.
 * @param {FluidWorld} world fluid world
 * @param {AnimState} state animation state
 * @param {number} x source world X
 * @param {number} fromY source world Y (deposit only below)
 * @param {number} amt amount to place
 * @returns {number} amount successfully deposited
 */
const depositOnGround = (world, state, x, fromY, amt) => {
	let left = amt
	for (const dx of GROUND_DX) {
		if (left < 0.02) break
		const gx = x + dx
		if (!inWorld(world, gx, 0)) continue
		const sy = state.terrain.surface[gx]
		const gy = sy - 1
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
 * Drain a pool cell: splash, spill to next slab or ground runoff.
 * @param {FluidWorld} world fluid world
 * @param {AnimState} state animation state
 * @param {number} x world X
 * @param {number} y world Y
 * @param {number} [force=0] minimum drip amount
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
 * Particle impact handler: pool leak, body splash, soil absorb, slopes.
 * @param {FluidWorld} world fluid world
 * @param {number} x hit cell X
 * @param {number} y hit cell Y
 * @param {number} m material at hit
 * @param {FluidParticle} p particle
 * @param {boolean} wet whether the particle carries water mass
 * @param {AnimState} state animation state
 * @returns {void}
 */
const onParticleHit = (world, x, y, m, p, wet, state) => {
	const { frame } = state

	if (m === MAT.POOL) {
		addLiquid(world, x, y, 0.15)
		if (hash01(x, frame) > 0.3)
			leakPool(world, state, x, y, 0.08)
		return
	}

	if (m === MAT.BODY) {
		const speed = Math.hypot(p.vx, p.vy) || 0.5
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
		const speed = Math.hypot(p.vx, p.vy) || 0.5
		queueSplash(world, x + (hash01(x, 1) - 0.5), y - 0.15,
			(hash01(x, frame) - 0.5) * speed,
			-0.2 - hash01(x, 3) * 0.3,
			10)
		return
	}

	if (m === MAT.SLOPE_R) {
		const speed = Math.hypot(p.vx, p.vy) || 0.6
		queueSplash(world, x + 0.4, y + 0.2, speed * 0.7, speed * 0.7, 14)
		if (hash01(x, frame) > 0.4)
			queueSplash(world, x + 0.2, y - 0.1, speed * 0.4, -speed * 0.2, 8)
		return
	}

	if (m === MAT.SLOPE_L) {
		const speed = Math.hypot(p.vx, p.vy) || 0.6
		queueSplash(world, x - 0.4, y + 0.2, -speed * 0.7, speed * 0.7, 14)
		if (hash01(x, frame) > 0.4)
			queueSplash(world, x - 0.2, y - 0.1, -speed * 0.4, -speed * 0.2, 8)
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
 * Spawn rain particles across a widening centre band while rain is active.
 * @param {AnimState} state animation state
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
 * Advance one simulation tick and compose an ANSI frame.
 * @param {AnimState} state animation state
 * @returns {string} ANSI frame
 */
const simFrame = (state) => {
	rebuildMaterials(state)
	stepGas(state.world, { time: state.frame, seed: state.seed })
	spawnRain(state)
	stepParticles(state.world, onParticleHit, state)
	stepLiquid(state.world)
	const { world, iconOx, iconOy } = state
	for (const ly of ICON_BASE_ROWS) {
		const y = iconOy + ly
		for (let i = 0; i < BASE_WIDTH; i++) {
			const x = iconOx + ICON_BASE_X0 + i
			if (!inWorld(world, x, y)) continue
			const id = idx(world, x, y)
			if (world.mat[id] !== MAT.POOL) continue
			if (world.liq[id] >= 0.35 && hash01(x, state.frame) > 0.35)
				leakPool(world, state, x, y)
		}
	}
	return composeFrame(state)
}

/**
 * Soft-edge flags for one shown frame, then advance frame counter.
 * @param {AnimState} state animation state
 * @param {SoftOpts} [soft] soft-edge options
 * @returns {Generator<string, void, unknown>} one ANSI frame
 */
function* show(state, soft = {}) {
	state.softBase = !!soft.softBase
	state.softPillars = !!soft.softPillars
	state.softBody = !!soft.softBody
	yield simFrame(state)
	state.frame++
}

/**
 * Grow base → pillars → body into a full icon.
 * @param {AnimState} [state] animation state
 * @returns {Generator<string, void, unknown>} enter frames
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
 * Hold the fully-grown icon under continuing rain.
 * @param {AnimState} [state] animation state
 * @returns {Generator<string, void, unknown>} hold frames
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
 * Tear down body → pillars → base, then clear dynamics.
 * @param {AnimState} [state] animation state
 * @returns {Generator<string, void, unknown>} exit frames
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
