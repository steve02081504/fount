import { AIsource_t } from "./AIsource"
import { locale_t, info_t } from "./basedefs";

export class AIsourceGenerator {
	info: info_t | (locales: locale_t[]) => Promise<info_t>;

	Init: () => Promise<void>
	Load: () => Promise<void>
	Unload: () => Promise<void>
	Uninstall: () => Promise<void>
	GetSource: (config: any) => Promise<AIsource_t<any, any>>
	GetConfigTemplate: () => Promise<any>
}
