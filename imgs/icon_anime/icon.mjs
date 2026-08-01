/**
 * 打包的 fount 喷泉轮廓与 body 生长顺序。
 * 打包方式与 imgs/icon.js 一致；颜色与 icon_ansi_ascii 一致（@=30, ::=96）。
 *
 * 注：imgs/icon.js 保持为独立 fetch+eval 控制台片段，
 * 无法在不破坏 CDN/控制台用法的前提下共享 ESM 解码器。
 */

/** 图标局部布局（居中前）。额外底座行 20/22 仅用于动画。 */
export const ICON_BASE_ROWS = [16, 18, 20, 22]
/** 底座左端 X（图标局部坐标）。 */
export const ICON_BASE_X0 = 5
/** 底座右端 X（不含，图标局部坐标）。 */
export const ICON_BASE_X1 = 37
/** 轮廓高度（= 首个底座行索引）。 */
export const ICON_BODY_H = ICON_BASE_ROWS[0]

/** 与 icon.js 相同打包 → 20 行内容（body 0–15，底座板 16–19）。 */
export const ICON = (() => {
	let packed, leftHalf, glyph, repeat, ascii = ''
	for (packed of [9 ** 8 - 1, 109, 513835, 2077, 133, 25])
		for (leftHalf = '', repeat = 21; glyph = ' :'[0 | packed % 3] || '@', repeat; packed /= 3)
			ascii = `${leftHalf = glyph + leftHalf + glyph}\n`.repeat(!--repeat * 6939 / packed % 9.4) + ascii
	return ascii.trimEnd().split('\n')
})()

/** 打包位图行数。 */
export const ICON_PACK_H = ICON.length
/** 图标宽度（字符列）。 */
export const ICON_W = Math.max(...ICON.map(line => line.length))
/** 图标总高度（含动画用底座行）。 */
export const ICON_H = ICON_BASE_ROWS[ICON_BASE_ROWS.length - 1] + 1

/** 三根 :: 水柱：[x, yTop, yBot]，图标局部坐标。 */
export const PILLARS = [
	[16, 2, 15],
	[20, 0, 15],
	[24, 2, 15],
]

/** 三根水柱的最大高度。 */
export const maxPillarH = Math.max(...PILLARS.map(([, yTop, yBot]) => yBot - yTop + 1))

/**
 * body `@` 格点，按到最近柱尖的曼哈顿距离排序。
 * 打包为并行类型化数组：x[i], y[i], d[i]。
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

/** 轮廓 `@` 距最近柱尖的最大曼哈顿距离。 */
export const maxBodyD = BODY.d[BODY.count - 1]

/** 图标局部 body 距离格：`d = BODY_DIST[y * ICON_W + x]`，未设置 = 255。 */
export const BODY_DIST = (() => {
	const dist = new Uint8Array(ICON_W * ICON_BODY_H).fill(255)
	for (let i = 0; i < BODY.count; i++)
		dist[BODY.y[i] * ICON_W + BODY.x[i]] = BODY.d[i]
	return dist
})()
