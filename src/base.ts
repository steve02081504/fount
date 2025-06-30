// Base utilities for Fount application
export interface IPCCommand {
  type: string;
  data: any;
}

export interface IPCResponse {
  status: "ok" | "error";
  data?: any;
  error?: string;
}

// Global utilities and functions that are shared across the application
export async function sendIPCCommand(command: IPCCommand, hostname = "localhost", port = 16698): Promise<IPCResponse> {
  try {
    const response = await fetch(`http://${hostname}:${port}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Utility function to test if the fount server is running
export async function testFountRunning(hostname = "localhost", port = 16698): Promise<boolean> {
  try {
    const response = await fetch(`http://${hostname}:${port}/ping`);
    const result = await response.json();
    return result.status === "ok";
  } catch {
    return false;
  }
}

// Initialize internationalization
export async function initI18n() {
  // Basic i18n setup - can be expanded later
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(element => {
    const key = element.getAttribute('data-i18n');
    if (key) {
      // For now, just use the key as fallback text
      element.textContent = key.split('.').pop() || key;
    }
  });
}

// Initialize the base module when loaded
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initI18n);
}