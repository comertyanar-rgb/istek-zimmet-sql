import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, CircleX, Info, X } from 'lucide-react';
import { UI_MESSAGE_REQUEST_EVENT } from '../services/uiMessageService.js';

const TYPE_STYLES = {
  error: {
    Icon: CircleX,
    iconClass: 'bg-red-50 text-red-600 border-red-100',
    buttonClass: 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-300',
  },
  warning: {
    Icon: AlertTriangle,
    iconClass: 'bg-amber-50 text-amber-600 border-amber-100',
    buttonClass: 'bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-300',
  },
  success: {
    Icon: CheckCircle2,
    iconClass: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    buttonClass: 'bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-300',
  },
  info: {
    Icon: Info,
    iconClass: 'bg-blue-50 text-[#0066b1] border-blue-100',
    buttonClass: 'bg-[#0066b1] hover:bg-[#005595] focus-visible:ring-blue-300',
  },
};

export function AppMessageCenter() {
  const [queue, setQueue] = useState([]);
  const queueRef = useRef([]);
  const primaryButtonRef = useRef(null);
  const current = queue[0] || null;

  const replaceQueue = (nextQueue) => {
    queueRef.current = nextQueue;
    setQueue(nextQueue);
  };

  useEffect(() => {
    const handleRequest = (event) => {
      const request = event.detail;
      if (!request?.id) return;

      if (
        request.kind === 'alert' &&
        queueRef.current.some((item) => item.dedupeKey === request.dedupeKey)
      ) {
        request.resolve?.();
        return;
      }

      replaceQueue([...queueRef.current, request]);
    };

    window.addEventListener(UI_MESSAGE_REQUEST_EVENT, handleRequest);
    return () => window.removeEventListener(UI_MESSAGE_REQUEST_EVENT, handleRequest);
  }, []);

  useEffect(() => {
    if (!current) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => primaryButtonRef.current?.focus(), 30);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
    };
  }, [current]);

  const closeCurrent = (result) => {
    if (!current) return;
    current.resolve?.(current.kind === 'confirm' ? Boolean(result) : undefined);
    replaceQueue(queueRef.current.filter((item) => item.id !== current.id));
  };

  useEffect(() => {
    if (!current) return undefined;

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeCurrent(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [current]);

  if (!current || typeof document === 'undefined') return null;

  const style = TYPE_STYLES[current.type] || TYPE_STYLES.info;
  const Icon = style.Icon;
  const isConfirm = current.kind === 'confirm';

  return createPortal(
    <div
      className="app-modal-backdrop fixed inset-0 flex items-center justify-center bg-slate-950/55 backdrop-blur-[2px] px-4 py-6 print:hidden"
      style={{ zIndex: 2147483000 }}
      role="presentation"
    >
      <section
        role={current.type === 'error' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="app-message-title"
        aria-describedby="app-message-description"
        className="app-modal-panel relative w-full max-w-[430px] overflow-hidden rounded-2xl border border-white/60 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]"
      >
        <button
          type="button"
          onClick={() => closeCurrent(false)}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          aria-label="Mesajı kapat"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 pb-5 pt-7 sm:px-7">
          <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl border ${style.iconClass}`}>
            <Icon className="h-6 w-6" strokeWidth={2.2} />
          </div>
          <h2 id="app-message-title" className="pr-10 text-lg font-black text-slate-900">
            {current.title}
          </h2>
          <p
            id="app-message-description"
            className="mt-2 whitespace-pre-line break-words text-sm font-medium leading-6 text-slate-600"
          >
            {current.message}
          </p>
        </div>

        <div className={`grid gap-2 border-t border-slate-100 bg-slate-50/80 p-4 ${isConfirm ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {isConfirm && (
            <button
              type="button"
              onClick={() => closeCurrent(false)}
              className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            >
              {current.cancelLabel}
            </button>
          )}
          <button
            ref={primaryButtonRef}
            type="button"
            onClick={() => closeCurrent(true)}
            className={`h-11 rounded-xl px-4 text-sm font-black text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${style.buttonClass}`}
          >
            {current.confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
