/**
 * 混合逻辑时钟 (Hybrid Logical Clock)
 * 用于分布式系统中的事件排序
 */

/**
 * 混合逻辑时钟实例：由物理 wall 与 logical 计数组成。
 */
export class HLC {
	/**
	 * @param {number} [wall=0] - 物理时间戳（毫秒）
	 * @param {number} [logical=0] - 逻辑计数（同 wall 下递增）
	 */
	constructor(wall = 0, logical = 0) {
		this.wall = wall
		this.logical = logical
	}

	/**
	 * 创建当前时间的 HLC
	 * @returns {HLC} wall 为当前时间、logical 为 0 的实例
	 */
	static now() {
		return new HLC(Date.now(), 0)
	}

	/**
	 * 更新 HLC（接收到远程事件时）
	 * @param {HLC} remote - 远程 HLC
	 * @returns {HLC} 合并规则后的新 HLC 实例
	 */
	update(remote) {
		const localWall = Date.now()

		if (localWall > this.wall && localWall > remote.wall) 
			return new HLC(localWall, 0)
		

		if (this.wall === remote.wall) 
			return new HLC(this.wall, Math.max(this.logical, remote.logical) + 1)
		

		if (this.wall > remote.wall) 
			return new HLC(this.wall, this.logical + 1)
		

		return new HLC(remote.wall, remote.logical + 1)
	}

	/**
	 * 递增 HLC（本地生成新事件时）
	 * @returns {HLC} tick 后的新实例
	 */
	tick() {
		const localWall = Date.now()

		if (localWall > this.wall) 
			return new HLC(localWall, 0)
		

		return new HLC(this.wall, this.logical + 1)
	}

	/**
	 * 比较两个 HLC
	 * @param {HLC} other - 另一个 HLC
	 * @returns {number} 小于零、零或大于零（与 `this - other` 同号）
	 */
	compare(other) {
		if (this.wall !== other.wall) 
			return this.wall - other.wall
		
		return this.logical - other.logical
	}

	/**
	 * 转换为 JSON
	 * @returns {{ wall: number, logical: number }} 可序列化的纯对象
	 */
	toJSON() {
		return {
			wall: this.wall,
			logical: this.logical
		}
	}

	/**
	 * 从 JSON 创建 HLC
	 * @param {{ wall: number, logical: number }} json - JSON 对象
	 * @returns {HLC} 恢复的 HLC 实例
	 */
	static fromJSON(json) {
		return new HLC(json.wall, json.logical)
	}
}
