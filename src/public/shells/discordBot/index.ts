import { shellAPI_t } from "../../../decl/shellAPI.ts";
import { Router } from "npm:websocket-express";
import { locale_t, info_t } from "../../../decl/basedefs.ts";

export default class discordBotShell implements shellAPI_t {
    info: info_t = {
        name: "Discord Bot Shell",
        description: "Discord bot integration shell",
        version: "1.0.0",
        author: "Fount",
        homepage: "",
        license: "MIT"
    };

    async Init(): Promise<void> {
        // Initialize discord bot shell
        console.log("Discord Bot Shell: Initializing...");
    }

    async Load({ router }: { router: Router; }): Promise<void> {
        console.log("Discord Bot Shell: Loading routes...");
        
        const discordRouter = new Router();

        // Get bot configuration
        discordRouter.get('/getbotconfig', (req, res) => {
            try {
                const botname = req.query.botname as string;
                console.log(`Getting bot config for: ${botname}`);
                
                // Return mock configuration for now
                const config = {
                    botname: botname,
                    token: "",
                    status: "offline",
                    settings: {}
                };
                
                res.json(config);
            } catch (error) {
                console.error("Error getting bot config:", error);
                res.status(500).json({ error: "Failed to get bot configuration" });
            }
        });

        // Get running bot list
        discordRouter.get('/getrunningbotlist', (_req, res) => {
            try {
                console.log("Getting running bot list");
                
                // Return empty list for now
                const runningBots: any[] = [];
                
                res.json(runningBots);
            } catch (error) {
                console.error("Error getting running bot list:", error);
                res.status(500).json({ error: "Failed to get running bot list" });
            }
        });

        // Start bot
        discordRouter.post('/start', (req, res) => {
            try {
                const botData = req.body;
                console.log("Starting bot:", botData);
                
                // Mock bot start response
                res.json({ 
                    success: true, 
                    message: "Bot start request received",
                    botname: botData?.botname || "unknown"
                });
            } catch (error) {
                console.error("Error starting bot:", error);
                res.status(500).json({ error: "Failed to start bot" });
            }
        });

        // WebSocket connection
        discordRouter.ws('/', (ws, req) => {
            console.log("Discord Bot WebSocket connection established");
            
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message.toString());
                    console.log("Received WebSocket message:", data);
                    
                    // Echo back for now
                    ws.send(JSON.stringify({
                        type: "response",
                        data: data
                    }));
                } catch (error) {
                    console.error("Error processing WebSocket message:", error);
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Failed to process message"
                    }));
                }
            });

            ws.on('close', () => {
                console.log("Discord Bot WebSocket connection closed");
            });

            ws.on('error', (error) => {
                console.error("Discord Bot WebSocket error:", error);
            });

            // Send welcome message
            ws.send(JSON.stringify({
                type: "welcome",
                message: "Discord Bot WebSocket connected"
            }));
        });

        // Mount the discord router
        router.use('/api/shells/discordbot', discordRouter);
        console.log("Discord Bot Shell: Routes loaded successfully");
    }

    async Unload({ router }: { router: Router; }): Promise<void> {
        console.log("Discord Bot Shell: Unloading...");
        // Clean up routes if needed
    }

    async Uninstall(reason: string, from: string): Promise<void> {
        console.log(`Discord Bot Shell: Uninstalling - Reason: ${reason}, From: ${from}`);
        // Clean up any persistent data if needed
    }

    interfaces = {
        info: {
            UpdateInfo: async (locales: locale_t[]): Promise<info_t> => {
                // Update info based on locales if needed
                return this.info;
            }
        },
        config: {
            GetData: async (): Promise<any> => {
                // Return configuration data
                return {};
            },
            SetData: async (data: any): Promise<void> => {
                // Set configuration data
                console.log("Setting Discord Bot config data:", data);
            }
        },
        invokes: {
            ArgumentsHandler: async (user: string, args: string[]): Promise<void> => {
                console.log(`Discord Bot Arguments Handler - User: ${user}, Args:`, args);
            },
            IPCInvokeHandler: async (user: string, data: any): Promise<any> => {
                console.log(`Discord Bot IPC Invoke Handler - User: ${user}, Data:`, data);
                return { success: true };
            }
        }
    };
}