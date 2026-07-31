/**
 * Packed fount fountain silhouette + body growth order.
 * Packing matches imgs/icon.js; colors match icon_ansi_ascii (@=30, ::=96).
 */

/** Icon-local layout (pre-center). Extra base rows 20/22 are animation-only. */
export const ICON_BASE_ROWS = [16, 18, 20, 22]
/**
 *
 */
export const ICON_BASE_X0 = 5
/**
 *
 */
export const ICON_BASE_X1 = 37
/**
 *
 */
export const BASE_WIDTH = ICON_BASE_X1 - ICON_BASE_X0

/** Same packing as icon.js → 20 content rows (body 0–15, base slabs 16–19). */
export const ICON = (() => {
	let f, o, u, n, t = ''
	for (f of [9 ** 8 - 1, 109, 513835, 2077, 133, 25])
		for (o = '', n = 21; u = ' :'[0 | f % 3] || '@', n; f /= 3)
			t = `${o = u + o + u}\n`.repeat(!--n * 6939 / f % 9.4) + t
	return t.trimEnd().split('\n')
})()

/**
 *
 */
export const ICON_PACK_H = ICON.length
/**
 *
 */
export const ICON_W = Math.max(...ICON.map(line => line.length))
/**
 *
 */
export const ICON_H = ICON_BASE_ROWS[ICON_BASE_ROWS.length - 1] + 1

/** Three :: pillars: [x, yTop, yBot] in icon-local space */
export const PILLARS = [
	[16, 2, 15],
	[20, 0, 15],
	[24, 2, 15],
]

/**
 *
 */
export const maxPillarH = Math.max(...PILLARS.map(([, yTop, yBot]) => yBot - yTop + 1))

/**
 * Body `@` cells sorted by manhattan distance to nearest pillar tip.
 * Packed as parallel typed arrays: x[i], y[i], d[i].
 */
const BODY = (() => {
	const tips = PILLARS.flatMap(([x, yTop]) => [[x, yTop], [x + 1, yTop]])
	const cells = []
	for (let y = 0; y < 16; y++) {
		const line = ICON[y]
		for (let x = 0; x < line.length; x++) {
			if (line[x] !== '@') continue
			let best = Infinity
			for (const [tx, ty] of tips) {
				const d = Math.abs(x - tx) + Math.abs(y - ty)
				if (d < best) best = d
			}
			cells.push(x, y, best)
		}
	}
	const n = cells.length / 3
	const order = Array.from({ length: n }, (_, i) => i)
	order.sort((a, b) => {
		const da = cells[a * 3 + 2]
		const db = cells[b * 3 + 2]
		return da - db || cells[a * 3 + 1] - cells[b * 3 + 1] || cells[a * 3] - cells[b * 3]
	})
	const x = new Uint8Array(n)
	const y = new Uint8Array(n)
	const d = new Uint8Array(n)
	for (let i = 0; i < n; i++) {
		const o = order[i] * 3
		x[i] = cells[o]
		y[i] = cells[o + 1]
		d[i] = cells[o + 2]
	}
	return { x, y, d, count: n }
})()

/**
 *
 */
export const bodyX = BODY.x
/**
 *
 */
export const bodyY = BODY.y
/**
 *
 */
export const bodyD = BODY.d
/**
 *
 */
export const bodyCount = BODY.count
/**
 *
 */
export const maxBodyD = BODY.d[BODY.count - 1]

/** Icon-local body distance grid: `d = BODY_DIST[y * ICON_W + x]`, unset = 255. */
export const BODY_DIST = (() => {
	const dist = new Uint8Array(ICON_W * 16).fill(255)
	for (let i = 0; i < BODY.count; i++)
		dist[BODY.y[i] * ICON_W + BODY.x[i]] = BODY.d[i]
	return dist
})()

/** Layout constants for tests. */
export const layout = {
	ICON_W, ICON_H, ICON_PACK_H, ICON_BASE_ROWS, BASE_WIDTH, maxBodyD, maxPillarH,
}
