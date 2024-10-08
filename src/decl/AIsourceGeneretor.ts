import { AIsource_t } from "./AIsource"
import { locale_t } from "./basedefs";

export class AIsourceGeneretor {
	info: Record<locale_t, {
		name: string;
		avatar: string;
		description: string;
		description_markdown: string;
		version: string;
		author: string;
		homepage: string;
		issuepage: string;
		tags: string[];
	}>;

	Init: () => Promise<void>
	Load: () => Promise<void>
	Unload: () => Promise<void>
	Uninstall: () => Promise<void>
	GetSource: (config: any) => Promise<AIsource_t<any, any>>
}
