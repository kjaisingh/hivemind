import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { AuthContext } from './auth';

export function AuthProvider({ children }) {
  const [user, updateUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const setUser = useCallback((value) => {
    requestRef.current += 1;
    updateUser(value);
    setError('');
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const data = await api('/api/auth/me');
      if (requestId !== requestRef.current) return;
      updateUser(data.user);
      setError('');
    } catch (err) {
      if (requestId === requestRef.current) setError(err.message);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const expire = () => setUser(null);
    window.addEventListener('hivemind-session-expired', expire);
    return () => {
      requestRef.current += 1;
      window.removeEventListener('hivemind-session-expired', expire);
    };
  }, [refresh, setUser]);

  const value = useMemo(() => ({
    user,
    setUser,
    refresh,
    loading,
    error,
  }), [user, loading, error, refresh, setUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
