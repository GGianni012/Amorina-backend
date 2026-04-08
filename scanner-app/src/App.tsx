import { useState } from 'react';
import './App.css';
import Login from './components/Login';
import Scanner from './components/Scanner';

// Simple staff credentials
const STAFF_CREDENTIALS: Record<string, string> = {
    staff: 'aquilea57',
    admin: 'aquilea57',
};

function App() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);

    const handleLogin = (username: string, password: string): boolean => {
        const expected = STAFF_CREDENTIALS[username.toLowerCase()];
        if (expected && expected === password) {
            setIsLoggedIn(true);
            return true;
        }
        return false;
    };

    const handleLogout = () => {
        setIsLoggedIn(false);
    };

    if (!isLoggedIn) {
        return <Login onLogin={handleLogin} />;
    }

    return <Scanner onLogout={handleLogout} />;
}

export default App;
