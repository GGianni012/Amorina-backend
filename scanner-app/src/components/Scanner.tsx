import { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface ScannerProps {
    onLogout: () => void;
}

type ScanStatus = 'scanning' | 'valid' | 'error' | 'warning' | 'used';

interface ScanResult {
    status: ScanStatus;
    message: string;
    ticketInfo?: {
        movieTitle: string;
        showDateTime: string;
        userName: string;
        userEmail: string;
        ticketCode: string;
    };
}

// Decode QR payload (supports both new pipe format and legacy base64)
function decodePayload(encoded: string): ScanResult['ticketInfo'] | null {
    try {
        // New compact format: AMO|code|movie|datetime|name|email
        if (encoded.startsWith('AMO|')) {
            const parts = encoded.split('|');
            if (parts.length >= 6) {
                return {
                    ticketCode: parts[1],
                    movieTitle: parts[2],
                    showDateTime: parts[3],
                    userName: parts[4],
                    userEmail: parts[5],
                };
            }
        }

        // Legacy format: AMO:base64:checksum
        if (encoded.startsWith('AMO:')) {
            const parts = encoded.split(':');
            if (parts.length === 3) {
                const json = atob(parts[1]);
                const data = JSON.parse(json);
                return {
                    movieTitle: data.movieTitle,
                    showDateTime: data.showDateTime,
                    userName: data.userName,
                    userEmail: data.userEmail,
                    ticketCode: data.ticketCode,
                };
            }
        }

        return null;
    } catch {
        return null;
    }
}

// Format datetime for display
function formatDateTime(isoString: string): string {
    try {
        const date = new Date(isoString);
        return date.toLocaleDateString('es-AR', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return isoString;
    }
}

function Scanner({ onLogout }: ScannerProps) {
    const [scanResult, setScanResult] = useState<ScanResult | null>(null);
    const [isScanning, setIsScanning] = useState(true);
    const scannerRef = useRef<Html5QrcodeScanner | null>(null);
    const processedCodes = useRef<Set<string>>(new Set());

    // Validate ticket against backend
    const validateTicket = async (ticketCode: string): Promise<ScanResult> => {
        try {
            const apiUrl = import.meta.env.VITE_API_URL || '';

            if (!apiUrl) {
                // Demo mode - just decode and show as valid
                return {
                    status: 'warning',
                    message: 'Modo demo - API no configurada',
                };
            }

            const response = await fetch(`${apiUrl}/tickets-validate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ticketCode }),
            });

            const data = await response.json();

            return {
                status: data.status === 'VALID' ? 'valid' :
                    data.status === 'ALREADY_USED' ? 'used' : 'error',
                message: data.message,
                ticketInfo: data.ticketInfo,
            };
        } catch {
            return {
                status: 'error',
                message: 'Error de conexión con el servidor',
            };
        }
    };

    // Mark ticket as used
    const markAsUsed = async () => {
        if (!scanResult?.ticketInfo) return;

        try {
            const apiUrl = import.meta.env.VITE_API_URL || '';

            if (!apiUrl) {
                // Demo mode
                setScanResult({
                    status: 'valid',
                    message: '¡Entrada validada! (modo demo)',
                    ticketInfo: scanResult.ticketInfo,
                });
                return;
            }

            const response = await fetch(`${apiUrl}/tickets-use`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ticketCode: scanResult.ticketInfo.ticketCode }),
            });

            const data = await response.json();

            setScanResult({
                status: data.status === 'VALID' ? 'valid' : 'error',
                message: data.message || '¡Entrada validada correctamente!',
                ticketInfo: scanResult.ticketInfo,
            });
        } catch {
            setScanResult({
                status: 'error',
                message: 'Error al marcar entrada como usada',
                ticketInfo: scanResult.ticketInfo,
            });
        }
    };

    // Handle QR code scan
    const handleScan = async (decodedText: string) => {
        // Prevent processing same code multiple times
        if (processedCodes.current.has(decodedText)) {
            return;
        }
        processedCodes.current.add(decodedText);

        // Pause scanning
        setIsScanning(false);

        // Decode the QR payload
        const ticketInfo = decodePayload(decodedText);

        if (!ticketInfo) {
            setScanResult({
                status: 'error',
                message: 'Código QR no válido',
            });
            return;
        }

        // Validate against backend
        const result = await validateTicket(decodedText);
        setScanResult({
            ...result,
            ticketInfo,
        });
    };

    // Reset scanner to scan again
    const resetScanner = () => {
        setScanResult(null);
        setIsScanning(true);
        processedCodes.current.clear();
    };

    // Initialize scanner
    useEffect(() => {
        if (!isScanning) return;

        const scanner = new Html5QrcodeScanner(
            'qr-reader',
            {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1,
                supportedScanTypes: [],
                formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
                rememberLastUsedCamera: true,
            },
            false
        );

        scanner.render(
            (decodedText) => {
                handleScan(decodedText);
                scanner.clear();
            },
            () => {
                // Error callback - ignore scan failures
            }
        );

        scannerRef.current = scanner;

        return () => {
            scanner.clear().catch(() => { });
        };
    }, [isScanning]);

    const getStatusClass = () => {
        if (!scanResult) return '';
        switch (scanResult.status) {
            case 'valid': return 'result-valid';
            case 'used':
            case 'error': return 'result-error';
            case 'warning': return 'result-warning';
            default: return '';
        }
    };

    const getStatusBadge = () => {
        if (!scanResult) return null;
        switch (scanResult.status) {
            case 'valid': return <span className="badge badge-success">✓ Válido</span>;
            case 'used': return <span className="badge badge-error">✕ Ya usado</span>;
            case 'error': return <span className="badge badge-error">✕ Error</span>;
            case 'warning': return <span className="badge badge-warning">⚠ Atención</span>;
            default: return null;
        }
    };

    return (
        <div className="scanner-page">
            <header className="scanner-header">
                <h1>🎬 Amorina Scanner</h1>
                <button className="logout-btn" onClick={onLogout}>
                    Salir
                </button>
            </header>

            <main className="scanner-main">
                {isScanning ? (
                    <>
                        <div className="scanner-container">
                            <div id="qr-reader"></div>
                        </div>
                        <p style={{
                            textAlign: 'center',
                            marginTop: '1rem',
                            color: 'var(--color-text-secondary)'
                        }}>
                            Apuntá la cámara al código QR de la entrada
                        </p>
                    </>
                ) : (
                    <div className={`result-panel ${getStatusClass()}`}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h2>{scanResult?.message}</h2>
                            {getStatusBadge()}
                        </div>

                        {scanResult?.ticketInfo && (
                            <div className="ticket-info">
                                <div className="ticket-info-row">
                                    <span className="ticket-info-label">Película</span>
                                    <span className="ticket-info-value">{scanResult.ticketInfo.movieTitle}</span>
                                </div>
                                <div className="ticket-info-row">
                                    <span className="ticket-info-label">Función</span>
                                    <span className="ticket-info-value">
                                        {formatDateTime(scanResult.ticketInfo.showDateTime)}
                                    </span>
                                </div>
                                <div className="ticket-info-row">
                                    <span className="ticket-info-label">Nombre</span>
                                    <span className="ticket-info-value">{scanResult.ticketInfo.userName}</span>
                                </div>
                                <div className="ticket-info-row">
                                    <span className="ticket-info-label">Email</span>
                                    <span className="ticket-info-value">{scanResult.ticketInfo.userEmail}</span>
                                </div>
                                <div className="ticket-info-row">
                                    <span className="ticket-info-label">Código</span>
                                    <span className="ticket-info-value" style={{ fontFamily: 'monospace' }}>
                                        {scanResult.ticketInfo.ticketCode}
                                    </span>
                                </div>
                            </div>
                        )}

                        <div className="scan-actions">
                            {scanResult?.status === 'valid' && scanResult?.ticketInfo && (
                                <button className="btn btn-success" onClick={markAsUsed}>
                                    ✓ Validar entrada
                                </button>
                            )}
                            <button
                                className={`btn ${scanResult?.status === 'valid' ? 'btn-secondary' : 'btn-primary'}`}
                                onClick={resetScanner}
                            >
                                📷 Escanear otra
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default Scanner;
