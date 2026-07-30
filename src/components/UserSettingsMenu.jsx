import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, Moon, RefreshCw, Settings, Sun } from 'lucide-react';

const MENU_WIDTH = 220;
const VIEWPORT_GUTTER = 12;

export function UserSettingsMenu({
  theme,
  onToggleTheme,
  onRefresh,
  onLogout,
  isRefreshing = false,
  variant = 'desktop',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const triggerRef = useRef(null);
  const isMobile = variant === 'mobile';

  const measureAnchor = useCallback(() => {
    if (!triggerRef.current) return null;
    if (!isMobile) {
      const footerGroup = triggerRef.current.closest('[data-user-settings-anchor]');
      if (footerGroup) return footerGroup.getBoundingClientRect();
    }
    return triggerRef.current.getBoundingClientRect();
  }, [isMobile]);

  const toggleMenu = () => {
    if (!open) {
      setAnchorRect(measureAnchor());
    }
    setOpen((current) => !current);
  };

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const handleResize = () => {
      setAnchorRect(measureAnchor());
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [measureAnchor, open]);

  const runAndClose = (callback) => {
    setOpen(false);
    callback?.();
  };

  const popoverWidth = isMobile
    ? MENU_WIDTH
    : Math.max(200, Math.round(anchorRect?.width || MENU_WIDTH));
  const popoverLeft = anchorRect
    ? Math.min(
        Math.max(VIEWPORT_GUTTER, isMobile ? anchorRect.right - popoverWidth : anchorRect.left),
        Math.max(VIEWPORT_GUTTER, window.innerWidth - popoverWidth - VIEWPORT_GUTTER)
      )
    : VIEWPORT_GUTTER;
  const popoverStyle = anchorRect
    ? isMobile
      ? {
          top: Math.min(anchorRect.bottom + 8, window.innerHeight - 190),
          left: popoverLeft,
          width: popoverWidth,
        }
      : {
          bottom: Math.max(VIEWPORT_GUTTER, window.innerHeight - anchorRect.top + 8),
          left: popoverLeft,
          width: popoverWidth,
        }
    : undefined;

  const menu = open && anchorRect && typeof document !== 'undefined'
    ? createPortal(
        <div className="fixed inset-0 z-[999999999998]" onMouseDown={() => setOpen(false)}>
          <div
            role="menu"
            aria-label="Kullanıcı ayarları"
            className="user-settings-popover fixed"
            style={popoverStyle}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              className="user-settings-action"
              onClick={() => runAndClose(onRefresh)}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Verileri yenile</span>
            </button>

            <button
              type="button"
              role="menuitem"
              className="user-settings-action"
              onClick={() => onToggleTheme?.()}
              aria-label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}
              aria-pressed={theme === 'dark'}
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}
              <span>Tema</span>
              <span
                className={`user-theme-switch ${theme === 'dark' ? 'is-dark' : ''}`}
                aria-hidden="true"
              >
                <span className="user-theme-switch-thumb" />
                <Sun className="user-theme-switch-icon user-theme-switch-icon--sun" />
                <Moon className="user-theme-switch-icon user-theme-switch-icon--moon" />
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              className="user-settings-action user-settings-action--danger"
              onClick={() => runAndClose(onLogout)}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>Çıkış yap</span>
            </button>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className={`user-settings-menu ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`user-settings-trigger ${
          isMobile ? 'user-settings-trigger--mobile' : 'user-settings-trigger--desktop'
        }`}
        onClick={toggleMenu}
        aria-label="Ayarlar"
        title="Ayarlar"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Settings className="h-5 w-5" aria-hidden="true" />
      </button>
      {menu}
    </div>
  );
}
