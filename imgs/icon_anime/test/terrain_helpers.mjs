/**
 * 仅测试用地形分析辅助（基于导出的 `labelCavities` 组合）。
 */
import { labelCavities, TALL_LAND_HEIGHT_FRAC } from '../terrain/index.mjs'

/**
 * 统计地下空气腔体。
 * @param {import('../terrain/index.mjs').TerrainData} terrain 已生成地形包
 * @returns {{ count: number, sizes: number[], hasUTube: boolean, hasChamber: boolean }} 腔体摘要
 */
export function analyzeTerrain(terrain) {
	const { solid, surface, features, worldW: width, worldH: height } = terrain
	const { regions } = labelCavities(solid, surface, width, height)
	return {
		count: regions.length,
		sizes: regions.map(region => region.size).sort((firstSize, secondSize) => secondSize - firstSize),
		hasUTube: features.some(feature => feature.type === 'u_tube'),
		hasChamber: features.some(feature => feature.type === 'chamber' || feature.type === 'neck'),
	}
}

/**
 * 粗略周期性检测：地表不应像正弦波。
 * @param {Int16Array} surface 地表行
 * @returns {number} 滞后 4..12 的最大 |自相关|（越低越不周期）
 */
export function surfacePeriodicityScore(surface) {
	const width = surface.length
	let mean = 0
	for (let index = 0; index < width; index++) mean += surface[index]
	mean /= width
	let varSum = 0
	for (let index = 0; index < width; index++) varSum += (surface[index] - mean) ** 2
	if (varSum < 1e-6) return 1
	let maxCorr = 0
	for (let lag = 4; lag <= 12; lag++) {
		let correlation = 0
		for (let index = 0; index < width - lag; index++)
			correlation += (surface[index] - mean) * (surface[index + lag] - mean)
		maxCorr = Math.max(maxCorr, Math.abs(correlation / varSum))
	}
	return maxCorr
}

/**
 * 视口内高陆覆盖率。
 * @param {import('../terrain/index.mjs').TerrainData} terrain 已生成地形包
 * @param {{ viewH: number, viewW: number }} size 视口尺寸
 * @returns {{ tall: number, total: number, fraction: number, minThick: number }} 高列统计
 */
export function tallLandCoverage(terrain, { viewH, viewW }) {
	const { surface, ox } = terrain
	const minThick = Math.max(1, Math.ceil(viewH * TALL_LAND_HEIGHT_FRAC))
	const viewportStart = Math.max(0, ox)
	const viewportEnd = Math.min(surface.length, ox + viewW)
	let tall = 0
	for (let x = viewportStart; x < viewportEnd; x++)
		if (viewH - surface[x] >= minThick) tall++
	return {
		tall,
		total: viewportEnd - viewportStart,
		fraction: viewportEnd - viewportStart ? tall / (viewportEnd - viewportStart) : 0,
		minThick,
	}
}
