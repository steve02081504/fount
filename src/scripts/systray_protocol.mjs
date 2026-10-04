/**
 * 为 systray 的原生标准输出适配事件协议；原生诊断行不属于 JSON 事件。
 * @param {Function} SysTray - systray 导出的构造函数。
 * @returns {Function} 保留菜单和进程管理行为的构造函数。
 */
export function adaptSysTrayProtocol(SysTray) {
	return class extends SysTray {
		/**
		 * 注册托盘事件，忽略原生二进制混入标准输出的日志行。
		 * @param {string} type - 事件类型。
		 * @param {Function} listener - 事件处理函数。
		 * @returns {object} 当前托盘。
		 */
		onTrayEvent(type, listener) {
			this._rl.on('line', line => {
				if (/^DEBUG\s/.test(line)) return
				const action = JSON.parse(line)
				if (action.type === type) listener(action)
			})
			return this
		}

		/**
		 * 注册托盘就绪事件。
		 * @param {Function} listener - 就绪处理函数。
		 * @returns {object} 当前托盘。
		 */
		onReady(listener) { return this.onTrayEvent('ready', listener) }

		/**
		 * 注册托盘菜单点击事件。
		 * @param {Function} listener - 点击处理函数。
		 * @returns {object} 当前托盘。
		 */
		onClick(listener) { return this.onTrayEvent('clicked', listener) }
	}
}
