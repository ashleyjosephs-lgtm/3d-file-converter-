import React from 'react';
import { Download } from 'lucide-react';
import { triggerBlobDownload } from '../lib/converters';

export const WindowsGuideView: React.FC = () => {
  const handleDownloadSketchUpRubyPlugin = () => {
    const rbContent = `# MeshShift SketchUp Batch Converter (Windows Desktop)
# Place in: %APPDATA%\\SketchUp\\SketchUp 2024\\SketchUp\\Plugins\\
# Or run from Window -> Ruby Console: load "C:/path/to/MeshShift_Batch_SKP.rb"

require 'sketchup'

module MeshShift
  def self.convert_dae_to_skp
    dae_path = UI.openpanel("Select MeshShift COLLADA (.dae) file", "", "COLLADA Files|*.dae||")
    return unless dae_path

    skp_path = dae_path.sub(/\\.dae$/i, ".skp")
    model = Sketchup.active_model
    if model.import(dae_path, show_summary: false)
      model.save(skp_path)
      UI.messagebox("Converted to native SketchUp file:\\n#{skp_path}")
    else
      UI.messagebox("Could not import #{dae_path}")
    end
  end
end

unless file_loaded?(__FILE__)
  UI.menu("Extensions").add_item("MeshShift: Import DAE to SKP") {
    MeshShift.convert_dae_to_skp
  }
  file_loaded(__FILE__)
end
`;
    const blob = new Blob([rbContent], { type: 'text/plain;charset=utf-8' });
    triggerBlobDownload(blob, 'MeshShift_SketchUp_Plugin.rb');
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#0E1116] p-6 lg:p-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-100 tracking-[0.005em]">
            Windows Desktop Workflow Guide
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            MeshShift runs 100% locally in memory on your Windows PC—your 3D
            models never leave your machine.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <section className="bg-[#161B22] border border-[#262D38] rounded-xl p-6 space-y-3">
            <h2 className="font-display text-base font-semibold text-slate-100">
              Pin as a Windows Desktop App
            </h2>
            <ol className="list-decimal list-inside space-y-2 text-sm text-slate-300 leading-relaxed">
              <li>
                Open MeshShift in <strong className="text-white">Microsoft Edge</strong> or{' '}
                <strong className="text-white">Google Chrome</strong> on Windows 10/11.
              </li>
              <li>
                Click the browser menu (<strong className="text-white">⋯</strong>) in the top-right
                corner.
              </li>
              <li>
                Choose <strong className="text-white">Apps → Install this site as an app</strong>.
              </li>
              <li>
                Pin the installed window to your Windows Taskbar or Start Menu
                for native offline-style launch.
              </li>
            </ol>
          </section>

          <section className="bg-[#161B22] border border-[#262D38] rounded-xl p-6 space-y-3">
            <h2 className="font-display text-base font-semibold text-slate-100">
              Opening Exported Formats on Windows
            </h2>
            <dl className="space-y-2.5 text-sm">
              <div>
                <dt className="font-semibold text-slate-100">
                  FBX (.fbx — Autodesk FBX 7.4 Binary)
                </dt>
                <dd className="text-slate-400 text-xs mt-0.5">
                  Opens directly in Windows 3D Viewer, Blender, Unreal Engine,
                  Unity, Autodesk Maya, and 3ds Max.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-100">
                  OBJ (.obj + .mtl + textures)
                </dt>
                <dd className="text-slate-400 text-xs mt-0.5">
                  Extract the ZIP folder first so the .obj automatically locates
                  its .mtl material library and PNG texture maps.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-100">
                  SKP (SketchUp COLLADA .dae + Ruby Bridge)
                </dt>
                <dd className="text-slate-400 text-xs mt-0.5">
                  Import the Z-up .dae via File → Import in Trimble SketchUp, or
                  run the included Ruby script to auto-save as native .skp.
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <section className="bg-[#161B22] border border-[#262D38] rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold text-slate-100">
              SketchUp Windows Extension Helper (.rb)
            </h2>
            <p className="text-sm text-slate-400 max-w-xl">
              Adds an Extensions menu command inside Trimble SketchUp on Windows
              to pick any exported .dae file and convert it directly to a saved
              .skp file.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadSketchUpRubyPlugin}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#222934] hover:bg-[#2B3442] border border-[#323B4A] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>Download SketchUp Plugin (.rb)</span>
          </button>
        </section>
      </div>
    </div>
  );
};
