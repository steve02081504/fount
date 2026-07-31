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
	const { solid, surface, features, worldW: W, worldH: H } = terrain
	const { regions } = labelCavities(solid, surface, W, H)
	return {
		count: regions.length,
		sizes: regions.map(r => r.size).sort((a, b) => b - a),
		hasUTube: features.some(f => f.type === 'u_tube'),
		hasChamber: features.some(f => f.type === 'chamber' || f.type === 'neck'),
	}
}

/**
 * Rough periodicity check: surface should not look like a sine.
 * @param {Int16Array} surface surface rows
 * @returns {number} max |autocorr| for lags 4..12 (lower = less periodic)
 */
export function surfacePeriodicityScore(surface) {
	const W = surface.length
	let mean = 0
	for (let i = 0; i < W; i++) mean += surface[i]
	mean /= W
	let varSum = 0
	for (let i = 0; i < W; i++) varSum += (surface[i] - mean) ** 2
	if (varSum < 1e-6) return 1
	let maxCorr = 0
	for (let lag = 4; lag <= 12; lag++) {
		let c = 0
		for (let i = 0; i < W - lag; i++)
			c += (surface[i] - mean) * (surface[i + lag] - mean)
		maxCorr = Math.max(maxCorr, Math.abs(c / varSum))
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
	const vx0 = Math.max(0, ox)
	const vx1 = Math.min(surface.length, ox + viewW)
	let tall = 0
	for (let x = vx0; x < vx1; x++)
		if (viewH - surface[x] >= minThick) tall++
	return {
		tall,
		total: vx1 - vx0,
		fraction: vx1 - vx0 ? tall / (vx1 - vx0) : 0,
		minThick,
	}
}
