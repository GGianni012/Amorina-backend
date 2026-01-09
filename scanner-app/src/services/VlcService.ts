// VLC HTTP API Service
// Communicates with VLC Media Player running with HTTP interface enabled

export interface VlcStatus {
    state: 'playing' | 'paused' | 'stopped';
    time: number; // current position in seconds
    length: number; // total duration in seconds
    volume: number; // 0-100 (will be converted from VLC's 0-512)
    title: string;
    artist?: string;
    isConnected: boolean;
}

export interface PlaylistItem {
    id: string;
    name: string;
    duration: number;
    current: boolean;
}

class VlcService {
    private baseUrl: string;
    private password: string;
    private authHeader: string;

    constructor() {
        // Will be configured from environment or settings
        this.baseUrl = import.meta.env.VITE_VLC_HOST || 'http://localhost:8080';
        this.password = import.meta.env.VITE_VLC_PASSWORD || '';
        // VLC uses empty username with password
        this.authHeader = 'Basic ' + btoa(':' + this.password);
    }

    /**
     * Configure VLC connection settings
     */
    configure(host: string, password: string) {
        this.baseUrl = host;
        this.password = password;
        this.authHeader = 'Basic ' + btoa(':' + password);
    }

    /**
     * Make authenticated request to VLC
     */
    private async request(endpoint: string, params?: Record<string, string>): Promise<any> {
        const url = new URL(`${this.baseUrl}/requests/${endpoint}`);
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                url.searchParams.append(key, value);
            });
        }

        try {
            const response = await fetch(url.toString(), {
                headers: {
                    'Authorization': this.authHeader,
                },
            });

            if (!response.ok) {
                throw new Error(`VLC request failed: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('VLC request error:', error);
            throw error;
        }
    }

    /**
     * Get current playback status
     */
    async getStatus(): Promise<VlcStatus> {
        try {
            const data = await this.request('status.json');

            // Extract title from metadata or filename
            let title = 'Sin reproducción';
            let artist = '';

            if (data.information?.category?.meta) {
                const meta = data.information.category.meta;
                title = meta.title || meta.filename || 'Desconocido';
                artist = meta.artist || '';
            }

            return {
                state: data.state || 'stopped',
                time: data.time || 0,
                length: data.length || 0,
                volume: Math.round((data.volume / 512) * 100), // VLC uses 0-512
                title,
                artist,
                isConnected: true,
            };
        } catch {
            return {
                state: 'stopped',
                time: 0,
                length: 0,
                volume: 0,
                title: '',
                isConnected: false,
            };
        }
    }

    /**
     * Toggle play/pause
     */
    async togglePlay(): Promise<void> {
        await this.request('status.json', { command: 'pl_pause' });
    }

    /**
     * Play
     */
    async play(): Promise<void> {
        await this.request('status.json', { command: 'pl_play' });
    }

    /**
     * Pause
     */
    async pause(): Promise<void> {
        const status = await this.getStatus();
        if (status.state === 'playing') {
            await this.request('status.json', { command: 'pl_pause' });
        }
    }

    /**
     * Stop playback
     */
    async stop(): Promise<void> {
        await this.request('status.json', { command: 'pl_stop' });
    }

    /**
     * Next track
     */
    async next(): Promise<void> {
        await this.request('status.json', { command: 'pl_next' });
    }

    /**
     * Previous track
     */
    async previous(): Promise<void> {
        await this.request('status.json', { command: 'pl_previous' });
    }

    /**
     * Set volume (0-100)
     */
    async setVolume(percent: number): Promise<void> {
        // Convert 0-100 to VLC's 0-512 scale
        const vlcVolume = Math.round((percent / 100) * 512);
        await this.request('status.json', { command: 'volume', val: vlcVolume.toString() });
    }

    /**
     * Seek to position in seconds
     */
    async seek(seconds: number): Promise<void> {
        await this.request('status.json', { command: 'seek', val: seconds.toString() });
    }

    /**
     * Seek relative (+ or - seconds)
     */
    async seekRelative(seconds: number): Promise<void> {
        const sign = seconds >= 0 ? '+' : '';
        await this.request('status.json', { command: 'seek', val: `${sign}${seconds}` });
    }

    /**
     * Add media to playlist queue
     */
    async addToQueue(uri: string): Promise<void> {
        await this.request('status.json', { command: 'in_enqueue', input: uri });
    }

    /**
     * Play media immediately
     */
    async playNow(uri: string): Promise<void> {
        await this.request('status.json', { command: 'in_play', input: uri });
    }

    /**
     * Toggle fullscreen
     */
    async toggleFullscreen(): Promise<void> {
        await this.request('status.json', { command: 'fullscreen' });
    }

    /**
     * Clear playlist
     */
    async clearPlaylist(): Promise<void> {
        await this.request('status.json', { command: 'pl_empty' });
    }

    /**
     * Get playlist contents
     */
    async getPlaylist(): Promise<PlaylistItem[]> {
        try {
            const data = await this.request('playlist.json');
            const items: PlaylistItem[] = [];

            // VLC playlist structure varies, try to parse it
            const parseNode = (node: any) => {
                if (node.children) {
                    node.children.forEach((child: any) => parseNode(child));
                }
                if (node.type === 'leaf' && node.name) {
                    items.push({
                        id: node.id?.toString() || '',
                        name: node.name,
                        duration: node.duration || 0,
                        current: node.current === 'current',
                    });
                }
            };

            if (data.children) {
                data.children.forEach((child: any) => parseNode(child));
            }

            return items;
        } catch {
            return [];
        }
    }

    /**
     * Play specific item in playlist by ID
     */
    async playPlaylistItem(id: string): Promise<void> {
        await this.request('status.json', { command: 'pl_play', id });
    }

    /**
     * Delete item from playlist
     */
    async deletePlaylistItem(id: string): Promise<void> {
        await this.request('status.json', { command: 'pl_delete', id });
    }
}

// Export singleton instance
export const vlcService = new VlcService();
export default vlcService;
