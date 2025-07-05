// Character main file - updated to use relative import path
import { aiSourcesManager } from "../../../../src/server/managers/AIsources_manager.mjs";

// Character implementation
export default {
    name: "碧蓝航线NTR",
    
    async Load(args) {
        console.log(`Loading character: ${this.name}`);
        // Initialize character with provided arguments
        this.username = args.username;
        this.charname = args.charname;
        this.state = args.state;
    },

    interfaces: {
        config: {
            async GetData() {
                return {
                    name: "碧蓝航线NTR",
                    description: "A character for testing",
                    settings: {}
                };
            },

            async SetData(data) {
                // Save configuration data
                console.log(`Setting data for ${this.name}:`, data);
            }
        }
    }
};