import { Router } from 'npm:websocket-express'

import { locale_t, info_t } from './basedefs.ts'

/** part_invoke 响应体（与 `part_invoke.mjs` 一致） */
export type PartInvokeResponse = { result?: unknown, error?: { message: string, code?: string } }

/**
 * Shell API 接口
 * @class shellAPI_t
 * 定义了 Shell 插件的 API 结构。
 */
export class shellAPI_t {
	/**
	 * Shell 插件的详细信息。
	 */
	info: info_t
	/**
	 * 初始化 Shell 插件。
	 * @returns {Promise<void>}
	 */
	Init?: () => Promise<void>
	/**
	 * 加载 Shell 插件。
	 * @param {object} args - 参数对象。
	 * @param {Router} args.router - WebSocket 路由。
	 * @returns {Promise<void>}
	 */
	Load?: (args: { router: Router }) => Promise<void>
	/**
	 * 卸载 Shell 插件。
	 * @param {object} args - 参数对象。
	 * @param {Router} args.router - WebSocket 路由。
	 * @returns {Promise<void>}
	 */
	Unload?: (args: { router: Router }) => Promise<void>
	/**
	 * 卸载 Shell 插件。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 卸载来源。
	 * @returns {Promise<void>}
	 */
	Uninstall?: (reason: string, from: string) => Promise<void>

	/**
	 * Shell 插件支持的接口。
	 */
	interfaces?: {
		/**
		 * 信息接口，用于更新 Shell 插件的信息。
		 */
		info?: {
			/**
			 * 更新 Shell 插件的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的 Shell 插件信息。
			 */
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		/**
		 * 配置接口，用于获取和设置配置数据。
		 */
		config?: {
			/**
			 * 获取配置数据。
			 * @returns {Promise<any>} - 配置数据。
			 */
			GetData: () => Promise<any>
			/**
			 * 设置配置数据。
			 * @param {any} data - 要设置的配置数据。
			 * @returns {Promise<void>}
			 */
			SetData: (data: any) => Promise<void>
		},
		/**
		 * 调用接口，用于处理参数和 IPC 调用。
		 */
		invokes?: {
			/**
			 * 参数处理程序。
			 * @param {string} user - 用户名。
			 * @param {string[]} args - 参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler?: (user: string, args: string[]) => Promise<void>;
			/**
			 * IPC 调用处理程序。
			 * @param {string} user - 用户名。
			 * @param {any} data - 数据。
			 * @returns {Promise<any>} - 调用结果。
			 */
			IPCInvokeHandler?: (user: string, data: any) => Promise<any>;
			/**
			 * 本 Part 处理 P2P part_invoke 入站（wire 载荷里的 partpath 决定 loadPart 目标；各 shell 各自实现）。
			 * @param {string} user - 用户名。
			 * @param {Record<string, unknown>} data - invoke 体。
			 * @param {{ requesterNodeHash?: string | null }} [ingress] - 联邦入站元数据。
			 * @returns {Promise<PartInvokeResponse | null>} - `{ result }` 成功；`{ error }` 或 throw 为失败；null 表示无 handler/不处理。
			 */
			P2PInvokeHandler?: (user: string, data: Record<string, unknown>, ingress?: { requesterNodeHash?: string | null }) => Promise<PartInvokeResponse | null>;
		}
	}
}
