/**
 * 混合逻辑时钟 (Hybrid Logical Clock)
 * 用于分布式系统中的事件排序
 */

export class HLC {
	constructor(wall = 0, logical = 0) {
		this.wall = wall
		this.logical = logical
	}

	/**
	 * 创建当前时间的 HLC
	 * @returns {HLC}
	 */
	static now() {
		return new HLC(Date.now(), 0)
	}

	/**
	 * 更新 HLC（接收到远程事件时）
	 * @param {HLC} remote - 远程 HLC
	 * @returns {HLC}
	 */
	update(remote) {
		const localWall = Date.now()

		if (localWall > this.wall && localWall > remote.wall) {
			return new HLC(localWall, 0)
		}

		if (this.wall === remote.wall) {
			return new HLC(this.wall, Math.max(this.logical, remote.logical) + 1)
		}

		if (this.wall > remote.wall) {
			return new HLC(this.wall, this.logical + 1)
		}

		return new HLC(remote.wall, remote.logical + 1)
	}

	/**
	 * 递增 HLC（本地生成新事件时）
	 * @returns {HLC}
	 */
	tick() {
		const localWall = Date.now()

		if (localWall > this.wall) {
			return new HLC(localWall, 0)
		}

		return new HLC(this.wall, this.logical + 1)
	}

	/**
	 * 比较两个 HLC
	 * @param {HLC} other - 另一个 HLC
	 * @returns {number} -1, 0, 1
	 */
	compare(other) {
		if (this.wall !== other.wall) {
			return this.wall - other.wall
		}
		return this.logical - other.logical
	}

	/**
	 * 转换为 JSON
	 * @returns {object}
	 */
	toJSON() {
		return {
			wall: this.wall,
			logical: this.logical
		}
	}

	/**
	 * 从 JSON 创建 HLC
	 * @param {object} json - JSON 对象
	 * @returns {HLC}
	 */
	static fromJSON(json) {
		return new HLC(json.wall, json.logical)
	}
}
