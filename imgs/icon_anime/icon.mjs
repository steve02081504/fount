/**
 * Packed fount fountain silhouette + body growth order.
 * Packing matches imgs/icon.js; colors match icon_ansi_ascii (@=30, ::=96).
 *
 * Note: imgs/icon.js stays a standalone fetch+eval console snippet and cannot
 * share an ESM decoder without breaking CDN/console usage.
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
/** Body silhouette height (= first base row index). */
export const ICON_BODY_H = ICON_BASE_ROWS[0]

/** Same packing as icon.js → 20 content rows (body 0–15, base slabs 16–19). */
export const ICON = (() => {
	let packed, leftHalf, glyph, repeat, ascii = ''
	for (packed of [9 ** 8 - 1, 109, 513835, 2077, 133, 25])
		for (leftHalf = '', repeat = 21; glyph = ' :'[0 | packed % 3] || '@', repeat; packed /= 3)
			ascii = `${leftHalf = glyph + leftHalf + glyph}\n`.repeat(!--repeat * 6939 / packed % 9.4) + ascii
	return ascii.trimEnd().split('\n')
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
export const BODY = (() => {
	const tips = PILLARS.flatMap(([x, yTop]) => [[x, yTop], [x + 1, yTop]])
	const cells = []
	for (let y = 0; y < ICON_BODY_H; y++) {
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
export const maxBodyD = BODY.d[BODY.count - 1]

/** Icon-local body distance grid: `d = BODY_DIST[y * ICON_W + x]`, unset = 255. */
export const BODY_DIST = (() => {
	const dist = new Uint8Array(ICON_W * ICON_BODY_H).fill(255)
	for (let i = 0; i < BODY.count; i++)
		dist[BODY.y[i] * ICON_W + BODY.x[i]] = BODY.d[i]
	return dist
})()
