#!/usr/bin/env -S deno run -A
/**
 * fount fountain logo ASCII animation API.
 * Silhouette packed like imgs/icon.js; colors match icon_ansi_ascii (@=30, ::=96).
 *
 * Materials:
 *   body `@`  — liquid   |  `:` — solid jet
 *   base `@`  — pool     |  `>`/`<` — 45° splash faces
 *   `¯`       — absorbing horizon (terrain top)
 *
 * createAnimState({ width?, height?, seed? }) — defaults to terminal size when available.
 * API: { enter, hold, exit, fps, createAnimState }
 * Main: enter → loop hold → Ctrl+C → exit from current progress
 */

import process from 'node:process'

import { on_shutdown } from 'npm:on-shutdown'

import { AsciiAnimePlayer, terminalSize } from './ascii_anime_player.mjs'
import {
	MAT, createWorld, clearMaterials, clearDynamics, setMat, addLiquid,
	spawnParticle, queueSplash, stepLiquid, stepParticles, rainChar,
	hash01, idx, inWorld, LIQUID_DRAW_THRESHOLD,
} from './ascii_fluid_engine.mjs'

/** @typedef {ReturnType<typeof createAnimState>} AnimState */
/** @typedef {ReturnType<typeof createWorld>} FluidWorld */
/** @typedef {{ softBase?: boolean, softPillars?: boolean, softBody?: boolean }} SoftOpts */
/** @typedef {{ ch: string, fg: string } | null} Cell */

const RESET = '\x1b[0m'
const FG_AT = '\x1b[30m'
const FG_COL = '\x1b[96m'
const FG_SPLASH = '\x1b[36m'
const FG_HORIZON = '\x1b[90m'

/** Icon-local layout (pre-center). */
const ICON_BASE_ROWS = [16, 18, 20, 22]
const ICON_BASE_X0 = 5
const ICON_BASE_X1 = 37
const BASE_WIDTH = ICON_BASE_X1 - ICON_BASE_X0
const ICON_H = 23 // rows 0..22
const ICON_W = 40

/** Three :: pillars: [x, yTop, yBot] in icon-local space */
const PILLARS = [
	[16, 2, 15],
	[20, 0, 15],
	[24, 2, 15],
]

/** Same packing as icon.js → 20 content rows (body 0–15, base slabs 16–19). */
const ICON = (() => {
	let f, o, u, n, t = ''
	for (f of [9 ** 8 - 1, 109, 513835, 2077, 133, 25])
		for (o = '', n = 21; u = ' :'[0 | f % 3] || '@', n; f /= 3)
			t = `${o = u + o + u}\n`.repeat(!--n * 6939 / f % 9.4) + t
	return t.trimEnd().split('\n')
})()

const BODY_ATS = (() => {
	const tips = PILLARS.flatMap(([x, yTop]) => [[x, yTop], [x + 1, yTop]])
	/**
	 * Manhattan 距离到最近柱尖。
	 * @param {number} x 列
	 * @param {number} y 行
	 * @returns {number} 距离
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
 * 柱高（含两端）。
 * @param {number} yTop 顶行
 * @param {number} yBot 底行
 * @returns {number} 高度
 */
const pillarHeight = (yTop, yBot) => yBot - yTop + 1
const maxPillarH = Math.max(...PILLARS.map(([, yTop, yBot]) => pillarHeight(yTop, yBot)))

const splashChars = [',', '.']

/**
 * 默认画布尺寸（优先终端，否则回退）。
 * @returns {{ width: number, height: number }} 宽高
 */
const defaultSize = () => {
	const { columns, rows } = terminalSize()
	return {
		width: Math.max(ICON_W, columns || 40),
		height: Math.max(ICON_H + 1, (rows || 25) - 1),
	}
}

/**
 * 创建共享动画状态（enter → hold → exit）。
 * @param {{ width?: number, height?: number, seed?: number }} [opts] 画布与地形种子
 * @returns {object} 动画状态
 */
export const createAnimState = (opts = {}) => {
	const { width: dw, height: dh } = defaultSize()
	const width = opts.width ?? dw
	const height = opts.height ?? dh
	const seed = opts.seed ?? (Math.random() * 1e9 | 0)
	const world = createWorld({ width, height, margin: 28, bottomExtra: 6 })
	const iconOx = world.ox + Math.floor((width - ICON_W) / 2)
	const iconOy = Math.floor((height - ICON_H) / 2)
	const terrain = generateTerrain(world, { iconOx, iconOy, seed })
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
 * 全宽地形：起伏地表 + 可越出视口的洞穴；图标基座带留空。
 * @param {FluidWorld} world 流体世界
 * @param {{ iconOx: number, iconOy: number, seed: number }} opts 图标原点与种子
 * @returns {{ surface: Int16Array, solid: Uint8Array[], footX0: number, footX1: number, viewW: number, ox: number }} 地形数据
 */
function generateTerrain(world, { iconOx, iconOy, seed }) {
	const { worldW: W, worldH: H, viewW, ox } = world
	const surface = new Int16Array(W)
	const baseY = Math.min(H - 3, iconOy + ICON_BASE_ROWS[ICON_BASE_ROWS.length - 1])

	for (let x = 0; x < W; x++) {
		const n1 = hash01(x + seed, 1)
		const n2 = hash01(x + seed * 3, 7)
		const n3 = hash01((x >> 2) + seed, 11)
		const undulation = Math.floor((n1 - 0.5) * 5 + (n2 - 0.5) * 2)
		let y = baseY + undulation
		if (n3 > 0.82) y += 2 + (hash01(x, seed) * 3 | 0)
		if (n3 < 0.12) y -= 1 + (hash01(x, seed + 4) * 2 | 0)
		surface[x] = Math.max(iconOy + 14, Math.min(H - 2, y))
	}

	for (let pass = 0; pass < 2; pass++)
		for (let x = 1; x < W - 1; x++)
			surface[x] = Math.round((surface[x - 1] + surface[x] + surface[x + 1]) / 3)

	const solid = Array.from({ length: H }, () => new Uint8Array(W))
	for (let x = 0; x < W; x++)
		for (let y = surface[x]; y < H; y++)
			solid[y][x] = 1

	const worms = 6 + (hash01(seed, 99) * 5 | 0)
	for (let w = 0; w < worms; w++) {
		let cx = hash01(seed, w * 3) * W
		let cy = surface[Math.min(W - 1, cx | 0)] + 1 + hash01(seed, w * 5) * (H - surface[Math.min(W - 1, cx | 0)] - 2)
		const len = 20 + (hash01(seed, w * 7) * 50 | 0)
		for (let s = 0; s < len; s++) {
			const r = 1 + (hash01(seed + s, w) > 0.7 ? 1 : 0)
			for (let dy = -r; dy <= r; dy++)
				for (let dx = -r; dx <= r; dx++) {
					const x = (cx + dx) | 0
					const y = (cy + dy) | 0
					if (x >= 0 && x < W && y >= 0 && y < H && y > surface[x])
						solid[y][x] = 0
				}
			cx += (hash01(seed + s, w + 1) - 0.5) * 2.4
			cy += (hash01(seed + s, w + 2) - 0.45) * 1.6
			cx = Math.max(-8, Math.min(W + 7, cx))
			cy = Math.max(0, Math.min(H - 1, cy))
		}
	}

	const footX0 = iconOx + ICON_BASE_X0
	const footX1 = iconOx + ICON_BASE_X1
	const baseYs = new Set(ICON_BASE_ROWS.map(y => iconOy + y))
	for (let x = footX0; x < footX1; x++) {
		if (x < 0 || x >= W) continue
		for (let y = iconOy + ICON_BASE_ROWS[0]; y < H; y++) {
			if (baseYs.has(y)) continue
			const gap = ICON_BASE_ROWS.some(br => y === iconOy + br + 1)
			if (gap && y < iconOy + ICON_BASE_ROWS[ICON_BASE_ROWS.length - 1]) {
				solid[y][x] = 0
				continue
			}
			if (y >= iconOy + ICON_BASE_ROWS[ICON_BASE_ROWS.length - 1])
				solid[y][x] = 1
		}
		surface[x] = Math.min(surface[x], iconOy + ICON_BASE_ROWS[ICON_BASE_ROWS.length - 1])
	}

	return { surface, solid, footX0, footX1, viewW, ox }
}

/**
 * 将地形写入材质格。
 * @param {AnimState} state 动画状态
 * @returns {void}
 */
const applyTerrain = (state) => {
	const { world, terrain, iconOx, iconOy } = state
	const { worldW: W, worldH: H } = world
	const { surface, solid, footX0, footX1 } = terrain
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			if (!solid[y][x]) continue
			const underIcon = x >= footX0 && x < footX1 && y >= iconOy + ICON_BASE_ROWS[0]
			if (underIcon) {
				if (ICON_BASE_ROWS.includes(y - iconOy)) continue
				if (y > iconOy + ICON_BASE_ROWS[ICON_BASE_ROWS.length - 1])
					setMat(world, x, y, MAT.SOLID)
				continue
			}
			if (y === surface[x])
				setMat(world, x, y, MAT.HORIZON, 3 + hash01(x, 2) * 4)
			else if (y > surface[x])
				setMat(world, x, y, MAT.SOLID)
		}

	void iconOx
}

/**
 * 按 wipe 进度绘制基座材质（池 / 斜面）。
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
 * 按生长高度绘制柱材质（固体喷柱）。
 * @param {AnimState} state 动画状态
 * @returns {void}
 */
const paintPillarMats = (state) => {
	const { world, iconOx, iconOy, pillars, softPillars } = state
	for (const [lx, yTop, yBot] of PILLARS) {
		const h = pillarHeight(yTop, yBot)
		const g = Math.min(pillars, h)
		for (let k = 0; k < g; k++) {
			const y = iconOy + yBot - k
			const tip = softPillars && k === g - 1 && g < h
			const x = iconOx + lx
			setMat(world, x, y, MAT.SOLID)
			setMat(world, x + 1, y, MAT.SOLID)
			void tip
		}
	}
}

/**
 * 按距离扩张绘制 body 液体材质。
 * @param {AnimState} state 动画状态
 * @returns {void}
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
 * 重建本帧全部静态材质。
 * @param {AnimState} state 动画状态
 * @returns {void}
 */
const rebuildMaterials = (state) => {
	clearMaterials(state.world)
	applyTerrain(state)
	if (state.baseBot > 0 || state.baseTop > 0) paintBaseMats(state)
	if (state.pillars > 0) paintPillarMats(state)
	paintBodyMats(state)
}

/**
 * 下一层水池行（世界 y），没有则 -1。
 * @param {AnimState} state 动画状态
 * @param {number} y 当前世界行
 * @returns {number} 下一水池行或 -1
 */
const nextPoolRow = (state, y) => {
	const local = y - state.iconOy
	for (const br of ICON_BASE_ROWS)
		if (br > local) return state.iconOy + br

	return -1
}

/**
 * 水池溢流：向下层生成溅落粒子。
 * @param {FluidWorld} world 流体世界
 * @param {AnimState} state 动画状态
 * @param {number} x 列
 * @param {number} y 行
 * @returns {void}
 */
const overflowSplash = (world, state, x, y) => {
	if (world.particles.length > 900) return
	const ny = nextPoolRow(state, y)
	const targetY = ny >= 0 ? ny : y + 2
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
		if (last && targetY > y)
			last.vy = Math.max(last.vy, Math.min(1.1, (targetY - y) * 0.2))
	}
}

/**
 * 粒子碰撞回调工厂（按材质溅射 / 吸收 / 溢流）。
 * @param {AnimState} state 动画状态
 * @returns {(world: FluidWorld, x: number, y: number, m: number, p: { vx: number, vy: number }, wet: boolean) => void} onHit
 */
const onParticleHit = (state) => (world, x, y, m, p, wet) => {
	const { frame } = state

	if (m === MAT.POOL) {
		addLiquid(world, x, y, 0.15)
		if (hash01(x, frame) > 0.35)
			overflowSplash(world, state, x, y)
		return
	}

	if (m === MAT.BODY) {
		addLiquid(world, x, y, 0.12)
		if (hash01(x, frame) > 0.7)
			queueSplash(world, x, y - 0.2, (hash01(x, 1) - 0.5) * 0.4, -0.25, 10)
		return
	}

	if (m === MAT.HORIZON) {
		const i = idx(world, x, y)
		if (world.absorb[i] > 0) {
			world.absorb[i] -= 0.35
			queueSplash(world, x, y - 0.3,
				(hash01(x, frame) - 0.5) * 0.5,
				-0.2 - hash01(x, 2) * 0.25,
				8)
		}
		else
			queueSplash(world, x, y - 0.2, (hash01(x, 4) - 0.5) * 0.3, -0.15, 6)
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

	if (m === MAT.SOLID) {
		const speed = Math.hypot(p.vx, p.vy) || 0.5
		queueSplash(world, x + (hash01(x, 1) - 0.5), y - 0.15,
			(hash01(x, frame) - 0.5) * speed,
			-0.2 - hash01(x, 3) * 0.3,
			10)
		return
	}

	if (wet) {
		addLiquid(world, x, y, 0.2)
		const local = y - state.iconOy
		if (ICON_BASE_ROWS.some(br => Math.abs(br - local) <= 1))
			overflowSplash(world, state, x, y)
	}
}

/**
 * 渐进降雨：列随时间解锁，从画布顶生成。
 * @param {AnimState} state 动画状态
 * @returns {void}
 */
const spawnRain = (state) => {
	const { world, frame, rainUntil, width, height } = state
	if (frame > rainUntil) return

	const unlock = Math.min(1, frame / Math.max(18, height * 0.55))
	const cols = Math.max(1, Math.floor(width * unlock))
	const x0 = world.ox + Math.floor((width - cols) / 2)
	const budget = Math.max(1, Math.floor(1 + unlock * 2.5))

	for (let i = 0; i < budget; i++) {
		if (hash01(frame, i + 17) > 0.4 + unlock * 0.4) continue
		const lx = (hash01(frame * 3, i) * cols) | 0
		const x = x0 + lx + hash01(frame, i + 2) * 0.8
		const vy = 0.35 + hash01(x | 0, 1) * 0.4
		spawnParticle(world, x, -hash01(frame, i + 9) * 1.5, (hash01(frame, i) - 0.5) * 0.04, vy, 70)
	}
}

/**
 * 合成一帧 ANSI 字符串。
 * @param {AnimState} state 动画状态
 * @returns {string} 帧文本
 */
const composeFrame = (state) => {
	const { world, width, height, iconOx, iconOy, softPillars, softBody, bodyReach, bodyMinD, pillars, frame } = state
	const { ox, mat, liq, particles } = world
	const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => /** @type {Cell} */ null))

	/**
	 * 写入视口格。
	 * @param {number} vx 视口列
	 * @param {number} vy 视口行
	 * @param {string} ch 字符
	 * @param {string} fg ANSI 前景
	 * @returns {void}
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

	for (let vy = 0; vy < height; vy++)
		for (let vx = 0; vx < width; vx++) {
			const i = idx(world, ox + vx, vy)
			const m = mat[i]
			if (m === MAT.HORIZON) paint(vx, vy, '¯', FG_HORIZON)
			else if (m === MAT.POOL) paint(vx, vy, '@', FG_AT)
			else if (m === MAT.SLOPE_R) paint(vx, vy, '>', FG_AT)
			else if (m === MAT.SLOPE_L) paint(vx, vy, '<', FG_AT)
			else if (m === MAT.BODY) {
				const lx = ox + vx - iconOx
				const ly = vy - iconOy
				paint(vx, vy, bodyEdge.has(`${lx},${ly}`) ? '.' : '@', FG_AT)
			}
			else if (liq[i] >= LIQUID_DRAW_THRESHOLD) {
				const y = vy
				const x = ox + vx
				const inFoot = x >= state.terrain.footX0 && x < state.terrain.footX1
				const aboveBase = y < iconOy + ICON_BASE_ROWS[0]
				if (inFoot && aboveBase) continue
				paint(vx, vy, splashChars[(x + y + frame) & 1], FG_SPLASH)
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
		const ch = p.vy < 0 ? splashChars[(frame + vx) & 1] : rainChar(p.y, p.vy > 0.85)
		paint(vx, vy, ch, FG_SPLASH)
	}

	return renderGrid(grid, width, height)
}

/**
 * 将格子渲染为 ANSI 文本。
 * @param {Cell[][]} grid 视口格子
 * @param {number} width 宽
 * @param {number} height 高
 * @returns {string} 帧文本
 */
const renderGrid = (grid, width, height) => {
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
		out.push(line.replace(/\s+$/, ''))
	}
	while (out.length && out[out.length - 1] === '') out.pop()
	return out.join('\n')
}

/**
 * 模拟并渲染一帧。
 * @param {AnimState} state 动画状态
 * @returns {string} 帧文本
 */
const simFrame = (state) => {
	rebuildMaterials(state)
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
			if (world.liq[id] >= 0.7 && hash01(x, state.frame) > 0.5) {
				overflowSplash(world, state, x, y)
				world.liq[id] *= 0.55
			}
		}
	}
	return composeFrame(state)
}

/**
 * 产出一帧并推进 frame 计数。
 * @param {AnimState} state 动画状态
 * @param {SoftOpts} [soft] 软边绘制开关
 * @yields {string} 帧文本
 * @returns {Generator<string, void, unknown>} 帧生成器
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
 * Stage 1 — 基座 wipe → 柱生长 → body 从柱尖扩张；雨从上方渐进出现。
 * @param {AnimState} [state] 共享状态
 * @yields {string} 帧文本
 * @returns {Generator<string, void, unknown>} 帧生成器
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
 * Stage 2 — 完整图标 + 持续雨与流体（无限）。
 * @param {AnimState} [state] 共享状态
 * @yields {string} 帧文本
 * @returns {Generator<string, void, unknown>} 帧生成器
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
 * Stage 3 — 自当前进度倒放；停雨后抽干粒子/液体。
 * @param {AnimState} [state] 共享状态
 * @yields {string} 帧文本
 * @returns {Generator<string, void, unknown>} 帧生成器
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
		for (let n = from; n >= 0; n--) {
			state.baseBot = state.baseTop = n
			yield* show(state, { softBase: n > 0 && n < BASE_WIDTH })
		}
	}

	for (let i = 0; i < 90; i++) {
		if (!state.world.particles.length && state.world.liq.every(v => v < 0.05)) break
		for (let j = 0; j < state.world.liq.length; j++) state.world.liq[j] *= 0.92
		yield* show(state)
	}

	clearDynamics(state.world)
	yield renderGrid(
		Array.from({ length: state.height }, () => Array.from({ length: state.width }, () => /** @type {Cell} */ null)),
		state.width,
		state.height,
	)
}

/** 目标帧率。 */
export const fps = 24

/** 对外帧生产者集合。 */
export const iconAnim = { enter, hold, exit, fps, createAnimState }

if (import.meta.main) {
	const state = createAnimState()
	const player = new AsciiAnimePlayer({ fps })

	on_shutdown(async () => {
		player.abort()
		await player.play(() => exit(state), { signal: null })
		player.stop()
	})

	player.start()

	await player.play(() => enter(state)).loop(() => hold(state))
	process.exit(0)
}
