/**
 * 从场景状态绘制一帧到复用缓冲并渲染 ANSI。
 */

import { waterChar, liquidChar, dripChar, lavaChar } from '../fluid/glyphs.mjs'
import {
	MAT, LIQ_DRAW, BUBBLE_MIN_CELLS, isLiquidBarrier,
} from '../fluid/mat.mjs'
import { condenseDripSource } from '../fluid/soil.mjs'
import { strongestDown, gravityUpWeights } from '../fluid/world.mjs'
import { ICON_W, ICON_BODY_H, PILLARS, BODY_DIST, maxBodyD } from '../icon.mjs'

import {
	FG_AT, FG_COL, FG_SPLASH, FG_TERRAIN, FG_BUBBLE, lavaFg,
} from './palette.mjs'
import { renderBuffers } from './render.mjs'

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
 * @param {import('../scene/index.mjs').AnimState} state 动画状态
 * @returns {string} ANSI 帧
 */
export const composeFrame = (state) => {
	const {
		world, width, height, iconOx, iconOy, softPillars, softBody,
		bodyReach, bodyMinD, pillars, frame, terrain, light,
	} = state
	const { ox, mat, liq, melt, temp, particles, condense, liqVx, liqVy, meltVx, meltVy, regionId, regions, gravity } = world
	const { solid, surface, surfaceChar, outline } = terrain
	const { worldW: W, worldH: H } = world
	const { gx, gy } = gravity
	const cells = width * height
	const gDown = strongestDown(world)
	const gUp = gravityUpWeights(world)

	/**
	 * 重力下格无支撑 → 下落字形提示。
	 * @param {number} wx 世界列
	 * @param {number} wy 世界行
	 * @returns {boolean} 是否下落
	 */
	const unsupportedDown = (wx, wy) => {
		if (gDown.w <= 0) return false
		const bx = wx + gDown.dx
		const by = wy + gDown.dy
		if (bx < 0 || by < 0 || bx >= W || by >= H) return true
		const bi = by * W + bx
		return !isLiquidBarrier(mat[bi])
			&& mat[bi] !== MAT.POOL
			&& liq[bi] < LIQ_DRAW
			&& melt[bi] < LIQ_DRAW
	}

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
				ch[i] = lavaChar(melt[wi], wx + vy + frame, meltVx[wi], meltVy[wi], unsupportedDown(wx, vy), gx, gy)
				fg[i] = lavaFg(temp[wi])
			}
			else if (liq[wi] >= LIQ_DRAW) {
				ch[i] = liquidChar(liq[wi], wx + vy + frame, unsupportedDown(wx, vy), liqVx[wi], liqVy[wi], gx, gy)
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
					const dripSoil = condenseDripSource(world, wx, vy, gUp)
					if (dripSoil >= 0) {
						ch[i] = dripChar(condense[dripSoil], wx + frame)
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
