/**
 * 创建默认的宠物界面接口。
 * @param {import('../../../../../decl/charAPI.ts').CharAPI_t} charAPI - 角色 API 对象。
 * @param {string} ownerUsername - 所有者的用户名。
 * @param {string} charname - 角色的名称。
 * @returns {{GetPetConfig: () => Promise<{url: string, windowOptions: {width: number, height: number}}>}} 返回一个包含 GetPetConfig 方法的对象。
 */
export function createDefaultDeskpetInterface(charAPI, ownerUsername, charname) {
	return {
		/**
		 * @returns {Promise<{url: string, windowOptions: {width: number, height: number}}>} 返回一个包含宠物配置的 Promise。
		 */
		GetPetConfig: async () => ({
			// The shell's public directory is automatically served at /parts/shells/<shellname>:
			url: '/parts/shells:deskpet/default_pet.html',
			windowOptions: {
				width: 150,
				height: 150,
			}
		})
	}
}
