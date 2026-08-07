/**
 * 喷泉动画的逐帧绘制与 ANSI 渲染。
 * 可选指针光效：按住火炬（环境变暗 + 径向提亮，由 torchBlend 缓动）
 * 和/或点击涟漪（明亮扩散环，无环境变暗）。
 */

import {
	MAT, LIQ_DRAW, COND_DRAW, BUBBLE_MIN_CELLS,
	isLiquidBarrier, isSoilMat, waterChar, liquidChar, dripChar, lavaChar,
} from './fluid/index.mjs'
import { sampleLight, RIPPLE_SPEED, RIPPLE_WIDTH, torchEase } from './gesture/light.mjs'
import { ICON_W, ICON_BODY_H, PILLARS, BODY_DIST, maxBodyD } from './icon.mjs'

const RESET = '\x1b[0m'
const FG_AT = '\x1b[30m'
const FG_COL = '\x1b[96m'
const FG_SPLASH = '\x1b[36m'
const FG_TERRAIN = '\x1b[90m'

/** 熔岩温度色阶（暗红 → 橙 → 亮黄），12 档。 */
const LAVA_RGB = [
	[120, 20, 10],
	[150, 30, 12],
	[180, 40, 10],
	[200, 55, 12],
	[220, 70, 15],
	[230, 90, 20],
	[240, 110, 25],
	[245, 140, 30],
	[250, 170, 40],
	[255, 190, 50],
	[255, 210, 70],
	[255, 230, 100],
]
const FG_BUBBLE = '\x1b[38;2;40;20;15m'

/** SGR 缓存键：null / 未知前景。 */
const FG_ID_UNKNOWN = 4

/** 调色板源表 [sgr, rgb, id]；id 4 保留给 null/未知。 */
const FG_PALETTE = [
	[FG_AT, [28, 28, 34], 0],
	[FG_COL, [70, 235, 255], 1],
	[FG_SPLASH, [0, 195, 210], 2],
	[FG_TERRAIN, [105, 105, 115], 3],
	[FG_BUBBLE, [40, 20, 15], 5],
	...LAVA_RGB.map((rgb, i) => [`\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`, rgb, 6 + i]),
]

/** 各调色板条目的基准 RGB（真彩提亮目标）。 */
const FG_RGB = /** @type {Record<string, number[]>} */ {}
/** SGR 缓存键的调色板 id。 */
const FG_ID = new Map()
for (const [sgr, rgb, id] of FG_PALETTE) {
	FG_RGB[sgr] = rgb
	FG_ID.set(sgr, id)
}

const FG_LAVA = FG_PALETTE.filter(([, , id]) => id >= 6).map(([sgr]) => sgr)

/**
 * 温度 → 熔岩前景 SGR。
 * @param {number} temp 温度
 * @returns {string} SGR
 */
const lavaFg = (temp) => {
	const t = Math.min(0.999, Math.max(0, temp))
	return FG_LAVA[(t * FG_LAVA.length) | 0]
}
/** 真彩 SGR 复用的量化提亮档位。 */
const LIFT_Q = 32
/** 量化环境变暗强度档位（火炬渐隐）。 */
const AMBIENT_Q = 16
/** 缓存的真彩 SGR 字符串：键 = 打包 (ambQ<<12)|(fgId<<7)|(liftQ<<1)|bgBit */
const sgrCache = new Map()

/** 指针聚光灯的视觉半径（单元格宽高比 ≈ 1×2）。 */
export const LIGHT_RADIUS = 14
/** 火炬全亮时远离光标的单元格环境变暗量。 */
const LIGHT_AMBIENT = 0.3

/** 复用的 sampleLight 输出（compose 热路径）。 */
const sampleOut = { ambient: 0, lift: 0 }
/** 复用的 ANSI 片段列表——每帧一次 join，而非逐格 `+=`。 */
const frameParts = /** @type {string[]} */[]
/** 共用同一 SGR 段的字形——每段 join 一次。 */
const runGlyphs = /** @type {string[]} */[]

/**
 * 视口格内的平滑径向衰减（补偿终端格偏高）。
 * `sqrt` 前用平方距离剔除。
 * @param {number} dx 距光源列偏移
 * @param {number} dy 距光源行偏移
 * @param {number} radius 视觉半径
 * @returns {number} 0..1 强度
 */
export const lightFalloff = (dx, dy, radius = LIGHT_RADIUS) => {
	const d2 = dx * dx + 4 * dy * dy
	const r2 = radius * radius
	if (d2 >= r2) return 0
	const t = 1 - Math.sqrt(d2) / radius
	return t * t
}

/**
 * @param {number} c 通道 0..255
 * @param {number} lift 0..1+
 * @param {number} ambient 火炬变暗强度 0..1（0 = 仅涟漪提亮）
 * @returns {number} 提亮后通道
 */
const liftChannel = (c, lift, ambient) => {
	const t = lift > 1 ? 1 : lift
	if (!(ambient > 0)) {
		const hot = c + (255 - c) * 0.96
		return (c + (hot - c) * t) | 0
	}
	const hot = c + (255 - c) * 0.88
	const cold = c * (1 - (1 - LIGHT_AMBIENT) * ambient)
	return (cold + (hot - cold) * t) | 0
}

/**
 * @param {number} r 红
 * @param {number} g 绿
 * @param {number} b 蓝
 * @returns {string} 真彩前景 SGR
 */
const fgRgb = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`

/**
 * @param {number} r 红
 * @param {number} g 绿
 * @param {number} b 蓝
 * @returns {string} 真彩背景 SGR
 */
const bgRgb = (r, g, b) => `\x1b[48;2;${r};${g};${b}m`

/**
 * 调色板条目 + 提亮的量化真彩 SGR（带缓存）。
 * @param {string | null} f 调色板前景，或 null（仅背景辉光）
 * @param {number} lift 原始提亮
 * @param {number} ambient 火炬变暗强度 0..1
 * @returns {string | null} SGR，单元格保持空白时返回 null
 */
const litSgr = (f, lift, ambient) => {
	const glow = lift > 1 ? 1 : lift
	const liftQ = glow <= 0 ? 0 : Math.min(LIFT_Q - 1, (glow * (LIFT_Q - 1) + 0.5) | 0)
	const qLift = liftQ / (LIFT_Q - 1)
	const ambQ = ambient <= 0 ? 0 : Math.min(AMBIENT_Q - 1, (ambient * (AMBIENT_Q - 1) + 0.5) | 0)
	const qAmb = ambQ / (AMBIENT_Q - 1)
	const fgId = f == null ? FG_ID_UNKNOWN : FG_ID.get(f) ?? FG_ID_UNKNOWN
	const wantBg = f == null ? qLift >= 0.04 : qLift > 0.08
	if (f == null && !wantBg) return null
	const key = (ambQ << 12) | (fgId << 7) | (liftQ << 1) | (wantBg ? 1 : 0)
	let sgr = sgrCache.get(key)
	if (sgr !== undefined) return sgr

	if (f == null) {
		const g = (55 * qLift) | 0
		sgr = bgRgb((g * 0.55) | 0, (g * 0.75) | 0, g)
	}
	else {
		const rgbBase = FG_RGB[f]
		const rgb = fgRgb(
			liftChannel(rgbBase[0], qLift, qAmb),
			liftChannel(rgbBase[1], qLift, qAmb),
			liftChannel(rgbBase[2], qLift, qAmb),
		)
		if (wantBg) {
			const g = ((58 - 16 * qAmb) * qLift) | 0
			sgr = rgb + bgRgb((g * 0.5) | 0, (g * 0.7) | 0, g)
		}
		else sgr = rgb
	}
	sgrCache.set(key, sgr)
	return sgr
}

/**
 * 将同一 SGR 的字形段刷入 `parts`。
 * @param {string[]} parts ANSI 片段
 * @returns {void}
 */
const flushRun = (parts) => {
	const n = runGlyphs.length
	if (!n) return
	if (n === 1) parts.push(runGlyphs[0])
	else parts.push(runGlyphs.join(''))
	runGlyphs.length = 0
}

/**
 * 在调色板/真彩 SGR 下输出一格（`sgr === null` → 默认/空白）。
 * @param {string[]} parts ANSI 片段
 * @param {string | null} cur 当前打开的 SGR
 * @param {string | null} sgr 下一 SGR（null = 默认）
 * @param {string} glyph 字符
 * @param {boolean} [resetOnChange=false] 切换到非 null SGR 前先输出 RESET
 * @returns {string | null} 更新后的当前 SGR
 */
const emitCell = (parts, cur, sgr, glyph, resetOnChange = false) => {
	if (sgr == null) {
		if (cur !== null) {
			flushRun(parts)
			parts.push(RESET)
		}
		runGlyphs.push(glyph)
		return null
	}
	if (sgr !== cur) {
		flushRun(parts)
		if (resetOnChange && cur !== null) parts.push(RESET)
		parts.push(sgr)
	}
	runGlyphs.push(glyph)
	return sgr
}

/**
 * 将扁平 ch/fg 缓冲拼成无光照的 ANSI 帧字符串。
 * 同 SGR 字形按段 join，减少片段数。
 * @param {string[]} ch 字符
 * @param {(string | null)[]} fg ANSI 前景码（null = 默认）
 * @param {number} width 列数
 * @param {number} height 行数
 * @returns {string} ANSI 帧
 */
const renderPlain = (ch, fg, width, height) => {
	const parts = frameParts
	parts.length = 0
	runGlyphs.length = 0
	for (let y = 0; y < height; y++) {
		if (y) {
			flushRun(parts)
			parts.push('\n')
		}
		let cur = null
		const row = y * width
		for (let x = 0; x < width; x++) {
			const f = fg[row + x]
			const glyph = f == null ? ' ' : ch[row + x]
			cur = emitCell(parts, cur, f, glyph)
		}
		if (cur !== null) {
			flushRun(parts)
			parts.push(RESET)
		}
	}
	flushRun(parts)
	return parts.join('')
}

/**
 * 涟漪环在当前龄期的轴对齐包围垫（视口格）。
 * @param {number} age 涟漪龄
 * @returns {number} 半宽
 */
const ripplePad = (age) => ((age * RIPPLE_SPEED + RIPPLE_WIDTH) / 2) + 1

/**
 * 将扁平 ch/fg 缓冲拼成 ANSI 帧字符串。
 * 火炬：场景变暗并在圆形冷色聚光区提亮。
 * 涟漪：明亮扩散环、无环境变暗——仅在环附近采样。
 * @param {string[]} ch 字符
 * @param {(string | null)[]} fg ANSI 前景码（null = 默认）
 * @param {number} width 列数
 * @param {number} height 行数
 * @param {import('./gesture/light.mjs').LightGesture} [light] 指针光效手势
 * @returns {string} ANSI 帧
 */
export const renderBuffers = (ch, fg, width, height, light = null) => {
	const torchBlend = light?.torchBlend ?? 0
	const hasTorch = torchBlend > 0
	const ripples = light?.ripples
	const hasRipple = !!ripples?.length
	if (!hasTorch && !hasRipple) return renderPlain(ch, fg, width, height)

	const parts = frameParts
	parts.length = 0
	runGlyphs.length = 0
	const torchR2 = LIGHT_RADIUS * LIGHT_RADIUS
	// Far-cell ambient uses the same eased strength as sampleLight.
	const torchAmbient = hasTorch ? torchEase(torchBlend) : 0

	for (let y = 0; y < height; y++) {
		if (y) {
			flushRun(parts)
			parts.push('\n')
		}
		let cur = null
		const row = y * width
		for (let x = 0; x < width; x++) {
			const f = fg[row + x]
			let needSample = hasTorch
			if (!needSample && hasRipple)
				for (const ripple of ripples) {
					// Cell aspect: columns ≈ half a row visually → pad*2 on X.
					const pad = ripplePad(ripple.age)
					if (Math.abs(x - ripple.x) <= pad * 2 && Math.abs(y - ripple.y) <= pad) {
						needSample = true
						break
					}
				}

			if (!needSample) {
				const glyph = f == null ? ' ' : ch[row + x]
				cur = emitCell(parts, cur, f, glyph, true)
				continue
			}

			// Torch: skip hypot when far outside the disc (ambient still applies).
			if (hasTorch) {
				const dx = x - light.x
				const dy = y - light.y
				if (dx * dx + 4 * dy * dy >= torchR2 && !hasRipple) {
					const sgr = litSgr(f, 0, torchAmbient)
					if (sgr == null) {
						cur = emitCell(parts, cur, null, ' ', true)
						continue
					}
					cur = emitCell(parts, cur, sgr, f == null ? ' ' : ch[row + x], true)
					continue
				}
			}

			sampleLight(light, x, y, lightFalloff, sampleOut)
			const { ambient, lift } = sampleOut

			// Ripple-only cells far from the ring keep the plain palette.
			if (!(ambient > 0) && lift < 0.04) {
				const glyph = f == null ? ' ' : ch[row + x]
				cur = emitCell(parts, cur, f, glyph, true)
				continue
			}

			const sgr = litSgr(f, lift, ambient)
			if (sgr == null) {
				cur = emitCell(parts, cur, null, ' ', true)
				continue
			}
			cur = emitCell(parts, cur, sgr, f == null ? ' ' : ch[row + x], true)
		}
		if (cur !== null) {
			flushRun(parts)
			parts.push(RESET)
		}
	}
	flushRun(parts)
	return parts.join('')
}

/**
 * 薄适配：Cell[][] → 经 renderBuffers 的 ANSI 帧。
 * @param {({ ch?: string, fg?: string | null } | null)[][]} grid 行优先单元格
 * @param {number} width 列数
 * @param {number} height 行数
 * @returns {string} ANSI 帧
 */
export const renderGrid = (grid, width, height) => {
	const cells = width * height
	const ch = Array(cells)
	const fg = Array(cells)
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const cell = grid[y][x]
			const i = y * width + x
			ch[i] = cell?.ch ?? ' '
			fg[i] = cell?.fg ?? null
		}
	return renderBuffers(ch, fg, width, height)
}

/**
 * 软体边缘：生长前沿或收缩最小距离。
 * @param {boolean} softBody 启用软边
 * @param {number} d 体素距离
 * @param {number} bodyReach 生长前沿
 * @param {number} bodyMinD 收缩下限
 * @returns {boolean} 边缘格
 */
const isBodyEdge = (softBody, d, bodyReach, bodyMinD) => softBody && (
	(d === bodyReach && bodyReach < maxBodyD) ||
	(bodyMinD > 0 && d === bodyMinD)
)

/**
 * 从场景状态绘制一帧动画到复用缓冲。
 * 单次视口遍历写满每格（无预填）；柱体/粒子叠加。
 * @param {{
 *   world: import('./fluid/world.mjs').FluidWorld,
 *   width: number, height: number, iconOx: number, iconOy: number,
 *   softPillars: boolean, softBody: boolean, bodyReach: number, bodyMinD: number,
 *   pillars: number, frame: number,
 *   terrain: { solid: Uint8Array, surface: Int16Array, surfaceChar: string[], outline: (string | null)[] },
 *   light?: import('./gesture/light.mjs').LightGesture,
 *   frameCh?: string[], frameFg?: (string | null)[],
 * }} state 动画状态
 * @returns {string} ANSI 帧
 */
export const composeFrame = (state) => {
	const {
		world, width, height, iconOx, iconOy, softPillars, softBody,
		bodyReach, bodyMinD, pillars, frame, terrain, light,
	} = state
	const { ox, mat, liq, melt, temp, particles, condense, liqVx, liqVy, meltVx, meltVy, regionId, regions } = world
	const { solid, surface, surfaceChar, outline } = terrain
	const { worldW: W, worldH: H } = world
	const cells = width * height

	if (!state.frameCh || state.frameCh.length !== cells) {
		state.frameCh = Array(cells)
		state.frameFg = Array(cells)
	}
	const ch = state.frameCh
	const fg = state.frameFg

	for (let vy = 0; vy < height; vy++)
		for (let vx = 0; vx < width; vx++) {
			const i = vy * width + vx
			const wx = ox + vx
			if (wx < 0 || wx >= W || vy >= H) {
				ch[i] = ' '
				fg[i] = null
				continue
			}
			const wi = vy * W + wx
			const m = mat[wi]
			if (m === MAT.POOL) {
				ch[i] = '@'
				fg[i] = FG_AT
			}
			else if (m === MAT.SLOPE_R) {
				ch[i] = '>'
				fg[i] = FG_AT
			}
			else if (m === MAT.SLOPE_L) {
				ch[i] = '<'
				fg[i] = FG_AT
			}
			else if (m === MAT.BODY) {
				const lx = wx - iconOx
				const ly = vy - iconOy
				const d = ly >= 0 && ly < ICON_BODY_H && lx >= 0 && lx < ICON_W
					? BODY_DIST[ly * ICON_W + lx]
					: 255
				ch[i] = isBodyEdge(softBody, d, bodyReach, bodyMinD) ? '.' : '@'
				fg[i] = FG_AT
			}
			else if (melt[wi] >= LIQ_DRAW) {
				ch[i] = lavaChar(melt[wi], temp[wi], wx + vy + frame, meltVx[wi], meltVy[wi])
				fg[i] = lavaFg(temp[wi])
			}
			else if (liq[wi] >= LIQ_DRAW) {
				const by = vy + 1
				const bi = by * W + wx
				const falling = by >= H || (
					!isLiquidBarrier(mat[bi])
					&& mat[bi] !== MAT.POOL
					&& liq[bi] < LIQ_DRAW
					&& melt[bi] < LIQ_DRAW
				)
				ch[i] = liquidChar(liq[wi], wx + vy + frame, falling, liqVx[wi], liqVy[wi])
				fg[i] = FG_SPLASH
			}
			else {
				const rid = regionId[wi]
				const region = rid ? regions[rid] : null
				const bubble = region && !region.openToAtm && region.airCells >= BUBBLE_MIN_CELLS
					&& (
						(wx > 0 && melt[vy * W + wx - 1] >= LIQ_DRAW)
						|| (wx + 1 < W && melt[vy * W + wx + 1] >= LIQ_DRAW)
						|| (vy > 0 && melt[(vy - 1) * W + wx] >= LIQ_DRAW)
						|| (vy + 1 < H && melt[(vy + 1) * W + wx] >= LIQ_DRAW)
					)
				if (bubble) {
					ch[i] = 'o'
					fg[i] = FG_BUBBLE
				}
				else {
					const above = vy > 0 ? (vy - 1) * W + wx : -1
					if (above >= 0 && isSoilMat(mat[above]) && condense[above] >= COND_DRAW) {
						ch[i] = dripChar(condense[above], wx + frame)
						fg[i] = FG_SPLASH
					}
					else if (solid[wi] && vy === surface[wx]) {
						ch[i] = surfaceChar[wx] || '_'
						fg[i] = FG_TERRAIN
					}
					else if (solid[wi] && outline[wi]) {
						ch[i] = outline[wi]
						fg[i] = FG_TERRAIN
					}
					else {
						ch[i] = ' '
						fg[i] = null
					}
				}
			}
		}

	if (pillars > 0)
		for (const [lx, yTop, yBot] of PILLARS) {
			const h = yBot - yTop + 1
			const g = Math.min(pillars, h)
			for (let k = 0; k < g; k++) {
				const tip = softPillars && k === g - 1 && g < h
				const vx = iconOx - ox + lx
				const vy = iconOy + yBot - k
				if (vy < 0 || vy >= height) continue
				const glyph = tip ? '.' : ':'
				const color = tip ? FG_SPLASH : FG_COL
				if (vx >= 0 && vx < width) {
					const i = vy * width + vx
					ch[i] = glyph
					fg[i] = color
				}
				const vx2 = vx + 1
				if (vx2 >= 0 && vx2 < width) {
					const i = vy * width + vx2
					ch[i] = glyph
					fg[i] = color
				}
			}
		}

	for (let pi = 0; pi < particles.count; pi++) {
		const vx = (particles.x[pi] - ox) | 0
		const vy = particles.y[pi] | 0
		if (vy < 0 || vy >= height || vx < 0 || vx >= width) continue
		const i = vy * width + vx
		ch[i] = waterChar(particles.amt[pi], frame + vx, particles.vx[pi], particles.vy[pi])
		fg[i] = FG_SPLASH
	}

	return renderBuffers(ch, fg, width, height, light)
}
