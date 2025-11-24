import fs from 'node:fs/promises'

import { setEndpoints } from './src/endpoints.mjs'

/**
 * 处理传入的导出动作请求。
 * @param {string} user - 用户名。
 * @param {string} action - 要执行的动作名称。
 * @param {object} params - 动作所需的参数。
 * @returns {Promise<any>} - 返回动作执行的结果。
 */
async function handleAction(user, action, params) {
	const { actions } = await import('./src/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

/**
 * 导出组件Shell
 */
export default {
	info: {
		'en-UK': {
			name: 'Export Part',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'A shell to export parts.',
			description_markdown: 'Allows you to export characters, personas, and worlds as files for backup or sharing.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['export', 'backup', 'sharing']
		},
		'zh-CN': {
			name: '导出组件',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: '用于导出部件的shell。',
			description_markdown: '允许您将角色、角色和世界导出为文件以进行备份或共享。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['导出', '备份', '共享']
		},
		'ar-SA': {
			name: 'مكونات التصدير',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'قذيفة لتصدير أجزاء.',
			description_markdown: 'يسمح لك بتصدير الشخصيات والشخصيات والعوالم كملفات للنسخ الاحتياطي أو المشاركة.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['تصدير', 'نسخ احتياطي', 'مشاركة']
		},
		'de-DE': {
			name: 'Part exportieren',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'Eine Shell zum Exportieren von Teilen.',
			description_markdown: 'Ermöglicht den Export von Charakteren, Personas und Welten als Dateien zur Sicherung oder Freigabe.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['exportieren', 'Sicherung', 'teilen']
		},
		emoji: {
			name: '📤💾',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: '🧩➡️📦',
			description_markdown: '🧩➡️📤➡️💾',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['📤', '💾', '📦']
		},
		'es-ES': {
			name: 'Exportar Parte',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'Un shell para exportar partes.',
			description_markdown: 'Le permite exportar personajes, personas y mundos como archivos para copia de seguridad o para compartir.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['exportar', 'copia de seguridad', 'compartir']
		},
		'fr-FR': {
			name: 'Exporter Pièce',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'Un shell pour exporter des pièces.',
			description_markdown: 'Vous permet d\'exporter des personnages, des personas et des mondes sous forme de fichiers pour la sauvegarde ou le partage.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['exporter', 'sauvegarde', 'partage']
		},
		'hi-IN': {
			name: 'पार्ट निर्यात करें',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'भागों को निर्यात करने के लिए एक खोल।',
			description_markdown: 'आपको बैकअप या साझा करने के लिए पात्रों, व्यक्तित्वों और दुनिया को फ़ाइलों के रूप में निर्यात करने की अनुमति देता है।',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['निर्यात', 'बैकअप', 'साझा करना']
		},
		'is-IS': {
			name: 'Útflutningshluta',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'Skél til að flytja út hluta.',
			description_markdown: 'Gerir þér kleift að flytja út stafi, persónur og heima sem skrár til öryggisafritunar eða samnýtingar.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['flytja út', 'öryggisafrit', 'deila']
		},
		'it-IT': {
			name: 'Esporta Parte',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'Una shell per esportare le parti.',
			description_markdown: 'Consente di esportare personaggi, personaggi e mondi come file per il backup o la condivisione.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['esportare', 'backup', 'condivisione']
		},
		'ja-JP': {
			name: 'パートをエクスポート',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'パーツをエクスポートするためのシェル。',
			description_markdown: 'キャラクター、ペルソナ、ワールドをバックアップまたは共有用のファイルとしてエクスポートできます。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['エクスポート', 'バックアップ', '共有']
		},
		'ko-KR': {
			name: '파트 내보내기',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: '부품을 내보내는 셸입니다.',
			description_markdown: '백업 또는 공유를 위해 캐릭터, 페르소나 및 세계를 파일로 내보낼 수 있습니다.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['내보내기', '백업', '공유']
		},
		lzh: {
			name: '謄錄司',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: '謄錄法寶，以備不虞。',
			description_markdown: '許君謄錄化身、身分及世界為卷帙，或藏之名山，或傳之同好。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['謄錄', '封存', '傳世']
		},
		'nl-NL': {
			name: 'Exporteren componenten',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'Een shell om onderdelen te exporteren.',
			description_markdown: 'Hiermee kunt u personages, persona\'s en werelden exporteren als bestanden voor back-up of delen.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['exporteren', 'back-up', 'delen']
		},
		'pt-PT': {
			name: 'Exportar Parte',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'Um shell para exportar peças.',
			description_markdown: 'Permite exportar personagens, personas e mundos como arquivos para backup ou compartilhamento.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['exportar', 'backup', 'compartilhamento']
		},
		'ru-RU': {
			name: 'Экспортировать часть',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'Оболочка для экспорта деталей.',
			description_markdown: 'Позволяет экспортировать персонажей, персонажей и миры в виде файлов для резервного копирования или совместного использования.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['экспорт', 'резервное копирование', 'обмен']
		},
		'uk-UA': {
			name: 'Експортні компоненти',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'Оболонка для експорту деталей.',
			description_markdown: 'Дозволяє експортувати персонажів, персон та світів у вигляді файлів для резервного копіювання або спільного використання.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['експорт', 'резервне копіювання', 'обмін']
		},
		'vi-VN': {
			name: 'Xuất bộ phận',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: 'Một trình bao để xuất các bộ phận.',
			description_markdown: 'Cho phép bạn xuất các nhân vật, nhân vật và thế giới dưới dạng tệp để sao lưu hoặc chia sẻ.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['xuất', 'sao lưu', 'chia sẻ']
		},
		'zh-TW': {
			name: '導出組件',
			avatar: 'https://api.iconify.design/material-symbols/export-notes-outline.svg',
			description: '用於導出組件的shell。',
			description_markdown: '允許您將角色、角色和世界導出為文件以進行備份或共享。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['導出', '備份', '共享']
		}
	},
	/**
	 * 加载导出组件Shell并设置API端点。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express的路由实例。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		invokes: {
			/**
			 * 处理命令行参数以执行导出操作。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				const [partType, partName, withDataStr, outputPath] = args
				const withData = withDataStr === 'true'
				const params = { partType, partName, withData }

				const { buffer, format } = await handleAction(user, 'default', params)
				const finalOutputPath = outputPath || `${partName}${withData ? '_with_data' : ''}.${format}`
				await fs.writeFile(finalOutputPath, buffer)
				console.log(`Part '${partName}' exported to ${finalOutputPath}`)
			},
			/**
			 * 处理IPC调用以执行导出操作。
			 * @param {string} user - 用户名。
			 * @param {object} data - 从IPC接收的数据对象。
			 * @returns {Promise<any>} - 动作执行结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				return handleAction(user, 'default', data)
			}
		}
	}
}
