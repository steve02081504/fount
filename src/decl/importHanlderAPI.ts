import { Buffer } from "node:buffer";
import { locale_t } from "./basedefs";

export class importHanlderAPI_t {
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
	Init: () => void;
	// calls on every char start, pop a message if fail
	Load: () => void;
	// calls on every char unload
	Unload: (reason: string) => void;
	// calls on char uninstall
	Uninstall: (reason: string, from: string) => void;

	ImportAsData: (username: string, chardata: Buffer) => Promise<void>;
	ImportByText: (username: string, text: string) => Promise<void>
}
