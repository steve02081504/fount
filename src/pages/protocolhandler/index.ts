// Protocol handler for fount:// URLs
import { sendIPCCommand, testFountRunning } from "/base.mjs";

interface ProtocolCommand {
  command: string;
  args: string[];
}

function parseProtocolURL(url: string): ProtocolCommand | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "fount:") {
      return null;
    }
    
    // Parse the pathname to extract command and arguments
    const path = parsed.pathname.replace(/^\/+/, ""); // Remove leading slashes
    const parts = path.split("/");
    
    return {
      command: parts[0] || "",
      args: parts.slice(1)
    };
  } catch (error) {
    console.error("Failed to parse protocol URL:", error);
    return null;
  }
}

async function handleProtocolCommand(command: ProtocolCommand): Promise<void> {
  const messageElement = document.getElementById("message");
  
  try {
    // Check if the server is running
    if (!(await testFountRunning())) {
      if (messageElement) {
        messageElement.textContent = "Fount server is not running. Please start the server first.";
      }
      return;
    }

    if (messageElement) {
      messageElement.textContent = `Executing command: ${command.command}`;
    }

    // Send the command to the server
    const response = await sendIPCCommand({
      type: "execute",
      data: {
        command: command.command,
        args: command.args
      }
    });

    if (response.status === "ok") {
      if (messageElement) {
        messageElement.textContent = "Command executed successfully!";
      }
      // Optionally close the window after a delay
      setTimeout(() => {
        window.close();
      }, 2000);
    } else {
      throw new Error(response.error || "Unknown error");
    }
  } catch (error) {
    console.error("Failed to execute command:", error);
    if (messageElement) {
      messageElement.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

// Main initialization
async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const protocolUrl = urlParams.get("url");
  
  if (!protocolUrl) {
    const messageElement = document.getElementById("message");
    if (messageElement) {
      messageElement.textContent = "No protocol URL provided";
    }
    return;
  }

  const command = parseProtocolURL(protocolUrl);
  if (!command) {
    const messageElement = document.getElementById("message");
    if (messageElement) {
      messageElement.textContent = "Invalid protocol URL format";
    }
    return;
  }

  await handleProtocolCommand(command);
}

// Initialize when the DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}