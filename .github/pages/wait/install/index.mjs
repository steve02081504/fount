// Mock implementation of getFountHostUrl since the actual implementation isn't available
async function getFountHostUrl() {
    // This function would normally scan the local network for Fount service
    // For now, return null to simulate service discovery failure
    console.warn('[getFountHostUrl] Could not determine Fount host URL. Returning initial hostUrl: null');
    return null;
}

// Mock i18n function
function geti18n(key) {
    const translations = {
        'installer_wait_screen.footer.open_fount': 'Open Fount',
        'installer_wait_screen.footer.launch_button': 'Launch'
    };
    return translations[key] || key;
}

// Main initialization
document.addEventListener('DOMContentLoaded', async () => {
    const launchButton = document.getElementById('launchButton');
    const launchButtonSpinner = document.getElementById('launchButtonSpinner');
    const launchButtonText = document.getElementById('launchButtonText');
    const manualConnection = document.getElementById('manual-connection');
    const manualUrl = document.getElementById('manual-url');
    const connectButton = document.getElementById('connect-button');
    const connectionError = document.getElementById('connection-error');

    if (!launchButton || !launchButtonSpinner || !launchButtonText) {
        console.error('Required UI elements not found');
        return;
    }

    launchButton.onclick = async () => {
        launchButtonSpinner.style.display = 'inline-block';
        const hostUrl = await getFountHostUrl();

        if (hostUrl) {
            launchButtonText.textContent = geti18n('installer_wait_screen.footer.open_fount');
            launchButton.onclick = () => window.location.href = new URL('/shells/home', hostUrl);
        } else {
            // Show manual connection UI when automatic discovery fails
            launchButton.classList.add('hidden');
            manualConnection.classList.remove('hidden');
            manualConnection.classList.add('flex');
        }
        launchButtonSpinner.style.display = 'none';
    };

    // Manual connection logic
    connectButton.addEventListener('click', async () => {
        const url = manualUrl.value.trim();
        
        // Hide any previous error
        connectionError.classList.add('hidden');
        
        // Basic URL validation
        if (!url) {
            connectionError.textContent = 'Please enter a URL';
            connectionError.classList.remove('hidden');
            return;
        }

        let normalizedUrl;
        try {
            // Add protocol if missing
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                normalizedUrl = 'http://' + url;
            } else {
                normalizedUrl = url;
            }
            
            // Validate URL format
            new URL(normalizedUrl);
        } catch (e) {
            connectionError.textContent = 'Invalid URL format';
            connectionError.classList.remove('hidden');
            return;
        }

        // Show loading state
        connectButton.disabled = true;
        connectButton.textContent = 'Connecting...';

        try {
            // Test connection to Fount service
            const testUrl = new URL('/api/ping', normalizedUrl);
            const response = await fetch(testUrl, {
                method: 'GET',
                mode: 'cors',
                timeout: 5000
            });

            if (response.ok) {
                // Connection successful, redirect to Fount
                window.location.href = new URL('/shells/home', normalizedUrl);
            } else {
                throw new Error('Service not responding');
            }
        } catch (error) {
            console.error('Connection failed:', error);
            connectionError.textContent = 'Could not connect. Check URL.';
            connectionError.classList.remove('hidden');
        } finally {
            // Reset button state
            connectButton.disabled = false;
            connectButton.textContent = 'Connect';
        }
    });

    // Allow Enter key to trigger connection
    manualUrl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            connectButton.click();
        }
    });
});