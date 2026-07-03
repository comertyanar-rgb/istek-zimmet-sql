import { useState } from 'react';
import { CheckCircle2, Copy } from 'lucide-react';

export const ClipboardCopy = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md hover:bg-gray-200 transition-colors flex items-center justify-center bg-white border border-gray-200 shadow-sm ml-1"
      title="Kopyala"
    >
      {copied ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-gray-500" />
      )}
    </button>
  );
};
