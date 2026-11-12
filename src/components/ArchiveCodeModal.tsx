'use client';

import { useState } from 'react';

interface ArchiveCodeModalProps {
  code: string | null;
  onClose: () => void;
}

export default function ArchiveCodeModal({ code, onClose }: ArchiveCodeModalProps) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Show the code as selectable text even if clipboard permission is denied.
      setCopied(false);
    }
  };

  return (
    <div className="studio-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="archive-modal-title"
        className="studio-modal-card studio-archive-modal w-full max-w-sm rounded-2xl border p-6 text-center shadow-2xl">
        <div className="studio-archive-success-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 4 4L19 6" />
            <circle cx="12" cy="12" r="10" strokeWidth="1.4" />
          </svg>
        </div>
        <h2 id="archive-modal-title" className="mt-3 text-lg font-bold">已生成对接码</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#866177]">
          当前拼豆图纸已保存至云端，输入下方对接码即可导入使用。
        </p>
        <div className="studio-archive-result-code mt-5" aria-label={`对接码 ${code}`}>{code}</div>
        <p className="mt-3 text-xs text-[#9b7c8c]">请妥善保存，对接码可以读取对应的图纸。</p>
        <div className="mt-6 flex justify-center gap-2">
          <button type="button" className="studio-archive-pill" onClick={handleCopy}>
            {copied ? '已复制' : '复制对接码'}
          </button>
          <button type="button" className="studio-archive-pill studio-archive-pill-primary"
            onClick={() => { setCopied(false); onClose(); }}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
