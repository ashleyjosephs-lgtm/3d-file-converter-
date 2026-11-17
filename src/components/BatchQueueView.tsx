import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  Eye,
  FolderArchive,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  ConversionLogEntry,
  ExportOptions,
  QueuedModel,
} from '../types/converter';
import { formatBytes } from './ConversionPanel';

interface BatchQueueViewProps {
  models: QueuedModel[];
  activeModelId: string | null;
  options: ExportOptions;
  isConverting: boolean;
  logs: ConversionLogEntry[];
  onAddFiles: () => void;
  onPreviewModel: (id: string) => void;
  onConvertSingleById: (id: string) => void;
  onRemoveModel: (id: string) => void;
  onConvertAll: () => void;
  onChangeFormat: (format: ExportOptions['format']) => void;
  onClearSuccesses: () => void;
  onReorderModels: (fromIndex: number, toIndex: number) => void;
  onToggleAutoRemove: (autoRemove: boolean) => void;
  onClearLogs: () => void;
}

export const BatchQueueView: React.FC<BatchQueueViewProps> = ({
  models,
  activeModelId,
  options,
  isConverting,
  logs,
  onAddFiles,
  onPreviewModel,
  onConvertSingleById,
  onRemoveModel,
  onConvertAll,
  onChangeFormat,
  onClearSuccesses,
  onReorderModels,
  onToggleAutoRemove,
  onClearLogs,
}) => {
  const [logFilter, setLogFilter] = useState<'all' | 'success' | 'error'>('all');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const completedQueueCount = models.filter((m) => m.status === 'done').length;
  const successCount = logs.filter((l) => l.status === 'success').length;
  const errorCount = logs.filter((l) => l.status === 'error').length;
  const visibleLogs =
    logFilter === 'all' ? logs : logs.filter((l) => l.status === logFilter);
  return (
    <div className="flex-1 overflow-y-auto bg-[#0E1116] p-6 lg:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-100 tracking-[0.005em]">
              Batch Conversion Queue
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Queue multiple GLB models and convert them together into a single
              downloadable archive.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-[#161B22] border border-[#262D38]">
              {(['fbx', 'obj', 'skp'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => onChangeFormat(fmt)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase whitespace-nowrap transition-colors cursor-pointer ${
                    options.format === fmt
                      ? 'bg-[#262D38] text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={completedQueueCount === 0 || isConverting}
              onClick={onClearSuccesses}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#161B22] border border-[#2D3542] hover:bg-[#1E242E] disabled:opacity-45 text-slate-200 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <span>
                {completedQueueCount > 0
                  ? `Clear Successes (${completedQueueCount})`
                  : 'Clear Successes'}
              </span>
            </button>

            <button
              type="button"
              onClick={onAddFiles}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#161B22] border border-[#2D3542] hover:bg-[#1E242E] text-slate-200 text-sm font-medium whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Add GLB Files</span>
            </button>

            <button
              type="button"
              disabled={models.length === 0 || isConverting}
              onClick={onConvertAll}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-sm font-semibold whitespace-nowrap cursor-pointer disabled:cursor-not-allowed"
            >
              <FolderArchive className="w-4 h-4" aria-hidden="true" />
              <span>
                {isConverting
                  ? 'Converting Batch...'
                  : `Convert All (${models.length})`}
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-1">
          <span className="text-xs text-slate-400 font-mono-tabular">
            {models.length} {models.length === 1 ? 'model' : 'models'} queued ·{' '}
            {completedQueueCount} converted
          </span>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={options.autoRemoveCompleted}
              onChange={(e) => onToggleAutoRemove(e.target.checked)}
              className="w-4 h-4 accent-blue-500 rounded cursor-pointer"
            />
            <span>Auto-remove converted items</span>
          </label>
        </div>

        <div className="bg-[#161B22] border border-[#262D38] rounded-xl overflow-hidden">
          {models.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm font-medium text-slate-200">
                No GLB files in queue
              </p>
              <p className="text-xs text-slate-400 mt-1 mb-4">
                Add one or more .glb / .gltf files from your computer to batch
                convert.
              </p>
              <button
                type="button"
                onClick={onAddFiles}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Select GLB Files</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#262D38] bg-[#12161C] text-xs font-medium text-slate-400">
                    <th className="py-3 pl-4 pr-2 w-24">Priority</th>
                    <th className="py-3 px-4">File Name</th>
                    <th className="py-3 px-4">Size</th>
                    <th className="py-3 px-4">Meshes</th>
                    <th className="py-3 px-4">Triangles</th>
                    <th className="py-3 px-4">Dimensions (m)</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222832] text-sm">
                  {models.map((item, idx) => {
                    const isDragged = draggedIndex === idx;
                    const isDropTarget =
                      dropTargetIndex === idx &&
                      draggedIndex !== null &&
                      draggedIndex !== idx;
                    const dropShadowClass = isDropTarget
                      ? draggedIndex! > idx
                        ? 'shadow-[inset_0_2px_0_0_#3b82f6] bg-blue-950/25'
                        : 'shadow-[inset_0_-2px_0_0_#3b82f6] bg-blue-950/25'
                      : '';

                    return (
                      <tr
                        key={item.id}
                        draggable={!isConverting && models.length > 1}
                        onDragStart={(e) => {
                          setDraggedIndex(idx);
                          setDropTargetIndex(idx);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', item.id);
                        }}
                        onDragOver={(e) => {
                          if (draggedIndex === null || isConverting) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          if (dropTargetIndex !== idx) {
                            setDropTargetIndex(idx);
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (
                            draggedIndex !== null &&
                            draggedIndex !== idx &&
                            !isConverting
                          ) {
                            onReorderModels(draggedIndex, idx);
                          }
                          setDraggedIndex(null);
                          setDropTargetIndex(null);
                        }}
                        onDragEnd={() => {
                          setDraggedIndex(null);
                          setDropTargetIndex(null);
                        }}
                        className={`transition-colors ${
                          isDragged ? 'opacity-45' : ''
                        } ${
                          dropShadowClass ||
                          (item.id === activeModelId
                            ? 'bg-blue-950/30'
                            : 'hover:bg-[#1B212A]')
                        }`}
                      >
                        <td className="py-3 pl-4 pr-2 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <span
                              title={
                                models.length > 1
                                  ? 'Drag row to reorder batch priority'
                                  : 'Queue position'
                              }
                              className={`text-slate-500 ${
                                models.length > 1 && !isConverting
                                  ? 'cursor-grab active:cursor-grabbing hover:text-slate-300'
                                  : 'opacity-40'
                              }`}
                            >
                              <GripVertical
                                className="w-4 h-4"
                                aria-hidden="true"
                              />
                            </span>
                            <span className="font-mono-tabular text-xs text-slate-400 w-5">
                              {idx + 1}
                            </span>
                            {models.length > 1 && (
                              <div className="inline-flex items-center">
                                <button
                                  type="button"
                                  disabled={idx === 0 || isConverting}
                                  onClick={() => onReorderModels(idx, idx - 1)}
                                  aria-label={`Move ${item.name} up`}
                                  title="Move up"
                                  className="p-0.5 rounded text-slate-500 hover:text-slate-200 disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed"
                                >
                                  <ArrowUp
                                    className="w-3.5 h-3.5"
                                    aria-hidden="true"
                                  />
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    idx === models.length - 1 || isConverting
                                  }
                                  onClick={() => onReorderModels(idx, idx + 1)}
                                  aria-label={`Move ${item.name} down`}
                                  title="Move down"
                                  className="p-0.5 rounded text-slate-500 hover:text-slate-200 disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed"
                                >
                                  <ArrowDown
                                    className="w-3.5 h-3.5"
                                    aria-hidden="true"
                                  />
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-100 max-w-[240px] truncate">
                          {item.name}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-xs text-slate-400 whitespace-nowrap">
                          {formatBytes(item.fileSizeBytes)}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-xs text-slate-400">
                          {item.stats.meshCount}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-xs text-slate-400">
                          {item.stats.triangleCount.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-xs text-slate-400 whitespace-nowrap">
                          {item.stats.dimensions.x} × {item.stats.dimensions.y}{' '}
                          × {item.stats.dimensions.z}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-300 whitespace-nowrap">
                          {item.status === 'done' && item.lastConvertedFormat
                            ? `Exported ${item.lastConvertedFormat.toUpperCase()}`
                            : item.status === 'converting'
                            ? 'Converting...'
                            : item.status === 'error'
                            ? 'Failed'
                            : 'Ready'}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onPreviewModel(item.id)}
                              title="Inspect in 3D Viewport"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-300 hover:text-white hover:bg-[#222934] cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Inspect</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onConvertSingleById(item.id)}
                              disabled={isConverting}
                              title={`Convert to ${options.format.toUpperCase()}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-blue-400 hover:bg-blue-950/50 cursor-pointer"
                            >
                              <Download
                                className="w-3.5 h-3.5"
                                aria-hidden="true"
                              />
                              <span>{options.format.toUpperCase()}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveModel(item.id)}
                              aria-label={`Remove ${item.name}`}
                              className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-950/50 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Conversion Log Panel */}
        <section
          aria-labelledby="conversion-log-heading"
          className="bg-[#161B22] border border-[#262D38] rounded-xl overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-[#262D38] flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2
                id="conversion-log-heading"
                className="font-display text-base font-semibold text-slate-100"
              >
                Conversion Log
              </h2>
              <span className="text-xs text-slate-400 font-mono-tabular">
                {successCount} succeeded · {errorCount}{' '}
                {errorCount === 1 ? 'error' : 'errors'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div
                role="tablist"
                aria-label="Filter conversion log"
                className="flex items-center gap-1 p-1 rounded-lg bg-[#0E1116] border border-[#262D38]"
              >
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'success', label: 'Success' },
                    { id: 'error', label: 'Errors' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={logFilter === tab.id}
                    onClick={() => setLogFilter(tab.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                      logFilter === tab.id
                        ? 'bg-[#222933] text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {logs.length > 0 && (
                <button
                  type="button"
                  onClick={onClearLogs}
                  className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-slate-100 hover:bg-[#222933] whitespace-nowrap transition-colors cursor-pointer"
                >
                  Clear Log
                </button>
              )}
            </div>
          </div>

          {visibleLogs.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-slate-400">
              {logs.length === 0
                ? 'No conversions or errors recorded yet. Convert a model or batch to view activity.'
                : `No ${logFilter === 'error' ? 'error' : 'success'} entries in the log.`}
            </div>
          ) : (
            <ul className="divide-y divide-[#222832] max-h-80 overflow-y-auto">
              {visibleLogs.map((entry) => (
                <li
                  key={entry.id}
                  className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {entry.status === 'success' ? (
                      <CheckCircle2
                        className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                    ) : (
                      <AlertCircle
                        className="w-4 h-4 text-red-400 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                    )}

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span
                          className={`text-xs font-semibold ${
                            entry.status === 'success'
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }`}
                        >
                          {entry.status === 'success' ? 'Converted' : 'Error'}
                        </span>
                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-medium text-slate-100 truncate max-w-[260px]">
                          {entry.sourceName}
                        </span>
                        <span className="text-slate-500" aria-hidden="true">
                          →
                        </span>
                        <span className="font-mono-tabular text-xs font-medium text-slate-300 uppercase">
                          {entry.targetFormat}
                        </span>
                      </div>
                      <p
                        className={`text-xs mt-0.5 ${
                          entry.status === 'error'
                            ? 'text-red-300'
                            : 'text-slate-400'
                        }`}
                      >
                        {entry.outputFilename
                          ? `${entry.outputFilename} — ${entry.message}`
                          : entry.message}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-400 font-mono-tabular shrink-0 pl-7 sm:pl-0">
                    {typeof entry.sizeBytes === 'number' && (
                      <span>{formatBytes(entry.sizeBytes)}</span>
                    )}
                    {typeof entry.durationMs === 'number' && (
                      <span>{entry.durationMs} ms</span>
                    )}
                    <time dateTime={entry.timestamp} className="text-slate-500">
                      {entry.timestamp}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};
