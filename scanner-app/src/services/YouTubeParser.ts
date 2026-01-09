// YouTube URL Parser
// Detects video/playlist URLs and extracts video IDs

export interface ParsedYouTubeUrl {
    type: 'video' | 'playlist' | 'invalid';
    videoId?: string;
    playlistId?: string;
}

/**
 * Parse YouTube URL to extract video or playlist ID
 */
export function parseYouTubeUrl(url: string): ParsedYouTubeUrl {
    try {
        const urlObj = new URL(url);

        // Handle youtu.be short links
        if (urlObj.hostname === 'youtu.be') {
            const videoId = urlObj.pathname.slice(1);
            const playlistId = urlObj.searchParams.get('list');

            return {
                type: playlistId ? 'playlist' : 'video',
                videoId: videoId || undefined,
                playlistId: playlistId || undefined,
            };
        }

        // Handle youtube.com URLs
        if (urlObj.hostname.includes('youtube.com')) {
            const videoId = urlObj.searchParams.get('v');
            const playlistId = urlObj.searchParams.get('list');

            // Check for /playlist path
            if (urlObj.pathname === '/playlist' && playlistId) {
                return {
                    type: 'playlist',
                    playlistId,
                };
            }

            // If has playlist param, treat as playlist
            if (playlistId) {
                return {
                    type: 'playlist',
                    videoId: videoId || undefined,
                    playlistId,
                };
            }

            // Single video
            if (videoId) {
                return {
                    type: 'video',
                    videoId,
                };
            }
        }

        return { type: 'invalid' };
    } catch {
        return { type: 'invalid' };
    }
}

/**
 * Get direct YouTube video URL for VLC
 */
export function getYouTubeVideoUrl(videoId: string): string {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Check if URL is a YouTube URL
 */
export function isYouTubeUrl(url: string): boolean {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.includes('youtube.com') || urlObj.hostname === 'youtu.be';
    } catch {
        return false;
    }
}

/**
 * Fetch playlist videos using YouTube Data API
 * Requires VITE_YOUTUBE_API_KEY environment variable
 */
export async function getPlaylistVideos(playlistId: string): Promise<string[]> {
    const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;

    if (!apiKey) {
        console.warn('YouTube API key not configured. Cannot fetch playlist.');
        return [];
    }

    const videoIds: string[] = [];
    let nextPageToken = '';

    try {
        do {
            const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
            url.searchParams.append('part', 'contentDetails');
            url.searchParams.append('playlistId', playlistId);
            url.searchParams.append('maxResults', '50');
            url.searchParams.append('key', apiKey);
            if (nextPageToken) {
                url.searchParams.append('pageToken', nextPageToken);
            }

            const response = await fetch(url.toString());

            if (!response.ok) {
                console.error('YouTube API error:', await response.text());
                break;
            }

            const data = await response.json();

            for (const item of data.items || []) {
                if (item.contentDetails?.videoId) {
                    videoIds.push(item.contentDetails.videoId);
                }
            }

            nextPageToken = data.nextPageToken || '';
        } while (nextPageToken && videoIds.length < 200); // Limit to 200 videos

        return videoIds;
    } catch (error) {
        console.error('Error fetching playlist:', error);
        return [];
    }
}
