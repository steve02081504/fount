import { Buffer } from "node:buffer";
import { locale_t } from "./basedefs";

export class importHandlerAPI_t {
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
	// calls only on char install, and if fail, all file under this char's folder will be deleted
	Init: () => Promise<void>;
	// calls on every char start, pop a message if fail
	Load: () => Promise<void>;
	// calls on every char unload
	Unload: (reason: string) => Promise<void>;
	// calls on char uninstall
	Uninstall: (reason: string, from: string) => Promise<void>;

	ImportAsData: (username: string, chardata: Buffer) => Promise<void>;
	ImportByText: (username: string, text: string) => Promise<void>
}
