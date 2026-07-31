#!/usr/bin/env -S deno run -A
/**
 * fount fountain logo ASCII animation API.
 * Silhouette packed like imgs/icon.js; colors match icon_ansi_ascii (@=30, ::=96).
 *
 * API: { enter, hold, exit, fps, createAnimState }
 * Main: enter → loop hold → Ctrl+C → exit from current progress
 */

import { on_shutdown } from 'npm:on-shutdown'

import { AsciiAnimePlayer } from './ascii_anime_player.mjs'

const RESET = '\x1b[0m'
const FG_AT = '\x1b[30m'
const FG_COL = '\x1b[96m'
const FG_SPLASH = '\x1b[36m'

const H = 24
const W = 40

const BASE_ROWS = [16, 18, 20, 22]
const BASE_X0 = 5
const BASE_X1 = 37
const BASE_WIDTH = BASE_X1 - BASE_X0

/** Three :: pillars: [x, yTop, yBot] */
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
	const dist = (x, y) => Math.min(...tips.map(([tx, ty]) => Math.abs(x - tx) + Math.abs(y - ty)))
	const cells = []
	for (let y = 0; y < 16; y++) {
		const line = ICON[y]
		for (let x = 0; x < line.length; x++) {
			if (line[x] === '@') cells.push({ x, y, d: dist(x, y) })
		}
	}
	return cells.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x)
})()

const maxBodyD = BODY_ATS[BODY_ATS.length - 1].d
const pillarHeight = (yTop, yBot) => yBot - yTop + 1
const maxPillarH = Math.max(...PILLARS.map(([, yTop, yBot]) => pillarHeight(yTop, yBot)))

const emptyGrid = () => Array.from({ length: H }, () => Array.from({ length: W }, () => null))

const paint = (grid, x, y, ch, fg) => {
	if (y < 0 || y >= H || x < 0 || x >= W) return
	grid[y][x] = { ch, fg }
}

const paintPair = (grid, x, y, pair, fg) => {
	paint(grid, x, y, pair[0], fg)
	paint(grid, x + 1, y, pair[1], fg)
}

const render = (grid) => {
	const out = []
	for (let y = 0; y < H; y++) {
		let line = ''
		let cur = null
		for (let x = 0; x < W; x++) {
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

/** Shared progress for enter → hold → exit-from-here. */
export const createAnimState = () => ({
	baseBot: 0,
	baseTop: 0,
	pillars: 0,
	/** -1 = body not started; else max d painted. */
	bodyReach: -1,
	/** Exit dissolve: hide cells with d < bodyMinD. */
	bodyMinD: 0,
	frame: 0,
	/** Infinity = keep spawning; else only cycles that started by this frame. */
	rainUntil: Infinity,
})

const paintBase = (grid, {
	bot = BASE_WIDTH,
	top = BASE_WIDTH,
	soft = true,
} = {}) => {
	for (const y of BASE_ROWS) {
		const fromLeft = y === 20 || y === 22
		const n = fromLeft ? bot : top
		const tip = fromLeft ? '>' : '<'
		for (let i = 0; i < BASE_WIDTH; i++) {
			const x = BASE_X0 + i
			const on = fromLeft ? i < n : i >= BASE_WIDTH - n
			if (!on) continue
			const edge = soft && (fromLeft ? i === n - 1 : i === BASE_WIDTH - n)
			paint(grid, x, y, edge && n < BASE_WIDTH ? tip : '@', FG_AT)
		}
	}
}

const paintPillars = (grid, {
	grown = maxPillarH,
	soft = true,
} = {}) => {
	for (const [x, yTop, yBot] of PILLARS) {
		const h = pillarHeight(yTop, yBot)
		const g = Math.min(grown, h)
		for (let k = 0; k < g; k++) {
			const y = yBot - k
			const tip = soft && k === g - 1 && g < h
			paintPair(grid, x, y, tip ? '..' : '::', tip ? FG_SPLASH : FG_COL)
		}
	}
}

const paintBody = (grid, {
	reach = maxBodyD,
	soft = true,
} = {}) => {
	for (const { x, y, d } of BODY_ATS) {
		if (d > reach) continue
		const edge = soft && d === reach && reach < maxBodyD
		paint(grid, x, y, edge ? '.' : '@', FG_AT)
	}
}

const paintBodyFrom = (grid, minD, soft = true, maxD = maxBodyD) => {
	for (const { x, y, d } of BODY_ATS) {
		if (d < minD || d > maxD) continue
		const edge = soft && d === minD
		paint(grid, x, y, edge ? '.' : '@', FG_AT)
	}
}

const splashChars = [',', '.']

/** Static 0..1 from ints — column-local phase, no horizontal traveling wave. */
const hash01 = (a, b = 0) => {
	let n = Math.imul(a ^ Math.imul(b, 1597334677), 3812015801)
	n ^= n >>> 13
	n = Math.imul(n, 1274126177)
	return ((n ^ n >>> 16) >>> 0) / 4294967296
}

/** Rain streams: each column falls top→bottom. */
const RAIN_STREAMS = (() => {
	const streams = []
	const add = (x, { y0 = 0, period, body = false }) => {
		streams.push({
			x, y0, body,
			vy: 0.48 + hash01(x, 1) * 0.35,
			phase: hash01(x, 3) * 40,
			period: period ?? (16 - y0),
		})
	}
	// free-fall: outer mist + wing gaps
	for (const x of [6, 7, 8, 12, 13, 28, 29, 33, 34, 35])
		add(x, { y0: 0, period: 16 })
	// wing @@@ — glints run down the silhouette
	for (const x of [9, 10, 11])
		add(x, { y0: 7, period: 9, body: true })
	for (const x of [30, 31, 32])
		add(x, { y0: 7, period: 9, body: true })
	// spray from each pillar tip into the open columns beside it
	for (const [px, yTop] of PILLARS) {
		add(px - 1, { y0: yTop, period: 16 - yTop })
		add(px + 2, { y0: yTop, period: 16 - yTop })
	}
	return streams
})()

const maxRainLife = Math.ceil(Math.max(...RAIN_STREAMS.map(s => s.period / s.vy))) + 2

const rainChar = (yf, fast) => {
	if (fast) return '|'
	const u = yf % 1
	if (u < 0.35) return '\''
	if (u < 0.7) return '.'
	return ','
}

/** Rain + basin splash. After `rainUntil`, no new cycles spawn; in-flight drops finish. */
const splashAt = (grid, frame, { rainUntil = Infinity } = {}) => {
	for (const s of RAIN_STREAMS) {
		const drops = s.body ? 1 : 2
		for (let i = 0; i < drops; i++) {
			const phase = s.phase + i * (s.period / drops)
			const raw = frame * s.vy + phase
			const cycle = Math.floor(raw / s.period)
			const yf = raw - cycle * s.period
			const cycleStart = (cycle * s.period - phase) / s.vy
			if (cycleStart > rainUntil) continue

			const y = s.y0 + (yf | 0)
			if (y < 0 || y > 15) continue

			if (s.body) {
				if (grid[y][s.x]?.ch === '@')
					paint(grid, s.x, y, '.', FG_SPLASH)
				continue
			}

			const cell = grid[y][s.x]
			if (cell && cell.fg !== FG_SPLASH) continue
			paint(grid, s.x, y, rainChar(yf, s.vy > 0.65), FG_SPLASH)

			if (yf % 1 > 0.55) {
				const ty = y - 1
				if (ty >= s.y0 && !grid[ty][s.x])
					paint(grid, s.x, ty, '\'', FG_SPLASH)
			}
		}

		// lead drop hits basin → splash on a stable row for that column
		const phase0 = s.phase
		const raw0 = frame * s.vy + phase0
		const cycle0 = Math.floor(raw0 / s.period)
		const yf0 = raw0 - cycle0 * s.period
		const cycleStart0 = (cycle0 * s.period - phase0) / s.vy
		if (cycleStart0 <= rainUntil && (yf0 < 1.2 || yf0 > s.period - 0.8)) {
			const by = 17 + (Math.floor(hash01(s.x, 2) * 3) % 3) * 2
			paint(grid, s.x, by, splashChars[(frame + s.x) & 1], FG_SPLASH)
			if (s.x + 1 < BASE_X1 && hash01(s.x, 9) > 0.45)
				paint(grid, s.x + 1, by, splashChars[(frame + s.x + 1) & 1], FG_SPLASH)
		}
	}

	// ambient basin ripple — only while rain is still spawning
	if (frame <= rainUntil)
		for (const y of [17, 19, 21])
			for (let x = BASE_X0; x < BASE_X1; x++) {
				const n = Math.sin(frame * 1.15 + hash01(x, y) * Math.PI * 2) * 0.5 + 0.5
				const n2 = Math.sin(frame * 0.7 + hash01(x + 3, y) * Math.PI * 2) * 0.5 + 0.5
				if (n > 0.9 && n2 > 0.4)
					paint(grid, x, y, splashChars[(x + y + (frame >> 1)) & 1], FG_SPLASH)
			}
}

const paintScene = (state, {
	softBase = false,
	softPillars = false,
	softBody = false,
} = {}) => {
	const grid = emptyGrid()
	if (state.baseBot > 0 || state.baseTop > 0)
		paintBase(grid, { bot: state.baseBot, top: state.baseTop, soft: softBase })
	if (state.pillars > 0)
		paintPillars(grid, { grown: state.pillars, soft: softPillars })
	if (state.bodyReach >= 0 && state.bodyMinD <= state.bodyReach)
		if (state.bodyMinD > 0)
			paintBodyFrom(grid, state.bodyMinD, softBody, state.bodyReach)
		else
			paintBody(grid, { reach: state.bodyReach, soft: softBody })
	splashAt(grid, state.frame, { rainUntil: state.rainUntil })
	return grid
}

function* show(state, soft) {
	yield render(paintScene(state, soft))
	state.frame++
}

/** Stage 1 — base wipe → pillars grow → body expands from tips. Rain from frame 0. */
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

/** Stage 2 — full icon with falling rain + basin splash (infinite). */
export function* hold(state = createAnimState()) {
	state.baseBot = state.baseTop = BASE_WIDTH
	state.pillars = maxPillarH
	state.bodyReach = maxBodyD
	state.bodyMinD = 0
	for (; ;)
		yield* show(state)
}

/** Stage 3 — reverse from current progress; stop spawning rain, let in-flight drops finish. */
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

	while (state.frame <= state.rainUntil + maxRainLife)
		yield* show(state)

	yield render(emptyGrid())
}

export const fps = 24

/** Frame producers for external use. */
export const iconAnim = { enter, hold, exit, fps, createAnimState }

/**
 * Run logo: enter → loop hold; register shutdown to play exit from current state.
 * on-shutdown is owned here, not by the player.
 */
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
