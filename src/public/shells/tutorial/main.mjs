import info from './info.json' assert { type: 'json' };
/** @typedef {import('../../../decl/basedefs.ts').info_t} info_t */

/**
 * 教程 shell 的入口点。
 */
export default {
	/**
	 * Shell 的信息。
	 * @type {info_t}
	 */
	info,
	/**
			 * 加载 shell。
	 * @param {object} options - 选项。
	 * @param {object} options.router - 路由。
	 */
	Load: async ({ router }) => { },
	/**
			 * 卸载 shell。
	 */
	Unload: async () => { },
}
