import { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

export const SignaturePad = ({ onSign, label }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
  }, []);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX = e.clientX;
    let clientY = e.clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const startDrawing = (e) => {
    if (isConfirmed) return;
    if (e.cancelable) e.preventDefault();
    const coords = getCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e) => {
    if (!isDrawing || isConfirmed) return;
    if (e.cancelable) e.preventDefault();
    const coords = getCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const confirmSignature = (e) => {
    e.preventDefault();
    if (!hasDrawn) return;
    const simpleHash = `İMZA-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    onSign({ image: canvasRef.current.toDataURL('image/png'), hash: simpleHash });
    setIsConfirmed(true);
  };

  const clear = (e) => {
    if (e) e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    setIsConfirmed(false);
    onSign(null);
  };

  return (
    <div className="flex flex-col items-center w-full max-w-[320px] mx-auto relative animate-in zoom-in-95">
      <div className="relative w-full mb-2 flex justify-center bg-gray-50/50 rounded-xl">
        <canvas
          ref={canvasRef}
          width={600}
          height={320}
          style={{ width: '100%', height: '170px', touchAction: 'none', opacity: isConfirmed ? 0.5 : 1 }}
          className={`cursor-crosshair bg-white border-2 rounded-xl w-full shadow-inner ${isConfirmed ? 'border-green-500' : 'border-dashed border-gray-300'}`}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />

        <button onClick={clear} className="absolute top-2 right-2 text-[10px] font-bold bg-white px-2.5 py-1.5 rounded-lg text-red-500 shadow border border-gray-200 hover:bg-red-50">
          Temizle
        </button>

        {hasDrawn && !isConfirmed && (
          <button onClick={confirmSignature} className="absolute top-2 left-2 text-[10px] font-bold bg-green-600 px-3 py-1.5 rounded-lg text-white shadow border border-green-700 hover:bg-green-700 animate-in fade-in flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Onayla
          </button>
        )}
      </div>
      <span className={`text-[11px] font-bold text-center uppercase tracking-wide ${isConfirmed ? 'text-green-600' : 'text-gray-500'}`}>
        {isConfirmed ? 'İmza Kaydedildi ✓' : label}
      </span>
    </div>
  );
};
