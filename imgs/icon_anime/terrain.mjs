/**
 * 确定性 Terraria 风格 ASCII 地形与洞穴生成。
 * 地表锚定在图标基座（两端落地），向外行走并约束坡度/平台/悬崖；
 * 地下用噪声空腔、元胞自动机清理及注入连通模板（U 形管、颈口）。
 *
 * `solid` 为扁平 Uint8Array，索引 `y * W + x`（与流体网格同布局）。
 */

import { hash01, fbm2, ORTHO_DX, ORTHO_DY } from './hash.mjs'

/** 地表/墙体轮廓字符。 */
export const TERRAIN_CH = {
	FLAT: '_',
	FLAT_ALT: '-',
	SLOPE_UP: '/',   // 向右上升
	SLOPE_DOWN: '\\', // 向右下降
	WALL: '|',
	FLOOR: '-',
	CEIL: '-',
}

/**
 * @typedef {{
 *   surface: Int16Array,
 *   solid: Uint8Array,
 *   worldW: number,
 *   worldH: number,
 *   surfaceChar: string[],
 *   outline: (string | null)[],
 *   footX0: number,
 *   footX1: number,
 *   features: TerrainFeature[],
 *   viewW: number,
 *   ox: number,
 *   baseY: number,
 * }} TerrainData
 *
 * @typedef {{
 *   type: 'u_tube' | 'chamber' | 'neck',
 *   x0: number, x1: number, y0: number, y1: number,
 *   wells?: [number, number],
 * }} TerrainFeature
 *
 * @typedef {{ id: number, cx: number, cy: number, size: number }} CavityRegion
 */

/** 须满足高地块厚度下限的可见陆地列（占视口宽度比例）。 */
export const TALL_LAND_FRACTION = 0.3
/** 高地块 = 列厚 ≥ 屏幕（视口）高度的该比例。 */
export const TALL_LAND_HEIGHT_FRAC = 0.25
/** 基座外侧两端强制与基座齐平的陆地列数。 */
const PEDESTAL_SHOULDER = 3

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
function caveNoiseOpens(x, y, surfaceY, originX, originY, seed) {
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
 * 为流体世界生成全宽地形。
 * 地表锚定图标基座并向外行走，使基座两端落在陆地上；
 * ≥30% 视口列保持陆地厚 ≥ ¼ 屏高。
 * @param {{ worldW: number, worldH: number, viewW: number, viewH: number, ox: number }} world 流体世界尺寸字段
 * @param {{ iconOx: number, iconOy: number, seed: number, iconBaseRows: number[], iconBaseX0: number, iconBaseX1: number }} opts 图标位置与种子
 * @returns {TerrainData} 地形数据
 */
export function generateTerrain(world, {
	iconOx, iconOy, seed,
	iconBaseRows, iconBaseX0, iconBaseX1,
}) {
	const { worldW: W, worldH: H, viewW, viewH, ox } = world
	const lastBase = iconBaseRows[iconBaseRows.length - 1]
	const baseY = Math.min(H - 4, iconOy + lastBase)
	const minY = Math.max(2, iconOy + 12)
	const maxY = H - 3
	const footX0 = iconOx + iconBaseX0
	const footX1 = iconOx + iconBaseX1

	const surface = buildSurface(W, {
		baseY, minY, maxY, seed,
		footX0, footX1, viewH, viewW, ox, H,
	})

	const solid = new Uint8Array(W * H)
	for (let x = 0; x < W; x++) {
		const top = surface[x]
		for (let y = top; y < H; y++)
			solid[y * W + x] = 1
	}

	carveNoiseCaves(solid, surface, W, H, seed, footX0, baseY)
	cellularCleanup(solid, surface, W, H, 2)

	const features = []
	injectConnectors(solid, surface, features, { W, H, seed, iconOx, iconBaseX0, iconBaseX1 })

	carveIconFootprint(solid, surface, W, H, footX0, footX1, baseY)

	const surfaceChar = buildSurfaceChars(surface, W)
	const outline = buildOutline(solid, surface, W, H)

	return {
		surface, solid, worldW: W, worldH: H, surfaceChar, outline,
		footX0, footX1, features, viewW, ox, baseY,
	}
}

/**
 * 缩放地形而不重生成仍留在世界内的格。
 * 图标基座为稳定原点：保留矩形随其移动，
 * 仅对扩展暴露的格做带种子地表/洞穴填充。
 * @param {TerrainData} previous 缩放前地形
 * @param {{ worldW: number, worldH: number, viewW: number, viewH: number, ox: number }} world 新流体世界
 * @param {{ iconOx: number, iconOy: number, seed: number, iconBaseRows: number[], iconBaseX0: number, iconBaseX1: number }} opts 图标位置与种子
 * @returns {{ terrain: TerrainData, addedSolid: Uint8Array }} 缩放后地形与新生成土壤掩码
 */
export function resizeTerrain(previous, world, opts) {
	const { worldW: W, worldH: H, viewW, ox } = world
	const { iconOx, iconOy, seed, iconBaseRows, iconBaseX0, iconBaseX1 } = opts
	const baseY = Math.min(H - 4, iconOy + iconBaseRows[iconBaseRows.length - 1])
	const footX0 = iconOx + iconBaseX0
	const footX1 = iconOx + iconBaseX1
	const dx = footX0 - previous.footX0
	const dy = baseY - previous.baseY
	const surface = new Int16Array(W)
	const solid = new Uint8Array(W * H)
	const addedSolid = new Uint8Array(W * H)
	const minY = Math.max(2, iconOy + 12)
	const maxY = H - 3

	const retainedX0 = Math.max(0, dx)
	const retainedX1 = Math.min(W, dx + previous.worldW)
	for (let x = retainedX0; x < retainedX1; x++)
		surface[x] = Math.min(maxY, Math.max(minY, previous.surface[x - dx] + dy))
	if (retainedX0 > 0)
		walkSurface(surface, retainedX0 - 1, -1, surface[retainedX0], {
			minY, maxY, seed, hashOrigin: footX0,
		})
	if (retainedX1 < W)
		walkSurface(surface, retainedX1, 1, surface[retainedX1 - 1], {
			minY, maxY, seed, hashOrigin: footX0,
		})

	for (let y = 0; y < previous.worldH; y++) {
		const ny = y + dy
		if (ny < 0 || ny >= H) continue
		for (let x = 0; x < previous.worldW; x++) {
			const nx = x + dx
			if (nx < 0 || nx >= W) continue
			solid[ny * W + nx] = previous.solid[y * previous.worldW + x]
		}
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const oldX = x - dx
			const oldY = y - dy
			if (oldX >= 0 && oldX < previous.worldW && oldY >= 0 && oldY < previous.worldH)
				continue
			if (y < surface[x]) continue
			const i = y * W + x
			if (caveNoiseOpens(x, y, surface[x], footX0, baseY, seed)) continue
			solid[i] = 1
			addedSolid[i] = 1
		}

	const features = previous.features.flatMap(feature => {
		const x0 = feature.x0 + dx
		const x1 = feature.x1 + dx
		const y0 = feature.y0 + dy
		const y1 = feature.y1 + dy
		if (x1 <= 0 || x0 >= W || y1 <= 0 || y0 >= H) return []
		const shifted = { ...feature, x0, x1, y0, y1 }
		if (feature.wells)
			shifted.wells = /** @type {[number, number]} */ feature.wells.map(well => well + dx)
		return [shifted]
	})
	const terrain = {
		surface, solid, worldW: W, worldH: H,
		surfaceChar: buildSurfaceChars(surface, W),
		outline: buildOutline(solid, surface, W, H),
		footX0, footX1, features, viewW, ox, baseY,
	}
	return { terrain, addedSolid }
}

/**
 * 锚定图标基座的约束随机游走地表。
 * @param {number} W 世界宽
 * @param {{ baseY: number, minY: number, maxY: number, seed: number, footX0: number, footX1: number, viewH: number, viewW: number, ox: number, H: number }} opts 地表行走边界与视口锚点
 * @returns {Int16Array} 每列地表行
 */
function buildSurface(W, {
	baseY, minY, maxY, seed,
	footX0, footX1, viewH, viewW, ox, H,
}) {
	const surface = new Int16Array(W)
	const x0 = Math.max(0, Math.min(W, footX0))
	const x1 = Math.max(x0, Math.min(W, footX1))

	for (let x = x0; x < x1; x++)
		surface[x] = baseY

	const shoulder = Math.min(PEDESTAL_SHOULDER, Math.max(1, (x1 - x0) >> 2))
	for (let i = 1; i <= shoulder; i++) {
		if (x0 - i >= 0) surface[x0 - i] = baseY
		if (x1 + i - 1 < W) surface[x1 + i - 1] = baseY
	}

	walkSurface(surface, x0 - shoulder - 1, -1, baseY, {
		minY, maxY, seed, hashOrigin: footX0,
	})
	walkSurface(surface, x1 + shoulder, 1, baseY, {
		minY, maxY, seed, hashOrigin: footX0,
	})

	softClampSpikes(surface, W)
	ensureTallLand(surface, {
		W, H, viewH, viewW, ox, seed, footX0: x0, footX1: x1, baseY,
	})
	for (let x = Math.max(0, x0 - shoulder); x < Math.min(W, x1 + shoulder); x++)
		surface[x] = baseY

	return surface
}

/**
 * 从锚点列沿 `dir`（±1）随机游走地表。
 * @param {Int16Array} surface 地表行（原地修改）
 * @param {number} startX 首写列
 * @param {number} dir +1 向右 / -1 向左
 * @param {number} startY 邻锚点高度
 * @param {{ minY: number, maxY: number, seed: number, hashOrigin?: number }} opts 行走边界与哈希原点
 * @returns {void}
 */
function walkSurface(surface, startX, dir, startY, { minY, maxY, seed, hashOrigin = 0 }) {
	const W = surface.length
	if (startX < 0 || startX >= W) return

	let y = startY
	let slope = 0
	let plateau = 0
	for (let x = startX; dir > 0 ? x < W : x >= 0; x += dir) {
		const hx = x - hashOrigin
		const r = hash01(hx + seed, 3)
		const feature = hash01(hx + seed * 2, 19)

		if (plateau > 0)
			plateau--
		else if (feature > 0.92) {
			const drop = 2 + (hash01(hx, seed + 7) * 3 | 0)
			y += hash01(hx, seed + 8) > 0.5 ? drop : -drop
			slope = 0
			plateau = 1 + (hash01(hx, seed + 9) * 3 | 0)
		}
		else if (feature > 0.78) {
			slope = 0
			plateau = 3 + (hash01(hx, seed + 11) * 6 | 0)
		}
		else if (feature > 0.62)
			slope = Math.max(-2, Math.min(2, slope + (r > 0.5 ? 1 : -1)))
		else if (r < 0.25)
			slope = Math.max(-2, slope - 1)
		else if (r > 0.75)
			slope = Math.min(2, slope + 1)

		y += slope
		if (y < minY) {
			y = minY
			slope = Math.max(0, slope)
		}
		if (y > maxY) {
			y = maxY
			slope = Math.min(0, slope)
		}
		surface[x] = y
	}
}

/**
 * 单遍软钳位 3+ 孤立尖峰。
 * @param {Int16Array} surface 地表行（原地修改）
 * @param {number} W 世界宽
 * @returns {void}
 */
function softClampSpikes(surface, W) {
	for (let x = 1; x < W - 1; x++) {
		const dL = surface[x] - surface[x - 1]
		const dR = surface[x] - surface[x + 1]
		if (dL * dR > 0 && Math.abs(dL) >= 3 && Math.abs(dR) >= 3)
			surface[x] = Math.round((surface[x - 1] + surface[x + 1]) / 2)
	}
}

/**
 * 抬高足够视口列，使 ≥ TALL_LAND_FRACTION 列厚 ≥ ¼ 屏。
 * @param {Int16Array} surface 地表行（原地修改）
 * @param {{ W: number, H: number, viewH: number, viewW: number, ox: number, seed: number, footX0: number, footX1: number, baseY: number }} opts 视口与基座几何
 * @returns {void}
 */
function ensureTallLand(surface, {
	W, H, viewH, viewW, ox, seed, footX0, footX1, baseY,
}) {
	const minThick = Math.max(1, Math.ceil(viewH * TALL_LAND_HEIGHT_FRAC))
	const maxSurface = Math.max(2, Math.min(H - 2, viewH - minThick))
	const vx0 = Math.max(0, ox)
	const vx1 = Math.min(W, ox + viewW)
	const footContributes = viewH - baseY >= minThick
	const shoulderL = footX0 - PEDESTAL_SHOULDER
	const shoulderR = footX1 + PEDESTAL_SHOULDER

	/**
	 * @param {number} x 列
	 * @returns {boolean} 该列是否满足高地块厚度
	 */
	const isTall = (x) => x >= shoulderL && x < shoulderR
		? footContributes
		: viewH - surface[x] >= minThick

	let raisable = 0
	for (let x = vx0; x < vx1; x++)
		if (x < shoulderL || x >= shoulderR) raisable++
	const footSpan = Math.max(0, footX1 - footX0)
	const capacity = raisable + (footContributes ? footSpan + 2 * PEDESTAL_SHOULDER : 0)
	const need = Math.min(Math.ceil((vx1 - vx0) * TALL_LAND_FRACTION), capacity)

	let have = 0
	for (let x = vx0; x < vx1; x++)
		if (isTall(x)) have++
	if (have >= need) return

	const cands = []
	for (let x = vx0; x < vx1; x++) {
		if (x >= shoulderL && x < shoulderR) continue
		if (viewH - surface[x] >= minThick) continue
		cands.push(x)
	}
	cands.sort((a, b) => (viewH - surface[a]) - (viewH - surface[b]) ||
		hash01(a, seed + 3) - hash01(b, seed + 3))

	for (const x of cands) {
		if (have >= need) break
		const wasTall = isTall(x)
		surface[x] = Math.min(surface[x], maxSurface)
		if (!wasTall && isTall(x)) have++
		for (const dx of [-1, 1, -2, 2]) {
			const nx = x + dx
			if (nx < vx0 || nx >= vx1) continue
			if (nx >= shoulderL && nx < shoulderR) continue
			const neighborWas = isTall(nx)
			surface[nx] = Math.min(surface[nx], maxSurface + (Math.abs(dx) > 1 ? 1 : 0))
			if (!neighborWas && isTall(nx)) have++
		}
	}
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
function carveNoiseCaves(solid, surface, W, H, seed, originX, originY) {
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
function cellularCleanup(solid, surface, W, H, passes) {
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
 * 注入保证连通演示：U 形管、带颈口的腔室。
 * @param {Uint8Array} solid 固体掩码（原地修改）
 * @param {Int16Array} surface 地表行
 * @param {TerrainFeature[]} features 待追加特征列表
 * @param {{ W: number, H: number, seed: number, iconOx: number, iconBaseX0: number, iconBaseX1: number }} opts 世界尺寸、种子与图标禁入区
 * @returns {void}
 */
function injectConnectors(solid, surface, features, { W, H, seed, iconOx, iconBaseX0, iconBaseX1 }) {
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
 * 泛洪标注地下气腔（id > 0）。
 * 填充时累积区质心——无每格列表。
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
function carveIconFootprint(solid, surface, W, H, footX0, footX1, baseY) {
	for (let x = footX0; x < footX1; x++) {
		if (x < 0 || x >= W) continue
		surface[x] = baseY
		for (let y = 0; y < baseY; y++)
			solid[y * W + x] = 0
		if (baseY < H) solid[baseY * W + x] = 1
	}
}

/**
 * 由邻列差分选取地表列轮廓字符。
 * @param {Int16Array} surface 地表行
 * @param {number} W 世界宽
 * @returns {string[]} 每列地表字符
 */
function buildSurfaceChars(surface, W) {
	const chars = Array(W)
	for (let x = 0; x < W; x++) {
		const y = surface[x]
		const left = x > 0 ? surface[x - 1] : y
		const right = x < W - 1 ? surface[x + 1] : y
		const dL = y - left
		const dR = right - y

		if (dL === 0 && dR === 0)
			chars[x] = (x + y) & 1 ? TERRAIN_CH.FLAT_ALT : TERRAIN_CH.FLAT
		else {
			const slope = dR || dL
			chars[x] = Math.abs(slope) >= 2
				? TERRAIN_CH.WALL
				: slope < 0 ? TERRAIN_CH.SLOPE_UP : TERRAIN_CH.SLOPE_DOWN
		}
	}
	return chars
}

/**
 * 预计算固体格轮廓字形（null = 内部/地表）。
 * @param {Uint8Array} solid 扁平固体掩码
 * @param {Int16Array} surface 地表行
 * @param {number} W 世界宽
 * @param {number} H 世界高
 * @returns {(string | null)[]} 扁平轮廓字形
 */
function buildOutline(solid, surface, W, H) {
	const outline = Array(W * H)
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++)
			outline[y * W + x] = outlineChar(solid, x, y, W, H, surface)
	return outline
}

/**
 * 固体格可见轮廓（邻空气）字符。
 * 内部固体返回 null（不绘制）。
 * @param {Uint8Array} solid 扁平固体掩码
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} W 世界宽
 * @param {number} H 世界高
 * @param {Int16Array} surface 地表行
 * @returns {string | null} 轮廓字形或 null
 */
export function outlineChar(solid, x, y, W, H, surface) {
	const cell = y * W + x
	if (!solid[cell] || y === surface[x]) return null

	/**
	 * @param {number} nx 列
	 * @param {number} ny 行
	 * @returns {boolean} 空气 / 越界
	 */
	const air = (nx, ny) =>
		nx < 0 || ny < 0 || nx >= W || ny >= H || !solid[ny * W + nx]

	const up = air(x, y - 1)
	const down = air(x, y + 1)
	const left = air(x - 1, y)
	const right = air(x + 1, y)
	if (!(up || down || left || right)) return null

	if (left && right && !up && !down) return TERRAIN_CH.WALL
	if (up && down && !left && !right) return TERRAIN_CH.FLOOR
	if (up && right && !down && !left) return TERRAIN_CH.SLOPE_DOWN
	if (up && left && !down && !right) return TERRAIN_CH.SLOPE_UP
	if (down && right && !up && !left) return TERRAIN_CH.SLOPE_UP
	if (down && left && !up && !right) return TERRAIN_CH.SLOPE_DOWN
	if (left || right) return TERRAIN_CH.WALL
	if (up) return TERRAIN_CH.CEIL
	if (down) return TERRAIN_CH.FLOOR
	return TERRAIN_CH.WALL
}
