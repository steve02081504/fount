/**
 * ANSI 调色板、熔岩色阶与真彩 SGR 缓存。
 */

/** ANSI 复位。 */
export const RESET = '\x1b[0m'
/** 主体 `@` 前景。 */
export const FG_AT = '\x1b[30m'
/** 水柱前景。 */
export const FG_COL = '\x1b[96m'
/** 水花前景。 */
export const FG_SPLASH = '\x1b[36m'
/** 地形轮廓前景。 */
export const FG_TERRAIN = '\x1b[90m'

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
/** 气泡前景。 */
export const FG_BUBBLE = '\x1b[38;2;40;20;15m'

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
export const lavaFg = (temp) => {
	const t = Math.min(0.999, Math.max(0, temp))
	return FG_LAVA[(t * FG_LAVA.length) | 0]
}

/** 真彩 SGR 复用的量化提亮档位。 */
const LIFT_Q = 32
/** 量化环境变暗强度档位（火炬渐隐）。 */
const AMBIENT_Q = 16
/** 火炬全亮时远离光标的单元格环境变暗量。 */
const LIGHT_AMBIENT = 0.3
/** 缓存的真彩 SGR 字符串：键 = 打包 (ambQ<<12)|(fgId<<7)|(liftQ<<1)|bgBit */
const sgrCache = new Map()

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
export const litSgr = (f, lift, ambient) => {
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

/** 共用同一 SGR 段的字形——每段 join 一次。 */
export const runGlyphs = /** @type {string[]} */[]

/**
 * 将同一 SGR 的字形段刷入 `parts`。
 * @param {string[]} parts ANSI 片段
 * @returns {void}
 */
export const flushRun = (parts) => {
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
export const emitCell = (parts, cur, sgr, glyph, resetOnChange = false) => {
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
