/**
 * Scans the local network to find a running Fount service
 * and returns the host URL if found, or null if not found.
 */
export async function getFountHostUrl() {
    console.log('[getFountHostUrl] Starting search for Fount host...')
    
    try {
        // Try to find Fount service on IPv4 network
        const hostUrl = await mapFountHostOnIPv4()
        
        if (hostUrl) {
            console.log(`[getFountHostUrl] Found Fount host: ${hostUrl}`)
            return hostUrl
        }
        
        console.warn('[getFountHostUrl] Could not determine Fount host URL. Returning initial hostUrl: null')
        return null
    } catch (error) {
        console.error('[getFountHostUrl] Error occurred while searching for Fount host:', error)
        return null
    }
}

/**
 * Maps and scans IPv4 local network for Fount service
 */
async function mapFountHostOnIPv4() {
    const port = 8931  // Default Fount service port
    
    // Get the current IP to determine the network range
    const baseIp = await getCurrentNetworkBase()
    
    if (!baseIp) {
        console.warn('[mapFountHostOnIPv4] Could not determine network base IP')
        return null
    }
    
    console.log(`[mapFountHostOnIPv4] Scanning network ${baseIp}.x:${port} for Fount service...`)
    
    const hostUrl = await scanLocalNetworkForFount(baseIp, port)
    
    if (!hostUrl) {
        console.warn(`[mapFountHostOnIPv4] Fount service not found for http://${baseIp}.0:${port}`)
    }
    
    return hostUrl
}

/**
 * Scans a range of IP addresses on the local network for Fount service
 */
async function scanLocalNetworkForFount(baseIp, port) {
    const promises = []
    
    // Scan common IP ranges (1-254)
    for (let i = 1; i <= 254; i++) {
        const ip = `${baseIp}.${i}`
        promises.push(checkFountService(ip, port))
    }
    
    try {
        // Wait for any service to respond
        const results = await Promise.allSettled(promises)
        
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
                return result.value
            }
        }
        
        console.warn(`[scanLocalNetworkForFount] Fount service not found on ${baseIp}.0, Port: ${port}`)
        return null
    } catch (error) {
        console.error('[scanLocalNetworkForFount] Error during network scan:', error)
        return null
    }
}

/**
 * Checks if Fount service is running on a specific IP and port
 */
async function checkFountService(ip, port) {
    const url = `http://${ip}:${port}/api/ping`
    
    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 2000) // 2 second timeout
        
        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            mode: 'cors'
        })
        
        clearTimeout(timeoutId)
        
        if (response.ok) {
            const hostUrl = `http://${ip}:${port}`
            console.log(`[checkFountService] Found Fount service at ${hostUrl}`)
            return hostUrl
        }
        
        return null
    } catch (error) {
        // Expected for most IPs that don't have Fount service
        return null
    }
}

/**
 * Attempts to determine the current network base IP
 */
async function getCurrentNetworkBase() {
    try {
        // Try to get network info from WebRTC if available
        if (typeof RTCPeerConnection !== 'undefined') {
            const ip = await getLocalIPFromWebRTC()
            if (ip) {
                const parts = ip.split('.')
                if (parts.length === 4) {
                    return `${parts[0]}.${parts[1]}.${parts[2]}`
                }
            }
        }
        
        // Fallback to common network ranges
        const commonNetworks = [
            '192.168.1',
            '192.168.0', 
            '192.168.2',
            '192.168.3',
            '10.0.0',
            '10.0.1',
            '172.16.0'
        ]
        
        // Return the first common network as fallback
        return commonNetworks[0]
    } catch (error) {
        console.warn('[getCurrentNetworkBase] Could not determine network base, using fallback')
        return '192.168.1'
    }
}

/**
 * Attempts to get local IP address using WebRTC
 */
function getLocalIPFromWebRTC() {
    return new Promise((resolve) => {
        try {
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            })
            
            pc.createDataChannel('')
            
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    const candidate = event.candidate.candidate
                    const match = candidate.match(/(\d+\.\d+\.\d+\.\d+)/)
                    if (match && !match[1].startsWith('127.')) {
                        pc.close()
                        resolve(match[1])
                    }
                }
            }
            
            pc.createOffer().then(offer => pc.setLocalDescription(offer))
            
            // Timeout after 3 seconds
            setTimeout(() => {
                pc.close()
                resolve(null)
            }, 3000)
        } catch (error) {
            resolve(null)
        }
    })
}