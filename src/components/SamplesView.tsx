import React, { useState } from 'react';
import { ArrowRight, Download } from 'lucide-react';
import { SAMPLE_MODELS, generateSampleGlbBuffer } from '../lib/sampleModels';
import { triggerBlobDownload } from '../lib/converters';

interface SamplesViewProps {
  onLoadSample: (sampleId: string) => Promise<void>;
}

export const SamplesView: React.FC<SamplesViewProps> = ({ onLoadSample }) => {
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleLoad = async (id: string) => {
    setBusyId(id);
    try {
      await onLoadSample(id);
    } finally {
      setBusyId(null);
    }
  };

  const handleDownloadRawGlb = async (id: string, filename: string) => {
    setBusyId(`dl-${id}`);
    try {
      const buf = await generateSampleGlbBuffer(id);
      const blob = new Blob([buf], { type: 'model/gltf-binary' });
      triggerBlobDownload(blob, filename);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#0E1116] p-6 lg:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-100 tracking-[0.005em]">
            Sample GLB Assemblies
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Load a built-in multi-material GLB model to test FBX, OBJ, and
            SketchUp conversions without uploading external files.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {SAMPLE_MODELS.map((sample) => (
            <div
              key={sample.id}
              className="bg-[#161B22] border border-[#262D38] rounded-xl p-6 flex flex-col justify-between"
            >
              <div>
                <div className="text-xs font-medium text-slate-400">
                  {sample.category}
                </div>
                <h2 className="font-display text-lg font-semibold text-slate-100 mt-1">
                  {sample.name}
                </h2>
                <p className="text-xs font-mono-tabular text-slate-400 mt-0.5">
                  {sample.filename}
                </p>
                <p className="text-sm text-slate-300 mt-3 leading-relaxed">
                  {sample.summary}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-[#262D38] flex items-center gap-2">
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => handleLoad(sample.id)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  <span>
                    {busyId === sample.id ? 'Loading...' : 'Open in Converter'}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() =>
                    handleDownloadRawGlb(sample.id, sample.filename)
                  }
                  title="Download raw .glb sample"
                  className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-[#1C222B] border border-[#2D3542] hover:bg-[#232A35] text-slate-200 text-xs font-medium whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>GLB</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
