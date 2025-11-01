import { Buffer } from 'node:buffer'

import { locale_t, info_t } from './basedefs.ts'

/**
 * @class importHandlerAPI_t
 * 定义了导入处理器的 API 结构，用于处理角色数据的导入和管理。
 */
export class importHandlerAPI_t {
	/**
	 * 导入处理器的详细信息。
	 */
	info: info_t
	/**
	 * 在安装角色时调用，如果失败，将删除该角色文件夹下的所有文件。
	 * @returns {Promise<void>}
	 */
	Init?: () => Promise<void>
	/**
	 * 在每次启动角色时调用，如果失败，将弹出消息。
	 * @returns {Promise<void>}
	 */
	Load?: () => Promise<void>
	/**
	 * 在每次卸载角色时调用。
	 * @param {string} reason - 卸载原因。
	 * @returns {Promise<void>}
	 */
	Unload?: (reason: string) => Promise<void>
	/**
	 * 在卸载角色时调用。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 卸载来源。
	 * @returns {Promise<void>}
	 */
	Uninstall?: (reason: string, from: string) => Promise<void>

	/**
	 * 导入处理器支持的接口。
	 */
	interfaces: {
		/**
		 * 信息接口，用于更新导入处理器的信息。
		 */
		info?: {
			/**
			 * 更新导入处理器的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的导入处理器信息。
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
		 * 导入接口，用于导入角色数据。
		 */
		import: {
			/**
			 * 将二进制数据作为角色数据导入。
			 * @param {string} username - 用户名。
			 * @param {Buffer} chardata - 角色数据。
			 * @returns {Promise<Array<{ parttype: string; partname: string }>>} - 导入的部分信息数组。
			 */
			ImportAsData: (username: string, chardata: Buffer) => Promise<Array<{ parttype: string; partname: string }>>;
			/**
			 * 将文本作为角色数据导入。
			 * @param {string} username - 用户名。
			 * @param {string} text - 角色数据的文本表示。
			 * @returns {Promise<Array<{ parttype: string; partname: string }>>} - 导入的部分信息数组。
			 */
			ImportByText: (username: string, text: string) => Promise<Array<{ parttype: string; partname: string }>>;
		}
	}
}
