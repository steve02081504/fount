/** 材质枚举。 */
export const MAT = {
	AIR: 0,
	SOLID: 1,
	SLOPE_L: 2,
	SLOPE_R: 3,
	HORIZON: 4,
	POOL: 5,
	BODY: 6,
	/** 不透水屏障 — 无水分 / 渗漏（测试与密封容器）。 */
	SEAL: 7,
}

/** 材质分类位 — 一次 LUT 查表，替代多分支比较。 */
const MF_SOIL = 1
const MF_BLOCK = 2
const MF_LIQ_BARRIER = 4
const MAT_FLAGS = new Uint8Array([
	0, // AIR
	MF_SOIL | MF_BLOCK | MF_LIQ_BARRIER, // SOLID
	MF_BLOCK | MF_LIQ_BARRIER, // SLOPE_L
	MF_BLOCK | MF_LIQ_BARRIER, // SLOPE_R
	MF_SOIL | MF_BLOCK | MF_LIQ_BARRIER, // HORIZON
	MF_BLOCK, // POOL
	MF_BLOCK | MF_LIQ_BARRIER, // BODY
	MF_BLOCK | MF_LIQ_BARRIER, // SEAL
])

/** 大气参考压强（天空 / 开放区域均值）。 */
export const P_ATM = 1

/** 液体密度 × 重力 — 静水压头与液压势 φ（每物理长度单位）。 */
export const RHO_G = 1

/**
 * 气体密度，用于动态 / 伯努利压强 ½ρu²。
 * 与 ATM_HYDRO 同量级（g≈1 时每物理长度 ρ_air·g），使动压头远小于液柱。
 */
export const RHO_AIR = 0.02

/** 开放空气 / 密封腔体每向下一格（沿 ĝ）的静水压升；≈ RHO_AIR · g。 */
export const ATM_HYDRO = 0.018

/** 自由面铺展到干邻的 sheet 倍率（<1 → 聚珠；湿湿仍满 sheetMove）。 */
export const ST_DRY_FRAC = 0.4

/**
 * 邻格静压差 ΔP 驱动气体速度（格/ tick 每 ΔP）。
 * 按小 RHO_AIR 缩放；适度限制，避免宽通道产生虚假 uy。
 */
export const GAS_DP_DRIVE = 6

/** 土壤格可蓄水分上限。 */
export const SOIL_CAP = 1
/** 干土吸收自由液体的峰值速率（每 tick）。 */
export const SOIL_ABSORB_RATE = 0.015
/** 吸收速率随 `(1 - wetness) ** expo` 衰减。 */
export const SOIL_ABSORB_EXPO = 1.8
/** 雨/冲击命中时干土可吸收的最大比例。 */
export const SOIL_HIT_ABSORB_FRAC = 0.3
/** 侧向共享水分的比例。 */
export const SOIL_SIDE_FRAC = 0.04
/** 向下渗入下层土壤的水分比例。 */
export const SOIL_DOWN_FRAC = 0.06
/** 下方为空气时，底面凝结向土壤输送水分的比例。 */
export const SOIL_CONDENSE_FRAC = 0.06
/** 凝结量中绘制成悬挂水滴的部分。 */
export const COND_DRAW = 0.35
/** 凝结量 ≥ 此值时整滴落下。 */
export const COND_DRIP = 0.85
/**
 * 低于 COND_DRIP 的悬挂膜每 tick 渗出比例。
 * 否则 Matthew 把质量拆到多格、每格都卡在阈值下，碗状土地永远漏不干。
 */
export const COND_WEEP_FRAC = 0.08
/** 相邻凝结格之间的 Matthew 侧向传递速率。 */
export const COND_MATTHEW_RATE = 0.22
/** 打破凝结平局的噪声幅度（配对质量的比例）。 */
export const COND_MATTHEW_NOISE = 0.4

/** 自由液体绘制 / 空气区域占用的阈值。 */
export const LIQ_DRAW = 0.35

/** 每格自由液体质量上限。 */
export const LIQ_FULL = 1

/** 环境冷温（土地默认）。 */
export const T_AMB = 0
/** 固化线：低于此温度熔岩可凝固。 */
export const T_SOLIDUS = 0.35
/** 熔化线：高于此温度土壤熔化为熔岩。 */
export const T_LIQUIDUS = 0.55
/** 熔岩热源上限（下边贴边恒温）。 */
export const T_MAX = 1
/** 水闪蒸 / 土壤蒸发起点。 */
export const T_BOIL = 0.25

/** 冷岩密度（粘滞端）。 */
export const RHO_ROCK = 2.4
/** 最热熔岩密度。 */
export const RHO_LAVA_HOT = 1.15
/** 粘滞截断：≥ 此值视为固体、不流动。 */
export const VISC_SOLID = 0.92
/** 粘滞 ≤ 此值走惯性分支（气）。 */
export const VISC_INERTIAL = 0.02
/** 蒸汽泡最小可见气区格数。 */
export const BUBBLE_MIN_CELLS = 2
/** 气泡浮升所需邻接熔岩格数下限。 */
export const BUBBLE_MIN_MELT_CONTACT = 2
/** 下边曝露积分达到此值后涌岩浆（默认向下 13s × 24fps = 312）。 */
export const LAVA_ONSET_EXPOSURE = 312

/**
 * 物质种类（密度曲线索引）。
 * @enum {number}
 */
export const SUBSTANCE = {
	AIR: 0,
	WATER: 1,
	ROCK: 2,
}

/**
 * 温度 → 密度（同一标尺）。
 * @param {number} substance SUBSTANCE.*
 * @param {number} temp [0, 1]
 * @returns {number} rho
 */
export const rhoOf = (substance, temp) => {
	if (substance === SUBSTANCE.AIR) return RHO_AIR
	if (substance === SUBSTANCE.WATER) return RHO_G
	const t = Math.min(1, Math.max(0, temp))
	return RHO_LAVA_HOT + (RHO_ROCK - RHO_LAVA_HOT) * (1 - t)
}

/**
 * 密度 → 粘滞 [0, 1+]；越高越稠。
 * 水走低粘滞；岩/熔岩再热也高于水，保证熔岩 Stokes 增益更小、下落更慢。
 * @param {number} rho 密度
 * @returns {number} 粘滞
 */
export const viscOf = (rho) => {
	if (rho <= RHO_AIR * 2) return 0
	if (rho <= RHO_G) return 0.05
	const t = Math.min(1, Math.max(0, (rho - RHO_LAVA_HOT) / (RHO_ROCK - RHO_LAVA_HOT)))
	/** 最热熔岩粘滞下限（> 水）。 */
	const hot = 0.38
	return Math.min(1.2, hot + (1.05 - hot) * t * t)
}

/**
 * 粘滞是否达到固化截断。
 * @param {number} visc 粘滞
 * @returns {boolean} 固体
 */
export const isViscSolid = visc => visc >= VISC_SOLID

/**
 * 材质是否储存土壤水分（HORIZON / SOLID）。
 * @param {number} mat 材质 id
 * @returns {boolean} 是否为土壤
 */
export const isSoilMat = mat => !!(MAT_FLAGS[mat] & MF_SOIL)

/**
 * 材质是否阻挡气体泛洪填充 / 区域标记。
 * @param {number} mat 材质 id
 * @returns {boolean} 是否阻挡气体/泛洪
 */
export const isBlockMat = mat => !!(MAT_FLAGS[mat] & MF_BLOCK)

/**
 * 自由液体是否无法占据该格（固体 + BODY）。
 * @param {number} mat 材质 id
 * @returns {boolean} 是否为液体屏障
 */
export const isLiquidBarrier = mat => !!(MAT_FLAGS[mat] & MF_LIQ_BARRIER)

/**
 * [0, 1] 干土吸收因子 — 空土为 1，随水分趋满 → 0。
 * @param {number} moisture 当前水分
 * @returns {number} 因子
 */
export const soilAbsorbFactor = moisture =>
	(1 - Math.min(1, moisture / SOIL_CAP)) ** SOIL_ABSORB_EXPO
