export class UserAPI_t {
	// calls only on install, and if fail, all file under this persona's folder will be deleted
	Init: () => {
		success: boolean;
		message: string;
	};
	// calls on every start, pop a message if fail
	Load: () => {
		success: boolean;
		message: string;
	};
	// calls on every unload
	Unload: (reason: string) => void;
	// calls on uninstall
	Uninstall: (reason: string, from: string) => void;

	getAvatar: () => string;
	getName: () => string;
	getPermpt: () => {
		content: string;
		extension: {};
	};
}
