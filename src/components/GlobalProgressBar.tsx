import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import type { ConversionProgress } from '../types/converter';

interface GlobalProgressBarProps {
  progress: ConversionProgress;
  onDismiss: () => void;
}

export const GlobalProgressBar: React.FC<GlobalProgressBarProps> = ({
  progress,
  onDismiss,
}) => {
  if (!progress.visible) return null;

  const clamped = Math.max(0, Math.min(100, Math.round(progress.percent)));
  const isError = progress.status === 'error';
  const isCompleted = progress.status === 'completed';

  const barColorClass = isError
    ? 'bg-red-500'
    : isCompleted
    ? 'bg-emerald-500'
    : 'bg-blue-500';

  return (
    <div
      role="region"
      aria-label="Conversion progress"
      className="shrink-0 bg-[#161B22] border-t border-[#262D38] z-40"
    >
      {/* Full-width top progress track using compositor-only scaleX */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-label={progress.label}
        className="h-1 w-full bg-[#262D38] overflow-hidden"
      >
        <div
          className={`h-full w-full origin-left transition-transform duration-150 ease-out ${barColorClass}`}
          style={{ transform: `scaleX(${clamped / 100})` }}
        />
      </div>

      <div className="px-6 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          {progress.status === 'running' && (
            <Loader2
              className="w-4 h-4 text-blue-400 animate-spin shrink-0"
              aria-hidden="true"
            />
          )}
          {isCompleted && (
            <CheckCircle2
              className="w-4 h-4 text-emerald-400 shrink-0"
              aria-hidden="true"
            />
          )}
          {isError && (
            <AlertCircle
              className="w-4 h-4 text-red-400 shrink-0"
              aria-hidden="true"
            />
          )}

          <span
            className={`text-xs font-medium truncate ${
              isError
                ? 'text-red-300'
                : isCompleted
                ? 'text-emerald-300'
                : 'text-slate-200'
            }`}
          >
            {progress.label}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {typeof progress.current === 'number' &&
            typeof progress.total === 'number' &&
            progress.total > 1 && (
              <span className="font-mono-tabular text-xs text-slate-400">
                {progress.current} / {progress.total}
              </span>
            )}

          <span className="font-mono-tabular text-xs font-semibold text-slate-200 w-9 text-right">
            {clamped}%
          </span>

          {progress.status !== 'running' && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss progress bar"
              className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-[#222933] transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
