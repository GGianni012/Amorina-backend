import { useState, type FormEvent } from 'react';

interface LoginProps {
    onLogin: (username: string, password: string) => boolean;
}

function Login({ onLogin }: LoginProps) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        // Small delay for UX
        await new Promise(resolve => setTimeout(resolve, 500));

        const success = onLogin(username, password);

        if (!success) {
            setError('Usuario o contraseña incorrectos');
        }

        setIsLoading(false);
    };

    return (
        <div className="login-page">
            <div className="login-card card">
                <div className="login-logo">🎬</div>

                <h1>Amorina Scanner</h1>
                <p style={{ color: 'var(--color-text-secondary)', marginTop: '0.5rem' }}>
                    Escáner de entradas para personal
                </p>

                <form className="login-form" onSubmit={handleSubmit}>
                    {error && (
                        <div className="login-error">
                            {error}
                        </div>
                    )}

                    <input
                        type="text"
                        className="input"
                        placeholder="Usuario"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoComplete="username"
                        required
                    />

                    <input
                        type="password"
                        className="input"
                        placeholder="Contraseña"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        required
                    />

                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={isLoading}
                    >
                        {isLoading ? 'Ingresando...' : 'Ingresar'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default Login;
