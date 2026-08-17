import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState({ msg: '', type: 'info', visible: false });

  const showToast = useCallback((msg, type = 'info') => {
    if (!msg) {
      setToast((t) => ({ ...t, visible: false }));
      return;
    }
    setToast({ msg, type, visible: true });
    clearTimeout(ToastProvider._timer);
    ToastProvider._timer = setTimeout(() => {
      setToast((t) => ({ ...t, visible: false }));
    }, 3000);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className={`cd-toast ${toast.visible ? 'show' : ''} ${toast.type}`}
        role="status"
      >
        {toast.msg}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
