/**
 * Test-only terrain analysis helpers (compose over exported `labelCavities`).
 */
import { labelCavities, TALL_LAND_HEIGHT_FRAC } from '../terrain.mjs'

/**
 * Count underground air cavities.
 * @param {import('../terrain.mjs').TerrainData} terrain generated terrain bundle
 * @returns {{ count: number, sizes: number[], hasUTube: boolean, hasChamber: boolean }} cavity summary
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
 * Rough periodicity check: surface should not look like a sine.
 * @param {Int16Array} surface surface rows
 * @returns {number} max |autocorr| for lags 4..12 (lower = less periodic)
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
 * Tall-land coverage inside the viewport.
 * @param {import('../terrain.mjs').TerrainData} terrain generated terrain bundle
 * @param {{ viewH: number, viewW: number }} size view size
 * @returns {{ tall: number, total: number, fraction: number, minThick: number }} tall-column stats
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
