#!/usr/bin/env -S deno run -A
/**
 * fount fountain logo ASCII animation API.
 * Silhouette packed like imgs/icon.js; colors match icon_ansi_ascii (@=30, ::=96).
 *
 * Materials (see AGENTS.md for full table):
 *   body `@`  — impact shell (splash then vanish)
 *   `:`       — visual jet only (does not block fluid)
 *   base `@`  — pool that leaks downward | `>`/`<` — 45° splash
 *   terrain   — soil (`HORIZON` / `SOLID`) stores moisture; ceilings condense & drip
 *   `/ \ | - _` outline (Terraria-style)
 *
 * createAnimState({ width?, height?, seed? }) — defaults to terminal size when available.
 * API: { enter, hold, exit, fps, createAnimState, resizeAnimState }
 * Main: enter → loop hold → Ctrl+C → exit from current progress (ends when icon gone)
 */

import process from 'node:process'

import { on_shutdown } from 'npm:on-shutdown'

import {
	MAT, createWorld, clearMaterials, clearDynamics, setMat, addLiquid, addMoisture,
	spawnParticle, queueSplash, stepGas, stepLiquid, stepParticles, fallChar, liquidChar, dripChar,
	windProfileAt, hash01, idx, inWorld, isLiquidBarrier, isSoilMat, releaseNonSoilWater,
	soilAbsorbFactor, LIQUID_DRAW_THRESHOLD, COND_DRAW_THRESHOLD, SOIL_CAP, SOIL_HIT_ABSORB_FRAC,
} from './fluid_engine.mjs'
import { AsciiAnimePlayer, terminalSize } from './player.mjs'
import { generateTerrain, outlineChar } from './terrain.mjs'

/** @typedef {ReturnType<typeof createAnimState>} AnimState */
/** @typedef {ReturnType<typeof createWorld>} FluidWorld */
/** @typedef {{ softBase?: boolean, softPillars?: boolean, softBody?: boolean }} SoftOpts */
/** @typedef {{ ch: string, fg: string } | null} Cell */

const RESET = '\x1b[0m'
const FG_AT = '\x1b[30m'
const FG_COL = '\x1b[96m'
const FG_SPLASH = '\x1b[36m'
const FG_TERRAIN = '\x1b[90m'

/** Icon-local layout (pre-center). Extra base rows 20/22 are animation-only. */
const ICON_BASE_ROWS = [16, 18, 20, 22]
const ICON_BASE_X0 = 5
const ICON_BASE_X1 = 37
const BASE_WIDTH = ICON_BASE_X1 - ICON_BASE_X0

/** Same packing as icon.js → 20 content rows (body 0–15, base slabs 16–19). */
const ICON = (() => {
	let f, o, u, n, t = ''
	for (f of [9 ** 8 - 1, 109, 513835, 2077, 133, 25])
		for (o = '', n = 21; u = ' :'[0 | f % 3] || '@', n; f /= 3)
			t = `${o = u + o + u}\n`.repeat(!--n * 6939 / f % 9.4) + t
	return t.trimEnd().split('\n')
})()

const ICON_PACK_H = ICON.length
const ICON_W = Math.max(...ICON.map(line => line.length))
const ICON_H = ICON_BASE_ROWS[ICON_BASE_ROWS.length - 1] + 1 // rows 0..22

/** Three :: pillars: [x, yTop, yBot] in icon-local space */
const PILLARS = [
	[16, 2, 15],
	[20, 0, 15],
	[24, 2, 15],
]

const BODY_ATS = (() => {
	const tips = PILLARS.flatMap(([x, yTop]) => [[x, yTop], [x + 1, yTop]])
	/**
	 * @param {number} x parameter
	 * @param {number} y parameter
	 * @returns {number} result
	 */
	const dist = (x, y) => Math.min(...tips.map(([tx, ty]) => Math.abs(x - tx) + Math.abs(y - ty)))
	const cells = []
	for (let y = 0; y < 16; y++) {
		const line = ICON[y]
		for (let x = 0; x < line.length; x++)
			if (line[x] === '@') cells.push({ x, y, d: dist(x, y) })
	}
	return cells.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x)
})()

const maxBodyD = BODY_ATS[BODY_ATS.length - 1].d

/**
 * @param {number} yTop parameter
 * @param {number} yBot parameter
 * @returns {number} result
 */
const pillarHeight = (yTop, yBot) => yBot - yTop + 1
const maxPillarH = Math.max(...PILLARS.map(([, yTop, yBot]) => pillarHeight(yTop, yBot)))

/**
 * @returns {{ width: number, height: number }} result
 */
const defaultSize = () => {
	const { columns, rows } = terminalSize()
	return {
		width: Math.max(ICON_W, columns || ICON_W),
		height: Math.max(ICON_H + 1, (rows || 25) - 1),
	}
}

/**
 * Create shared animation state (enter → hold → exit).
 * @param {{ width?: number, height?: number, seed?: number }} [opts] parameter
 * @returns {object} result
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
		iconBaseX1: ICON_BASE_X1,
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
	}
}

/**
 * Rebuild world/terrain for a new terminal size while preserving stage progress.
 * @param {AnimState} state parameter
 * @param {{ width: number, height: number }} size parameter
 * @returns {AnimState} result
 */
export const resizeAnimState = (state, { width, height }) => {
	width = Math.max(ICON_W, width)
	height = Math.max(ICON_H + 1, height)
	if (width === state.width && height === state.height) return state

	const old = state.world
	const oldCx = old.ox + state.width / 2
	const oldCy = state.height / 2

	const world = createWorld({ width, height, margin: 28, bottomExtra: 6 })
	const iconOx = world.ox + Math.floor((width - ICON_W) / 2)
	const iconOy = Math.floor((height - ICON_H) / 2)
	const terrain = generateTerrain(world, {
		iconOx, iconOy, seed: state.seed,
		iconBaseRows: ICON_BASE_ROWS,
		iconBaseX0: ICON_BASE_X0,
		iconBaseX1: ICON_BASE_X1,
	})

	const newCx = world.ox + width / 2
	const newCy = height / 2
	const dx = newCx - oldCx
	const dy = newCy - oldCy

	// reproject free liquid + soil water relative to viewport centre
	for (let y = 0; y < old.worldH; y++)
		for (let x = 0; x < old.worldW; x++) {
			const oi = y * old.worldW + x
			const nx = (x + dx) | 0
			const ny = (y + dy) | 0
			if (!inWorld(world, nx, ny)) continue
			const amt = old.liq[oi]
			if (amt >= 0.05 && !terrain.solid[ny]?.[nx])
				addLiquid(world, nx, ny, amt)
			const moist = old.moisture[oi]
			const cond = old.condense[oi]
			if ((moist > 0.02 || cond > 0.02) && terrain.solid[ny]?.[nx]) {
				const ni = idx(world, nx, ny)
				world.moisture[ni] = Math.min(SOIL_CAP, world.moisture[ni] + moist)
				world.condense[ni] += cond
			}
		}

	for (const p of old.particles) {
		const nx = p.x + dx
		const ny = p.y + dy
		if (nx < -2 || nx >= world.worldW + 2) continue
		spawnParticle(world, nx, ny, p.vx, p.vy, p.life, p.amt)
	}

	state.width = width
	state.height = height
	state.world = world
	state.iconOx = iconOx
	state.iconOy = iconOy
	state.terrain = terrain
	return state
}

/**
 * Write terrain materials into the world grid.
 * Pedestal columns keep horizon/solid until POOL/SLOPE overwrite them —
 * ungrown base cells still read as land joining the shoulders.
 * @param {AnimState} state parameter
 * @returns {void} result
 */
const applyTerrain = (state) => {
	const { world, terrain } = state
	const { worldW: W, worldH: H } = world
	const { surface, solid } = terrain
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			if (!solid[y][x]) continue
			if (y === surface[x])
				setMat(world, x, y, MAT.HORIZON)
			else if (y > surface[x])
				setMat(world, x, y, MAT.SOLID)
		}
}

/**
 * @param {AnimState} state parameter
 * @returns {void} result
 */
const paintBaseMats = (state) => {
	const { world, iconOx, iconOy, baseBot, baseTop, softBase } = state
	for (const ly of ICON_BASE_ROWS) {
		const y = iconOy + ly
		const fromLeft = ly === 20 || ly === 22
		const n = fromLeft ? baseBot : baseTop
		for (let i = 0; i < BASE_WIDTH; i++) {
			const x = iconOx + ICON_BASE_X0 + i
			const on = fromLeft ? i < n : i >= BASE_WIDTH - n
			if (!on) continue
			const edge = softBase && (fromLeft ? i === n - 1 : i === BASE_WIDTH - n)
			if (edge && n < BASE_WIDTH)
				setMat(world, x, y, fromLeft ? MAT.SLOPE_R : MAT.SLOPE_L)
			else
				setMat(world, x, y, MAT.POOL)
		}
	}
}

/**
 * @param {AnimState} state parameter
 * @returns {void} result
 */
const paintBodyMats = (state) => {
	const { world, iconOx, iconOy, bodyReach, bodyMinD } = state
	if (bodyReach < 0) return
	for (const { x: lx, y: ly, d } of BODY_ATS) {
		if (d > bodyReach || d < bodyMinD) continue
		setMat(world, iconOx + lx, iconOy + ly, MAT.BODY)
	}
}

/**
 * Pillars (`:`) are compose-only — no material, so liquid and particles pass through.
 * @param {AnimState} state parameter
 * @returns {void} result
 */
const rebuildMaterials = (state) => {
	clearMaterials(state.world)
	applyTerrain(state)
	if (state.baseBot > 0 || state.baseTop > 0) paintBaseMats(state)
	paintBodyMats(state)
	releaseNonSoilWater(state.world)
}

/**
 * @param {AnimState} state parameter
 * @param {number} y parameter
 * @returns {number} result
 */
const nextPoolRow = (state, y) => {
	const local = y - state.iconOy
	for (const br of ICON_BASE_ROWS)
		if (br > local) return state.iconOy + br
	return -1
}

/**
 * Splash droplets aimed at the layer below a pool slab.
 * @param {FluidWorld} world parameter
 * @param {AnimState} state parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @param {number} [targetY] parameter
 * @returns {void} result
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
 * Deposit free liquid onto terrain surface near a column (ground runoff).
 * Prefers air cells just above HORIZON outside / beside pool slabs.
 * @param {FluidWorld} world parameter
 * @param {AnimState} state parameter
 * @param {number} x parameter
 * @param {number} fromY parameter
 * @param {number} amt parameter
 * @returns {number} amount deposited
 */
const depositOnGround = (world, state, x, fromY, amt) => {
	const { terrain } = state
	let left = amt
	const order = [0, -1, 1, -2, 2, -3, 3, -4, 4]
	for (const dx of order) {
		if (left < 0.02) break
		const gx = x + dx
		if (!inWorld(world, gx, 0)) continue
		const sy = terrain.surface[gx]
		if (sy == null) continue
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
 * Leak pool liquid to the next base slab (with splash) or onto the ground.
 * @param {FluidWorld} world parameter
 * @param {AnimState} state parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @param {number} [force=0] extra drip amount
 * @returns {void} result
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

	const deposited = depositOnGround(world, state, x, y, drip)
	const rest = drip - deposited
	if (rest < 0.05) return
	// leftover becomes outward falling droplets that can land on nearby horizon
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
 * @param {AnimState} state parameter
 * @returns {(world: FluidWorld, x: number, y: number, m: number, p: { vx: number, vy: number }, wet: boolean) => void} result
 */
const onParticleHit = (state) => (world, x, y, m, p, wet) => {
	const { frame } = state

	if (m === MAT.POOL) {
		addLiquid(world, x, y, 0.15)
		if (hash01(x, frame) > 0.3)
			leakPool(world, state, x, y, 0.08)
		return
	}

	if (m === MAT.BODY) {
		// Impact shell: splash, then the droplet vanishes (no merge / no flood).
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
		// Dry soil drinks a fraction of the droplet; most of a wet hit sheets as puddle.
		const want = hit * SOIL_HIT_ABSORB_FRAC * soilAbsorbFactor(world.moisture[i])
		const stored = addMoisture(world, x, y, want)
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
 * @param {AnimState} state parameter
 * @returns {void} result
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
		const vy = 0.35 + hash01(x | 0, 1) * 0.4
		const heavy = hash01(frame, i + 11) > 0.45
		const amt = heavy ? 0.55 + hash01(frame, i + 13) * 0.45 : 0.12 + hash01(frame, i + 13) * 0.32
		const vx = skyWind * 0.55 + (hash01(frame, i) - 0.5) * 0.04
		spawnParticle(world, x, -hash01(frame, i + 9) * 1.5, vx, vy, 70, amt)
	}
}

/**
 * @param {AnimState} state parameter
 * @returns {string} result
 */
const composeFrame = (state) => {
	const {
		world, width, height, iconOx, iconOy, softPillars, softBody,
		bodyReach, bodyMinD, pillars, frame, terrain,
	} = state
	const { ox, mat, liq, particles } = world
	const { solid, surface, surfaceChar } = terrain
	const { worldW: W, worldH: H } = world
	const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => /** @type {Cell} */ null))

	/**
	 * @param {number} vx parameter
	 * @param {number} vy parameter
	 * @param {string} ch parameter
	 * @param {string} fg parameter
	 * @returns {void} result
	 */
	const paint = (vx, vy, ch, fg) => {
		if (vy < 0 || vy >= height || vx < 0 || vx >= width) return
		grid[vy][vx] = { ch, fg }
	}

	const bodyEdge = new Set()
	if (bodyReach >= 0 && softBody)
		for (const { x: lx, y: ly, d } of BODY_ATS) {
			if (d > bodyReach || d < bodyMinD) continue
			if ((d === bodyReach && bodyReach < maxBodyD) || (bodyMinD > 0 && d === bodyMinD))
				bodyEdge.add(`${lx},${ly}`)
		}

	// Terrain: surface everywhere (pools overwrite later); caves under the pedestal may show.
	for (let vy = 0; vy < height; vy++)
		for (let vx = 0; vx < width; vx++) {
			const x = ox + vx
			const y = vy
			if (x < 0 || x >= W || y < 0 || y >= H) continue
			if (!solid[y][x]) continue

			if (y === surface[x]) {
				paint(vx, vy, surfaceChar[x] || '_', FG_TERRAIN)
				continue
			}
			const ch = outlineChar(solid, x, y, W, H, surface)
			if (ch) paint(vx, vy, ch, FG_TERRAIN)
		}

	for (let vy = 0; vy < height; vy++)
		for (let vx = 0; vx < width; vx++) {
			const i = idx(world, ox + vx, vy)
			const m = mat[i]
			if (m === MAT.POOL) paint(vx, vy, '@', FG_AT)
			else if (m === MAT.SLOPE_R) paint(vx, vy, '>', FG_AT)
			else if (m === MAT.SLOPE_L) paint(vx, vy, '<', FG_AT)
			else if (m === MAT.BODY) {
				const lx = ox + vx - iconOx
				const ly = vy - iconOy
				paint(vx, vy, bodyEdge.has(`${lx},${ly}`) ? '.' : '@', FG_AT)
			}
			else if (liq[i] >= LIQUID_DRAW_THRESHOLD) {
				const wx = ox + vx
				const by = vy + 1
				const falling = by >= H || (
					!isLiquidBarrier(mat[idx(world, wx, by)])
					&& mat[idx(world, wx, by)] !== MAT.POOL
					&& liq[idx(world, wx, by)] < LIQUID_DRAW_THRESHOLD
				)
				paint(vx, vy, liquidChar(
					liq[i], wx + vy + frame, falling,
					world.liqVx[i], world.liqVy[i],
				), FG_SPLASH)
			}
			else if (
				vy > 0
				&& isSoilMat(mat[idx(world, ox + vx, vy - 1)])
				&& world.condense[idx(world, ox + vx, vy - 1)] >= COND_DRAW_THRESHOLD
			) {
				const drip = world.condense[idx(world, ox + vx, vy - 1)]
				paint(vx, vy, dripChar(drip, ox + vx + frame), FG_SPLASH)
			}
		}

	if (pillars > 0)
		for (const [lx, yTop, yBot] of PILLARS) {
			const h = pillarHeight(yTop, yBot)
			const g = Math.min(pillars, h)
			for (let k = 0; k < g; k++) {
				const y = iconOy + yBot - k
				const tip = softPillars && k === g - 1 && g < h
				const vx = iconOx - ox + lx
				paint(vx, y, tip ? '.' : ':', tip ? FG_SPLASH : FG_COL)
				paint(vx + 1, y, tip ? '.' : ':', tip ? FG_SPLASH : FG_COL)
			}
		}

	for (const p of particles) {
		const vx = (p.x - ox) | 0
		const vy = p.y | 0
		if (vy < 0 || vy >= height || vx < 0 || vx >= width) continue
		paint(vx, vy, fallChar(p.amt, frame + vx, p.vx, p.vy), FG_SPLASH)
	}

	return renderGrid(grid, width, height)
}

/**
 * Fixed-size ANSI frame (no trailing trim — keeps resize stable).
 * @param {Cell[][]} grid parameter
 * @param {number} width parameter
 * @param {number} height parameter
 * @returns {string} result
 */
export const renderGrid = (grid, width, height) => {
	const out = []
	for (let y = 0; y < height; y++) {
		let line = ''
		let cur = null
		for (let x = 0; x < width; x++) {
			const cell = grid[y][x]
			if (!cell) {
				if (cur !== null) {
					line += RESET
					cur = null
				}
				line += ' '
				continue
			}
			if (cell.fg !== cur) {
				line += cell.fg
				cur = cell.fg
			}
			line += cell.ch
		}
		if (cur !== null) line += RESET
		out.push(line)
	}
	return out.join('\n')
}

/**
 * @param {AnimState} state parameter
 * @returns {string} result
 */
const simFrame = (state) => {
	rebuildMaterials(state)
	stepGas(state.world, { time: state.frame, seed: state.seed })
	spawnRain(state)
	stepParticles(state.world, onParticleHit(state))
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
 * @param {AnimState} state parameter
 * @param {SoftOpts} [soft] parameter
 * @yields {string}
 * @returns {Generator<string, void, unknown>} result
 */
function* show(state, soft = {}) {
	Object.assign(state, {
		softBase: !!soft.softBase,
		softPillars: !!soft.softPillars,
		softBody: !!soft.softBody,
	})
	yield simFrame(state)
	state.frame++
}

/**
 * Stage 1 — base wipe → pillars → body expand; rain fades in.
 * @param {AnimState} [state] parameter
 * @yields {string}
 * @returns {Generator<string, void, unknown>} result
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
 * Stage 2 — full icon + continuous rain/fluid.
 * @param {AnimState} [state] parameter
 * @yields {string}
 * @returns {Generator<string, void, unknown>} result
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
 * Stage 3 — reverse icon teardown; ends as soon as the icon is gone
 * (does not wait for rain/liquid drain).
 * @param {AnimState} [state] parameter
 * @yields {string}
 * @returns {Generator<string, void, unknown>} result
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
	yield renderGrid(
		Array.from({ length: state.height }, () => Array.from({ length: state.width }, () => /** @type {Cell} */ null)),
		state.width,
		state.height,
	)
}

/** Target frame rate. */
export const fps = 24

/** Public frame producers. */
export const iconAnim = { enter, hold, exit, fps, createAnimState, resizeAnimState }

/** Layout constants exported for tests. */
export const layout = { ICON_W, ICON_H, ICON_PACK_H, ICON_BASE_ROWS, BASE_WIDTH, maxBodyD, maxPillarH }

if (import.meta.main) {
	const state = createAnimState()
	/**
	 * Rebuild scene when the terminal is resized.
	 * @param {{ columns: number, rows: number }} size terminal size
	 * @returns {void}
	 */
	const handleResize = (size) => {
		if (!size.columns || !size.rows) return
		resizeAnimState(state, {
			width: Math.max(ICON_W, size.columns),
			height: Math.max(ICON_H + 1, size.rows - 1),
		})
	}
	const player = new AsciiAnimePlayer({ fps, onResize: handleResize })

	on_shutdown(async () => {
		player.abort()
		await player.play(() => exit(state), { signal: null })
		player.stop()
	})

	player.start()

	await player.play(() => enter(state)).loop(() => hold(state))
	process.exit(0)
}
