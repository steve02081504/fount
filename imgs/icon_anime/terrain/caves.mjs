/**
 * 噪声洞穴、连通模板与腔体标注。
 */

import { hash01, fbm2, ORTHO_DX, ORTHO_DY } from '../hash.mjs'

/**
 * @typedef {{ id: number, cx: number, cy: number, size: number }} CavityRegion
 */

/** `labelCavities` 复用 BFS 队列——每次调用 `.length = 0` 重置。 */
const labelQ = []

/**
 * `(x, y)` 是否会被噪声洞穴公式凿开。
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} surfaceY 该列地表行
 * @param {number} originX 稳定水平地形原点（footX0）
 * @param {number} originY 稳定垂直地形原点（baseY）
 * @param {number} seed 生成种子
 * @returns {boolean} 噪声是否凿开此格
 */
export function caveNoiseOpens(x, y, surfaceY, originX, originY, seed) {
	const depth = y - surfaceY
	return depth > 1 &&
		fbm2((x - originX) * 0.11, (y - originY) * 0.13, seed) >
		0.58 - Math.min(0.22, depth * 0.018)
}

/**
 * 若格在界内且地表以下则清除固体。
 * @param {Uint8Array} solid 扁平固体掩码
 * @param {Int16Array} surface 地表行
 * @param {number} W 世界宽
 * @param {number} H 世界高
 * @param {number} x 列
 * @param {number} y 行
 */
function carveAir(solid, surface, W, H, x, y) {
	if (x >= 0 && x < W && y >= 0 && y < H && y > surface[x]) solid[y * W + x] = 0
}

/**
 * 地表以下 2D 值噪声洞穴开凿。
 * @param {Uint8Array} solid 扁平固体掩码（原地修改）
 * @param {Int16Array} surface 地表行
 * @param {number} W 世界宽
 * @param {number} H 世界高
 * @param {number} seed 生成种子
 * @param {number} originX 稳定水平地形原点
 * @param {number} originY 稳定垂直地形原点
 * @returns {void}
 */
export function carveNoiseCaves(solid, surface, W, H, seed, originX, originY) {
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (!solid[cell] || y <= surface[x] + 1) continue
			if (caveNoiseOpens(x, y, surface[x], originX, originY, seed)) solid[cell] = 0
		}
}

/**
 * 元胞自动机清理——去除孤立固体碎屑/填单格孔洞。
 * @param {Uint8Array} solid 扁平固体掩码（原地修改）
 * @param {Int16Array} surface 地表行
 * @param {number} W 世界宽
 * @param {number} H 世界高
 * @param {number} passes CA 迭代次数
 * @returns {void}
 */
export function cellularCleanup(solid, surface, W, H, passes) {
	const next = new Uint8Array(solid.length)
	for (let pass = 0; pass < passes; pass++) {
		next.set(solid)
		for (let y = 1; y < H - 1; y++)
			for (let x = 1; x < W - 1; x++) {
				const cell = y * W + x
				if (y <= surface[x]) continue
				let n = 0
				for (let dy = -1; dy <= 1; dy++)
					for (let dx = -1; dx <= 1; dx++)
						if (dx || dy) n += solid[(y + dy) * W + (x + dx)]
				next[cell] = solid[cell] ? n >= 3 ? 1 : 0 : n >= 6 ? 1 : 0
			}
		solid.set(next)
	}
}

/**
 * 开凿 U 形管：两竖井 + 底通道。
 * @param {Uint8Array} solid 固体掩码（原地修改）
 * @param {Int16Array} surface 地表行
 * @param {number} W 世界宽
 * @param {number} H 世界高
 * @param {number} wellL 左竖井列
 * @param {number} wellR 右竖井列
 * @param {number} top 管顶行
 * @param {number} bottom 连通通道底行
 * @returns {void}
 */
function carveUTube(solid, surface, W, H, wellL, wellR, top, bottom) {
	for (const wx of [wellL, wellR]) {
		if (wx < 0 || wx >= W) continue
		const start = Math.max(top, surface[wx] + 1)
		for (let y = start; y <= bottom && y < H; y++) {
			solid[y * W + wx] = 0
			if (wx + 1 < W) solid[y * W + wx + 1] = 0
		}
	}
	for (let x = wellL; x <= wellR + 1 && x < W; x++)
		for (let y = bottom - 1; y <= bottom && y < H; y++)
			if (y > surface[x]) solid[y * W + x] = 0
}

/**
 * 开凿轴对齐开放矩形。
 * @param {Uint8Array} solid 固体掩码（原地修改）
 * @param {number} W 世界宽
 * @param {number} H 世界高
 * @param {number} x0 左列（钳 ≥ 0）
 * @param {number} y0 顶行（钳 ≥ 0）
 * @param {number} w 列宽
 * @param {number} h 行高
 * @returns {void}
 */
function carveRect(solid, W, H, x0, y0, w, h) {
	for (let y = Math.max(0, y0); y < y0 + h && y < H; y++)
		for (let x = Math.max(0, x0); x < x0 + w && x < W; x++)
			solid[y * W + x] = 0
}

/**
 * 曼哈顿走廊（L 形）。
 * @param {Uint8Array} solid 固体掩码（原地修改）
 * @param {Int16Array} surface 地表行
 * @param {number} W 世界宽
 * @param {number} H 世界高
 * @param {number} x0 起点列
 * @param {number} y0 起点行
 * @param {number} x1 终点列
 * @param {number} y1 终点行
 * @returns {void}
 */
function carveCorridor(solid, surface, W, H, x0, y0, x1, y1) {
	let x = x0
	let y = y0
	while (x !== x1) {
		carveAir(solid, surface, W, H, x, y)
		x += x1 > x ? 1 : -1
	}
	while (y !== y1) {
		carveAir(solid, surface, W, H, x, y)
		y += y1 > y ? 1 : -1
	}
	carveAir(solid, surface, W, H, x, y)
}

/**
 * 泛洪标注地下气腔（id > 0）。
 * @param {Uint8Array} solid 扁平固体掩码
 * @param {Int16Array} surface 地表行
 * @param {number} W 世界宽
 * @param {number} H 世界高
 * @returns {{ labels: Int32Array, regions: CavityRegion[] }} 每格腔 id 与区元数据
 */
export function labelCavities(solid, surface, W, H) {
	const labels = new Int32Array(W * H)
	/** @type {CavityRegion[]} */
	const regions = []
	let next = 1

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (solid[cell] || labels[cell] || y <= surface[x]) continue
			const id = next++
			labelQ.length = 0
			labelQ.push(x, y)
			labels[cell] = id
			let sx = x
			let sy = y
			let size = 1
			for (let qi = 0; qi < labelQ.length; qi += 2) {
				const cx = labelQ[qi]
				const cy = labelQ[qi + 1]
				for (let d = 0; d < 4; d++) {
					const nx = cx + ORTHO_DX[d]
					const ny = cy + ORTHO_DY[d]
					if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
					const ni = ny * W + nx
					if (solid[ni] || labels[ni] || ny <= surface[nx]) continue
					labels[ni] = id
					labelQ.push(nx, ny)
					sx += nx
					sy += ny
					size++
				}
			}
			regions.push({ id, cx: (sx / size) | 0, cy: (sy / size) | 0, size })
		}
	return { labels, regions }
}

/**
 * 用单格走廊连接邻近地下气袋。
 * @param {Uint8Array} solid 固体掩码（原地修改）
 * @param {Int16Array} surface 地表行
 * @param {number} W 世界宽
 * @param {number} H 世界高
 * @param {number} seed 生成种子
 * @returns {void}
 */
function connectNearbyCavities(solid, surface, W, H, seed) {
	const { regions } = labelCavities(solid, surface, W, H)
	const list = regions.filter(r => r.size >= 8)
	const links = Math.min(4, list.length)
	for (let i = 0; i < links; i++) {
		const a = list[(hash01(seed, 200 + i) * list.length) | 0]
		let best = null
		let bestD = Infinity
		for (const b of list) {
			if (b.id === a.id) continue
			const d = Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy)
			if (d < bestD && d > 3 && d < 28) {
				bestD = d
				best = b
			}
		}
		if (!best) continue
		carveCorridor(solid, surface, W, H, a.cx, a.cy, best.cx, best.cy)
	}
}

/**
 * 注入保证连通演示：U 形管、带颈口的腔室。
 * @param {Uint8Array} solid 固体掩码（原地修改）
 * @param {Int16Array} surface 地表行
 * @param {import('./index.mjs').TerrainFeature[]} features 待追加特征列表
 * @param {{ W: number, H: number, seed: number, iconOx: number, iconBaseX0: number, iconBaseX1: number }} opts 世界尺寸、种子与图标禁入区
 * @returns {void}
 */
export function injectConnectors(solid, surface, features, { W, H, seed, iconOx, iconBaseX0, iconBaseX1 }) {
	const footX0 = iconOx + iconBaseX0
	const footX1 = iconOx + iconBaseX1
	/**
	 * @param {number} x 列
	 * @returns {boolean} 是否与图标禁入区重叠
	 */
	const avoid = (x) => x >= footX0 - 2 && x < footX1 + 2

	const tubeCount = 2 + (hash01(seed, 41) * 2 | 0)
	for (let i = 0; i < tubeCount; i++) {
		const span = 8 + (hash01(seed, 50 + i) * 6 | 0)
		let x0 = 4 + ((hash01(seed * 3, 60 + i) * (W - span - 8)) | 0)
		if (avoid(x0) || avoid(x0 + span))
			x0 = x0 < footX0 ? Math.max(2, footX0 - span - 4) : Math.min(W - span - 2, footX1 + 4)
		if (x0 < 2 || x0 + span >= W - 2) continue

		const mid = Math.min(W - 1, x0 + (span >> 1))
		const top = Math.min(H - 6, surface[mid] + 3 + (hash01(seed, 70 + i) * 3 | 0))
		const depth = 5 + (hash01(seed, 80 + i) * 4 | 0)
		const y1 = Math.min(H - 2, top + depth)
		const wellL = x0 + 1
		const wellR = x0 + span - 2
		carveUTube(solid, surface, W, H, wellL, wellR, top, y1)
		features.push({
			type: 'u_tube',
			x0, x1: x0 + span, y0: top, y1,
			wells: [wellL, wellR],
		})
	}

	const chamberCount = 1 + (hash01(seed, 91) * 2 | 0)
	for (let i = 0; i < chamberCount; i++) {
		const w = 5 + (hash01(seed, 100 + i) * 4 | 0)
		const h = 3 + (hash01(seed, 110 + i) * 3 | 0)
		let cx = 6 + ((hash01(seed, 120 + i) * (W - w - 12)) | 0)
		if (avoid(cx) || avoid(cx + w))
			cx = cx < footX0 ? Math.max(3, footX0 - w - 5) : Math.min(W - w - 3, footX1 + 5)
		const mid = Math.min(W - 1, cx + (w >> 1))
		const cy = Math.min(H - h - 2, surface[mid] + 4 + (hash01(seed, 130 + i) * 5 | 0))
		carveRect(solid, W, H, cx, cy, w, h)
		const neckX = hash01(seed, 140 + i) > 0.5 ? cx - 1 : cx + w
		if (neckX >= 1 && neckX < W - 1) {
			const ny = cy + (h >> 1)
			solid[ny * W + neckX] = 0
			if (ny + 1 < H) solid[(ny + 1) * W + neckX] = 0
			features.push({
				type: 'neck',
				x0: Math.min(cx, neckX), x1: Math.max(cx + w, neckX + 1),
				y0: cy, y1: cy + h,
			})
		}
		features.push({ type: 'chamber', x0: cx, x1: cx + w, y0: cy, y1: cy + h })
	}

	connectNearbyCavities(solid, surface, W, H, seed)
}

/**
 * 保持图标基座跨度在 `baseY` 陆地，并确保该壳层格为土壤。
 * @param {Uint8Array} solid 固体掩码（原地修改）
 * @param {Int16Array} surface 地表行（原地修改）
 * @param {number} W 世界宽
 * @param {number} H 世界高
 * @param {number} footX0 左足列
 * @param {number} footX1 右足列（不含）
 * @param {number} baseY 基座地表行
 * @returns {void}
 */
export function carveIconFootprint(solid, surface, W, H, footX0, footX1, baseY) {
	for (let x = footX0; x < footX1; x++) {
		if (x < 0 || x >= W) continue
		surface[x] = baseY
		for (let y = 0; y < baseY; y++)
			solid[y * W + x] = 0
		if (baseY < H) solid[baseY * W + x] = 1
	}
}
