import { forwardRef } from 'react';
import { FileCheck2 } from 'lucide-react';

export const AssignmentFloatingAction = forwardRef(function AssignmentFloatingAction(
  { selectedCount, onClick, disabled = false },
  ref
) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[999999] flex justify-center px-3 print:hidden md:inset-x-auto md:bottom-12 md:right-12 md:px-0">
      <div
        ref={ref}
        className="assignment-floating-motion pointer-events-auto w-full max-w-[430px] origin-bottom transition-all duration-500 ease-out md:w-auto"
      >
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="assignment-action-fab flex w-full items-center justify-center disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
          aria-label={`${selectedCount} cihaz için tutanak oluştur ve onaya geç`}
        >
          <span className="assignment-action-fab-icon">
            <FileCheck2 className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <span className="truncate whitespace-nowrap tracking-wide">
            Tutanak Oluştur ve Onaya Geç
          </span>
        </button>
      </div>
    </div>
  );
});
