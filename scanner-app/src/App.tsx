import { useState, useEffect } from 'react';
import Login from './components/Login';
import Scanner from './components/Scanner';

// Simple auth state - in production would use proper session management
const AUTH_KEY = 'amorina_scanner_auth';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if already logged in
    const authToken = localStorage.getItem(AUTH_KEY);
    if (authToken) {
      // Verify token is still valid (simple check)
      try {
        const data = JSON.parse(atob(authToken));
        if (data.exp > Date.now()) {
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem(AUTH_KEY);
        }
      } catch {
        localStorage.removeItem(AUTH_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  const handleLogin = (username: string, password: string): boolean => {
    // Get credentials from environment or use defaults for demo
    const validUsername = import.meta.env.VITE_SCANNER_USERNAME || 'amorina';
    const validPassword = import.meta.env.VITE_SCANNER_PASSWORD || 'demo123';

    if (username === validUsername && password === validPassword) {
      // Create simple token
      const token = btoa(JSON.stringify({
        user: username,
        exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      }));
      localStorage.setItem(AUTH_KEY, token);
      setIsAuthenticated(true);
      return true;
    }
    return false;
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_KEY);
    setIsAuthenticated(false);
  };

  if (isLoading) {
    return (
      <div className="login-page">
        <div className="login-logo">🎬</div>
        <p style={{ color: 'var(--color-text-secondary)' }}>Cargando...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return <Scanner onLogout={handleLogout} />;
}

export default App;
