import { useState, useEffect, useRef, useCallback } from 'react';
import vlcService from '../services/VlcService';
import type { VlcStatus, PlaylistItem } from '../services/VlcService';
import { parseYouTubeUrl, getYouTubeVideoUrl, getPlaylistVideos, isYouTubeUrl } from '../services/YouTubeParser';

interface MediaControlPanelProps {
    onBack: () => void;
}

function MediaControlPanel({ onBack }: MediaControlPanelProps) {
    const [status, setStatus] = useState<VlcStatus | null>(null);
    const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
    const [inputUrl, setInputUrl] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [vlcHost, setVlcHost] = useState(import.meta.env.VITE_VLC_HOST || 'http://localhost:8080');
    const [vlcPassword, setVlcPassword] = useState(import.meta.env.VITE_VLC_PASSWORD || '');

    const pollInterval = useRef<number | null>(null);

    // Fetch status from VLC
    const fetchStatus = useCallback(async () => {
        try {
            const newStatus = await vlcService.getStatus();
            setStatus(newStatus);
            setError(null);
        } catch (err) {
            setError('No se puede conectar a VLC');
        }
    }, []);

    // Fetch playlist
    const fetchPlaylist = useCallback(async () => {
        try {
            const items = await vlcService.getPlaylist();
            setPlaylist(items);
        } catch {
            // Ignore playlist errors
        }
    }, []);

    // Start polling
    useEffect(() => {
        fetchStatus();
        fetchPlaylist();

        pollInterval.current = window.setInterval(() => {
            fetchStatus();
            fetchPlaylist();
        }, 2000);

        return () => {
            if (pollInterval.current) {
                clearInterval(pollInterval.current);
            }
        };
    }, [fetchStatus, fetchPlaylist]);

    // Format time (seconds to mm:ss)
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Handle play/pause
    const handleTogglePlay = async () => {
        await vlcService.togglePlay();
        fetchStatus();
    };

    // Handle next/previous
    const handleNext = async () => {
        await vlcService.next();
        fetchStatus();
    };

    const handlePrevious = async () => {
        await vlcService.previous();
        fetchStatus();
    };

    // Handle volume change
    const handleVolumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const volume = parseInt(e.target.value);
        await vlcService.setVolume(volume);
    };

    // Handle seek
    const handleSeek = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const position = parseInt(e.target.value);
        await vlcService.seek(position);
    };

    // Handle fullscreen toggle
    const handleFullscreen = async () => {
        await vlcService.toggleFullscreen();
    };

    // Handle add/play media
    const handleAddMedia = async (playNow: boolean) => {
        if (!inputUrl.trim()) return;

        setIsLoading(true);
        setError(null);

        try {
            // Check if it's a YouTube URL
            if (isYouTubeUrl(inputUrl)) {
                const parsed = parseYouTubeUrl(inputUrl);

                if (parsed.type === 'playlist' && parsed.playlistId) {
                    // Fetch playlist videos
                    const videoIds = await getPlaylistVideos(parsed.playlistId);

                    if (videoIds.length === 0) {
                        setError('No se pudieron obtener los videos de la playlist');
                        return;
                    }

                    // Add all videos to queue
                    for (let i = 0; i < videoIds.length; i++) {
                        const videoUrl = getYouTubeVideoUrl(videoIds[i]);
                        if (i === 0 && playNow) {
                            await vlcService.playNow(videoUrl);
                        } else {
                            await vlcService.addToQueue(videoUrl);
                        }
                    }

                    setError(null);
                } else if (parsed.type === 'video' && parsed.videoId) {
                    const videoUrl = getYouTubeVideoUrl(parsed.videoId);
                    if (playNow) {
                        await vlcService.playNow(videoUrl);
                    } else {
                        await vlcService.addToQueue(videoUrl);
                    }
                } else {
                    setError('URL de YouTube no válida');
                    return;
                }
            } else {
                // Direct URL or file path
                if (playNow) {
                    await vlcService.playNow(inputUrl);
                } else {
                    await vlcService.addToQueue(inputUrl);
                }
            }

            setInputUrl('');
            fetchPlaylist();
        } catch (err) {
            setError('Error al agregar el contenido');
        } finally {
            setIsLoading(false);
        }
    };

    // Handle settings save
    const handleSaveSettings = () => {
        vlcService.configure(vlcHost, vlcPassword);
        setShowSettings(false);
        fetchStatus();
    };

    // Connection status indicator
    const ConnectionStatus = () => (
        <div className={`connection-status ${status?.isConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot"></span>
            {status?.isConnected ? 'Conectado' : 'Desconectado'}
        </div>
    );

    return (
        <div className="media-panel">
            <header className="media-header">
                <button className="back-btn" onClick={onBack}>← Volver</button>
                <h1>🎵 Control de Medios</h1>
                <button className="settings-btn" onClick={() => setShowSettings(!showSettings)}>⚙️</button>
            </header>

            {/* Settings panel */}
            {showSettings && (
                <div className="settings-panel card">
                    <h3>Configuración VLC</h3>
                    <div className="settings-form">
                        <label>
                            Host VLC:
                            <input
                                type="text"
                                className="input"
                                value={vlcHost}
                                onChange={(e) => setVlcHost(e.target.value)}
                                placeholder="http://192.168.1.100:8080"
                            />
                        </label>
                        <label>
                            Contraseña:
                            <input
                                type="password"
                                className="input"
                                value={vlcPassword}
                                onChange={(e) => setVlcPassword(e.target.value)}
                                placeholder="Contraseña de VLC"
                            />
                        </label>
                        <button className="btn btn-primary" onClick={handleSaveSettings}>
                            Guardar
                        </button>
                    </div>
                </div>
            )}

            {/* Connection status */}
            <ConnectionStatus />

            {/* Error message */}
            {error && (
                <div className="media-error">
                    ⚠️ {error}
                </div>
            )}

            {/* Now playing */}
            <div className="now-playing card">
                <div className="now-playing-label">Ahora suena:</div>
                <div className="now-playing-title">
                    {status?.title || 'Sin reproducción'}
                </div>
                {status?.artist && (
                    <div className="now-playing-artist">{status.artist}</div>
                )}

                {/* Progress bar */}
                <div className="progress-container">
                    <span className="time-label">{formatTime(status?.time || 0)}</span>
                    <input
                        type="range"
                        className="progress-slider"
                        min="0"
                        max={status?.length || 100}
                        value={status?.time || 0}
                        onChange={handleSeek}
                        disabled={!status?.isConnected}
                    />
                    <span className="time-label">{formatTime(status?.length || 0)}</span>
                </div>

                {/* Transport controls */}
                <div className="transport-controls">
                    <button
                        className="transport-btn"
                        onClick={handlePrevious}
                        disabled={!status?.isConnected}
                    >
                        ⏮
                    </button>
                    <button
                        className="transport-btn play-btn"
                        onClick={handleTogglePlay}
                        disabled={!status?.isConnected}
                    >
                        {status?.state === 'playing' ? '⏸' : '▶️'}
                    </button>
                    <button
                        className="transport-btn"
                        onClick={handleNext}
                        disabled={!status?.isConnected}
                    >
                        ⏭
                    </button>
                </div>

                {/* Volume control */}
                <div className="volume-container">
                    <span className="volume-icon">🔊</span>
                    <input
                        type="range"
                        className="volume-slider"
                        min="0"
                        max="100"
                        value={status?.volume || 0}
                        onChange={handleVolumeChange}
                        disabled={!status?.isConnected}
                    />
                    <span className="volume-value">{status?.volume || 0}%</span>
                </div>
            </div>

            {/* Fullscreen button */}
            <button
                className="btn btn-secondary fullscreen-btn"
                onClick={handleFullscreen}
                disabled={!status?.isConnected}
            >
                📺 Pantalla Completa en Proyector
            </button>

            {/* Add content */}
            <div className="add-content card">
                <h3>Agregar contenido</h3>
                <div className="add-content-form">
                    <input
                        type="text"
                        className="input"
                        value={inputUrl}
                        onChange={(e) => setInputUrl(e.target.value)}
                        placeholder="Pegar link de YouTube o ruta de archivo"
                        disabled={isLoading}
                    />
                    <div className="add-content-buttons">
                        <button
                            className="btn btn-secondary"
                            onClick={() => handleAddMedia(false)}
                            disabled={!inputUrl.trim() || isLoading || !status?.isConnected}
                        >
                            + Agregar a cola
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={() => handleAddMedia(true)}
                            disabled={!inputUrl.trim() || isLoading || !status?.isConnected}
                        >
                            ▶ Reproducir ahora
                        </button>
                    </div>
                </div>
            </div>

            {/* Playlist / Queue */}
            {playlist.length > 0 && (
                <div className="queue-section card">
                    <h3>Cola de reproducción ({playlist.length})</h3>
                    <div className="queue-list">
                        {playlist.map((item, index) => (
                            <div
                                key={item.id}
                                className={`queue-item ${item.current ? 'current' : ''}`}
                                onClick={() => vlcService.playPlaylistItem(item.id)}
                            >
                                <span className="queue-number">{index + 1}</span>
                                <span className="queue-name">{item.name}</span>
                                {item.current && <span className="queue-playing">▶</span>}
                            </div>
                        ))}
                    </div>
                    <button
                        className="btn btn-secondary clear-queue-btn"
                        onClick={() => vlcService.clearPlaylist()}
                    >
                        🗑 Limpiar cola
                    </button>
                </div>
            )}
        </div>
    );
}

export default MediaControlPanel;
