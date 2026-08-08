/**
 * 雨/溅射粒子 SoA 池分配与质量统计。
 */

/** @typedef {{
 *   x: Float32Array, y: Float32Array,
 *   vx: Float32Array, vy: Float32Array,
 *   life: Float32Array, amt: Float32Array,
 *   count: number,
 * }} ParticlePool */

/** 粒子池默认容量。 */
export const PARTICLE_CAP = 1200

/**
 * 分配空粒子 SoA 池。
 * @param {number} [cap=PARTICLE_CAP] 容量
 * @returns {ParticlePool} 池
 */
export const createParticlePool = (cap = PARTICLE_CAP) => ({
	x: new Float32Array(cap),
	y: new Float32Array(cap),
	vx: new Float32Array(cap),
	vy: new Float32Array(cap),
	life: new Float32Array(cap),
	amt: new Float32Array(cap),
	count: 0,
})

/**
 * 清空粒子池。
 * @param {ParticlePool} pool 粒子池
 * @returns {void}
 */
export const clearParticlePool = (pool) => {
	pool.count = 0
}

/**
 * 池内粒子水质量总和。
 * @param {ParticlePool} pool 粒子池
 * @returns {number} amt 总量
 */
export const totalParticleWater = (pool) => {
	let t = 0
	for (let i = 0; i < pool.count; i++) t += pool.amt[i]
	return t
}

/**
 * 向池压入一粒子（满则跳过）。
 * @param {ParticlePool} pool 粒子池
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} vx 水平速度
 * @param {number} vy 垂直速度
 * @param {number} life 剩余帧
 * @param {number} amt 水质量
 * @returns {number} 写入索引，满则 -1
 */
export const pushParticle = (pool, x, y, vx, vy, life, amt) => {
	const i = pool.count
	if (i >= pool.x.length) return -1
	pool.x[i] = x
	pool.y[i] = y
	pool.vx[i] = vx
	pool.vy[i] = vy
	pool.life[i] = life
	pool.amt[i] = amt
	pool.count = i + 1
	return i
}
