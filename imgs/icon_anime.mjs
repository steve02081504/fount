#!/usr/bin/env -S deno run -A
/**
 * fount fountain logo ASCII animation API.
 * Silhouette packed like imgs/icon.js; colors match icon_ansi_ascii (@=30, ::=96).
 *
 * API: { enter, hold, exit, fps }
 * Main: enter → loop hold → Ctrl+C → exit
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

const paintBase = (grid, {
	bot = BASE_X1 - BASE_X0,
	top = BASE_X1 - BASE_X0,
	soft = true,
} = {}) => {
	const width = BASE_X1 - BASE_X0
	for (const y of BASE_ROWS) {
		const fromLeft = y === 20 || y === 22
		const n = fromLeft ? bot : top
		for (let i = 0; i < width; i++) {
			const x = BASE_X0 + i
			const on = fromLeft ? i < n : i >= width - n
			if (!on) continue
			const edge = soft && (fromLeft ? i === n - 1 : i === width - n)
			paint(grid, x, y, edge && n < width ? '.' : '@', FG_AT)
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

const paintBodyFrom = (grid, minD, soft = true) => {
	for (const { x, y, d } of BODY_ATS) {
		if (d < minD) continue
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

const wrapPeriod = (v, period) => ((v % period) + period) % period

const rainChar = (yf, fast) => {
	if (fast) return '|'
	const u = yf % 1
	if (u < 0.35) return '\''
	if (u < 0.7) return '.'
	return ','
}

/** Hold-loop FX: rain falls top→bottom; basin splash is per-column, not L↔R. */
const splashAt = (grid, frame) => {
	for (const s of RAIN_STREAMS) {
		const drops = s.body ? 1 : 2
		for (let i = 0; i < drops; i++) {
			const phase = s.phase + i * (s.period / drops)
			const yf = wrapPeriod(frame * s.vy + phase, s.period)
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
		const yf0 = wrapPeriod(frame * s.vy + s.phase, s.period)
		if (yf0 < 1.2 || yf0 > s.period - 0.8) {
			const by = 17 + (Math.floor(hash01(s.x, 2) * 3) % 3) * 2
			paint(grid, s.x, by, splashChars[(frame + s.x) & 1], FG_SPLASH)
			if (s.x + 1 < BASE_X1 && hash01(s.x, 9) > 0.45)
				paint(grid, s.x + 1, by, splashChars[(frame + s.x + 1) & 1], FG_SPLASH)
		}
	}

	// ambient basin ripple — phase locked per cell (no horizontal travel)
	for (const y of [17, 19, 21])
		for (let x = BASE_X0; x < BASE_X1; x++) {
			const n = Math.sin(frame * 1.15 + hash01(x, y) * Math.PI * 2) * 0.5 + 0.5
			const n2 = Math.sin(frame * 0.7 + hash01(x + 3, y) * Math.PI * 2) * 0.5 + 0.5
			if (n > 0.9 && n2 > 0.4)
				paint(grid, x, y, splashChars[(x + y + (frame >> 1)) & 1], FG_SPLASH)
		}
}

/** Stage 1 — base wipe → pillars grow → body expands from tips. */
export function* enter() {
	const width = BASE_X1 - BASE_X0
	for (let n = 0; n <= width; n++) {
		const g = emptyGrid()
		paintBase(g, { bot: n, top: n })
		yield render(g)
	}
	for (let g = 1; g <= maxPillarH; g++) {
		const grid = emptyGrid()
		paintBase(grid)
		paintPillars(grid, { grown: g })
		yield render(grid)
		if (g < maxPillarH) {
			const settled = emptyGrid()
			paintBase(settled)
			paintPillars(settled, { grown: g, soft: false })
			yield render(settled)
		}
	}
	{
		const grid = emptyGrid()
		paintBase(grid)
		paintPillars(grid, { soft: false })
		yield render(grid)
	}
	for (let reach = 0; reach <= maxBodyD; reach++) {
		const grid = emptyGrid()
		paintBase(grid)
		paintPillars(grid, { soft: false })
		paintBody(grid, { reach })
		yield render(grid)
	}
	{
		const grid = emptyGrid()
		paintBase(grid)
		paintPillars(grid, { soft: false })
		paintBody(grid, { soft: false })
		yield render(grid)
	}
}

/** Stage 2 — full icon with falling rain + basin splash (infinite). */
export function* hold() {
	for (let frame = 0; ; frame++) {
		const grid = emptyGrid()
		paintBase(grid, { soft: false })
		paintPillars(grid, { soft: false })
		paintBody(grid, { soft: false })
		splashAt(grid, frame)
		yield render(grid)
	}
}

/** Stage 3 — body dissolves from tips → pillars shrink → base wipe out. */
export function* exit() {
	const width = BASE_X1 - BASE_X0
	for (let gone = 0; gone <= maxBodyD + 1; gone++) {
		const grid = emptyGrid()
		paintBase(grid, { soft: false })
		paintPillars(grid, { soft: false })
		if (gone <= maxBodyD) paintBodyFrom(grid, gone, true)
		yield render(grid)
	}
	for (let g = maxPillarH; g >= 0; g--) {
		const grid = emptyGrid()
		paintBase(grid, { soft: false })
		if (g > 0) paintPillars(grid, { grown: g, soft: true })
		yield render(grid)
		if (g > 0) {
			const settled = emptyGrid()
			paintBase(settled, { soft: false })
			paintPillars(settled, { grown: g, soft: false })
			yield render(settled)
		}
	}
	for (let n = width; n >= 0; n--) {
		const g = emptyGrid()
		if (n > 0) paintBase(g, { bot: n, top: n })
		yield render(g)
	}
	yield render(emptyGrid())
}

export const fps = 24

/** Frame producers for external use. */
export const iconAnim = { enter, hold, exit, fps }

/**
 * Run logo: enter → loop hold; register shutdown to play exit.
 * on-shutdown is owned here, not by the player.
 */
if (import.meta.main) {
	const player = new AsciiAnimePlayer({ fps })

	on_shutdown(async () => {
		player.abort()
		await player.play(exit, { signal: null })
		player.stop()
	})

	player.start()

	await player.play(enter).loop(hold)
}
