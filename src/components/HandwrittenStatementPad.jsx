import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Eraser, Expand, PenLine, X } from 'lucide-react';

function makeStatementId() {
  return `BEYAN-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
}

function exportStatementImage(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] < 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return '';

  const padding = Math.max(18, Math.round(Math.min(width, height) * 0.035));
  const sourceX = Math.max(0, minX - padding);
  const sourceY = Math.max(0, minY - padding);
  const sourceWidth = Math.min(width - sourceX, maxX - minX + 1 + padding * 2);
  const sourceHeight = Math.min(height - sourceY, maxY - minY + 1 + padding * 2);
  const scale = Math.min(1, 1200 / sourceWidth, 480 / sourceHeight);
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(sourceWidth * scale));
  output.height = Math.max(1, Math.round(sourceHeight * scale));
  output
    .getContext('2d')
    .drawImage(
      canvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      output.width,
      output.height
    );
  return output.toDataURL('image/png');
}

export function HandwrittenStatementPad({
  value,
  onChange,
  label = 'El Yazısı Beyanı',
  statement,
  disabled = false,
}) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previousUserSelect = document.body.style.userSelect;
    const previousWebkitUserSelect = document.body.style.webkitUserSelect;
    const previousWebkitTouchCallout = document.body.style.getPropertyValue('-webkit-touch-callout');
    document.body.style.overflow = 'hidden';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    document.body.style.setProperty('-webkit-touch-callout', 'none');

    const canvas = canvasRef.current;
    const preventNativeGesture = (event) => event.preventDefault();
    const clearNativeSelection = () => window.getSelection?.()?.removeAllRanges();
    const blockedEvents = [
      'touchstart',
      'touchmove',
      'gesturestart',
      'contextmenu',
      'selectstart',
      'dragstart',
    ];
    blockedEvents.forEach((eventName) => {
      canvas?.addEventListener(eventName, preventNativeGesture, { passive: false });
    });
    document.addEventListener('selectionchange', clearNativeSelection);

    const frame = window.requestAnimationFrame(() => {
      const activeCanvas = canvasRef.current;
      if (!activeCanvas) return;

      const rect = activeCanvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      activeCanvas.width = Math.max(1, Math.round(rect.width * ratio));
      activeCanvas.height = Math.max(1, Math.round(rect.height * ratio));

      const context = activeCanvas.getContext('2d');
      context.lineWidth = Math.max(4, 3 * ratio);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = '#111827';

      if (value?.image) {
        const preview = new Image();
        preview.onload = () => {
          const previewScale = Math.min(
            activeCanvas.width / preview.width,
            activeCanvas.height / preview.height,
            1
          );
          const previewWidth = preview.width * previewScale;
          const previewHeight = preview.height * previewScale;
          context.drawImage(
            preview,
            (activeCanvas.width - previewWidth) / 2,
            (activeCanvas.height - previewHeight) / 2,
            previewWidth,
            previewHeight
          );
          setHasDrawn(true);
        };
        preview.src = value.image;
      } else {
        setHasDrawn(false);
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
      blockedEvents.forEach((eventName) => {
        canvas?.removeEventListener(eventName, preventNativeGesture);
      });
      document.removeEventListener('selectionchange', clearNativeSelection);
      document.body.style.overflow = previousOverflow;
      document.body.style.userSelect = previousUserSelect;
      document.body.style.webkitUserSelect = previousWebkitUserSelect;
      if (previousWebkitTouchCallout) {
        document.body.style.setProperty('-webkit-touch-callout', previousWebkitTouchCallout);
      } else {
        document.body.style.removeProperty('-webkit-touch-callout');
      }
    };
  }, [isOpen, value?.image]);

  const getCoordinates = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDrawing = (event) => {
    if (disabled) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const point = getCoordinates(event);
    canvas.setPointerCapture?.(event.pointerId);
    context.beginPath();
    context.moveTo(point.x, point.y);
    drawingRef.current = true;
    setHasDrawn(true);
  };

  const draw = (event) => {
    if (!drawingRef.current || disabled) return;
    event.preventDefault();
    const context = canvasRef.current.getContext('2d');
    const point = getCoordinates(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const stopDrawing = (event) => {
    drawingRef.current = false;
    if (event?.pointerId !== undefined) {
      canvasRef.current?.releasePointerCapture?.(event.pointerId);
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const confirmStatement = () => {
    if (!hasDrawn || !canvasRef.current) return;
    const image = exportStatementImage(canvasRef.current);
    if (!image) {
      setHasDrawn(false);
      return;
    }
    onChange?.({
      image,
      hash: makeStatementId(),
      statement,
      confirmedAt: new Date().toISOString(),
    });
    setIsOpen(false);
  };

  const editor = isOpen ? (
    <div
      className="fixed inset-0 select-none bg-slate-950/70 backdrop-blur-sm p-0 sm:p-5 flex items-center justify-center"
      style={{
        zIndex: 1000000,
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'none',
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${label} yazma alanı`}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className="bg-white w-full h-full sm:h-auto sm:max-w-5xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-6 border-b border-gray-200 bg-white">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-gray-900 font-black text-base sm:text-lg">
              <PenLine className="w-5 h-5 text-[#0066b1] shrink-0" />
              {label}
            </div>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              Aşağıdaki cümleyi el yazınızla yazın.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
            aria-label="Yazma alanını kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-3 sm:px-6 bg-blue-50 border-b border-blue-100">
          <p className="text-[11px] uppercase font-black text-blue-600 mb-1">Yazılacak Beyan</p>
          <p className="text-sm sm:text-base font-bold text-slate-900">“{statement}”</p>
        </div>

        <div className="flex-1 min-h-0 p-3 sm:p-6 bg-slate-100 flex flex-col">
          <div className="theme-paper relative flex-1 min-h-[320px] sm:min-h-[430px] max-h-[62vh] bg-white border-2 border-dashed border-slate-300 rounded-xl overflow-hidden shadow-inner">
            <canvas
              ref={canvasRef}
              className="block w-full h-full min-h-[320px] sm:min-h-[430px] max-h-[62vh] cursor-crosshair touch-none select-none bg-white"
              style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'none' }}
              draggable={false}
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              onPointerCancel={stopDrawing}
              onPointerLeave={stopDrawing}
              onLostPointerCapture={stopDrawing}
              onContextMenu={(event) => event.preventDefault()}
            />
            {!hasDrawn && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-center px-6">
                <div className="text-slate-300">
                  <PenLine className="w-10 h-10 mx-auto mb-2" />
                  <p className="text-sm font-bold">Kaleminizle bu alana yazın</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-4 sm:px-6 border-t border-gray-200 bg-white flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
          <button
            type="button"
            onClick={clearCanvas}
            className="h-11 px-4 rounded-lg border border-red-200 text-red-600 font-bold inline-flex items-center justify-center gap-2 hover:bg-red-50"
          >
            <Eraser className="w-4 h-4" /> Temizle
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="h-11 px-5 rounded-lg border border-gray-200 text-gray-600 font-bold hover:bg-gray-50 flex-1 sm:flex-none"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={confirmStatement}
              disabled={!hasDrawn}
              className="h-11 px-5 rounded-lg bg-green-600 text-white font-black inline-flex items-center justify-center gap-2 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex-1 sm:flex-none"
            >
              <CheckCircle2 className="w-4 h-4" /> Beyanı Onayla
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="w-full max-w-md mx-auto">
        {value?.image ? (
          <div className="border border-green-200 bg-green-50/70 rounded-xl p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-[11px] font-black uppercase text-green-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Beyan Kaydedildi
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(true)}
                disabled={disabled}
                className="text-[11px] font-bold text-[#0066b1] hover:underline disabled:opacity-50"
              >
                Yeniden Yaz
              </button>
            </div>
            <div className="h-20 bg-white rounded-lg border border-green-100 flex items-center justify-center overflow-hidden">
              <img src={value.image} alt={`${label} el yazısı`} className="max-h-[72px] max-w-full object-contain" />
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-gray-600">“{statement}”</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            disabled={disabled}
            className="w-full min-h-24 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 px-4 py-4 text-left hover:border-[#0066b1] hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-xs font-black text-[#0066b1]">{label}</span>
                <span className="block text-[11px] text-gray-500 mt-1">Yazma alanını büyütmek için dokunun.</span>
              </span>
              <span className="w-10 h-10 rounded-lg bg-white border border-blue-100 text-[#0066b1] inline-flex items-center justify-center shadow-sm shrink-0">
                <Expand className="w-5 h-5" />
              </span>
            </span>
          </button>
        )}
      </div>
      {typeof document !== 'undefined' && editor ? createPortal(editor, document.body) : null}
    </>
  );
}
