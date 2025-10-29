import { Router } from 'npm:websocket-express'

import { locale_t, info_t } from './basedefs'

/**
 * @class shellAPI_t
 * @description 定义了 Shell 插件的 API 结构。
 */
export class shellAPI_t {
	/**
	 * @description Shell 插件的详细信息。
	 */
	info: info_t
	/**
	 * @description 初始化 Shell 插件。
	 * @returns {Promise<void>}
	 */
	Init?: () => Promise<void>
	/**
	 * @description 加载 Shell 插件。
	 * @param {object} args - 参数对象。
	 * @param {Router} args.router - WebSocket 路由。
	 * @returns {Promise<void>}
	 */
	Load?: (args: { router: Router }) => Promise<void>
	/**
	 * @description 卸载 Shell 插件。
	 * @param {object} args - 参数对象。
	 * @param {Router} args.router - WebSocket 路由。
	 * @returns {Promise<void>}
	 */
	Unload?: (args: { router: Router }) => Promise<void>
	/**
	 * @description 卸载 Shell 插件。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 卸载来源。
	 * @returns {Promise<void>}
	 */
	Uninstall?: (reason: string, from: string) => Promise<void>

	/**
	 * @description Shell 插件支持的接口。
	 */
	interfaces?: {
		/**
		 * @description 信息接口，用于更新 Shell 插件的信息。
		 */
		info?: {
			/**
			 * @description 更新 Shell 插件的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的 Shell 插件信息。
			 */
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		/**
		 * @description 配置接口，用于获取和设置配置数据。
		 */
		config?: {
			/**
			 * @description 获取配置数据。
			 * @returns {Promise<any>} - 配置数据。
			 */
			GetData: () => Promise<any>
			/**
			 * @description 设置配置数据。
			 * @param {any} data - 要设置的配置数据。
			 * @returns {Promise<void>}
			 */
			SetData: (data: any) => Promise<void>
		},
		/**
		 * @description 调用接口，用于处理参数和 IPC 调用。
		 */
		invokes?: {
			/**
			 * @description 参数处理程序。
			 * @param {string} user - 用户名。
			 * @param {string[]} args - 参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler?: (user: string, args: string[]) => Promise<void>;
			/**
			 * @description IPC 调用处理程序。
			 * @param {string} user - 用户名。
			 * @param {any} data - 数据。
			 * @returns {Promise<any>} - 调用结果。
			 */
			IPCInvokeHandler?: (user: string, data: any) => Promise<any>;
		}
	}
}
