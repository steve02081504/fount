import { parse } from "https://deno.land/std/flags/mod.ts";

const args = parse(Deno.args);

// Example implementation - replace with actual server logic
console.log("Starting Fount server...");

// Only create tray if --no-tray flag is not present
if (!args['no-tray']) {
    try {
        // This would be where the tray creation logic goes
        console.log("Creating system tray...");
        // createTray(); // Placeholder for actual tray creation
    } catch (error) {
        console.error("Failed to create tray:", error.message);
    }
} else {
    console.log("Skipping system tray creation (--no-tray flag present)");
}

// Add your actual server startup logic here
console.log("Server started successfully");