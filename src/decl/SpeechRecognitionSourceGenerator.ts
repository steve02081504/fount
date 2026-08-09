import { locale_t, info_t } from './basedefs.ts'
import { SpeechRecognitionSource_t } from './SpeechRecognitionSource.ts'

/**
 * 语音识别数据源生成器接口。
 */
export class SpeechRecognitionSourceGenerator_t {
	info!: info_t

	Init?: () => Promise<void>
	Load?: () => Promise<void>
	Unload?: () => Promise<void>
	Uninstall?: () => Promise<void>

	interfaces!: {
		info?: {
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		config?: {
			GetData: () => Promise<any>
			SetData: (data: any) => Promise<void>
		},
		serviceGenerator: {
			GetConfigDisplayContent: () => Promise<{ html?: string, js?: string }>
			GetConfigTemplate: () => Promise<any>
			GetSource: (config: any, args: { username: string, SaveConfig: () => Promise<void> }) => Promise<SpeechRecognitionSource_t>
		}
	}
}
