import React from 'react';
import { Plus } from 'lucide-react';

export type AppView = 'converter' | 'batch' | 'samples' | 'windows';

interface TopBarProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  onAddFilesClick: () => void;
  queueCount: number;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
  onSelectView,
  onAddFilesClick,
  queueCount,
}) => {
  const navItems: Array<{ id: AppView; label: string }> = [
    { id: 'converter', label: 'Converter' },
    {
      id: 'batch',
      label: queueCount > 1 ? `Batch Queue (${queueCount})` : 'Batch Queue',
    },
    { id: 'samples', label: 'Sample Models' },
    { id: 'windows', label: 'Windows Guide' },
  ];

  return (
    <header className="h-14 shrink-0 bg-[#161B22] border-b border-[#262D38] px-6 flex items-center justify-between gap-8">
      {/* Zone 1: Single text element brand wordmark */}
      <button
        type="button"
        onClick={() => onSelectView('converter')}
        className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 rounded-sm"
      >
        MeshShift
      </button>

      {/* Zone 2: 4 concise single-line text nav links */}
      <nav
        aria-label="Primary navigation"
        className="hidden md:flex items-center gap-7 text-sm font-medium"
      >
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              className={`relative py-4 whitespace-nowrap shrink-0 transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                isActive
                  ? 'text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {item.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: 1 primary action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onAddFilesClick}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>Add GLB File</span>
        </button>
      </div>
    </header>
  );
};
