'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { optimizeImageWithAI, DEFAULT_AI_PROMPT } from '../utils/aiOptimize';
import { clearCustomProvider, normalizeCustomProvider, optimizeWithCustomProvider, readCustomProvider, saveCustomProvider, type CustomAIProvider } from '../utils/customAiProvider';

interface AIOptimizeModalProps {
  imageSrc: string;
  isOpen: boolean;
  onClose: () => void;
  onOptimized: (optimizedImageSrc: string) => void;
}

export default function AIOptimizeModal({
  imageSrc,
  isOpen,
  onClose,
  onOptimized
}: AIOptimizeModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');

  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [provider, setProvider] = useState<CustomAIProvider | null>(null);
  const [showProviderDialog, setShowProviderDialog] = useState(false);
  const [providerDraft, setProviderDraft] = useState<CustomAIProvider>({
    endpoint: '', apiKey: '', model: '', remember: false
  });
  const [providerError, setProviderError] = useState<string | null>(null);

  // All small actions use the same pink pill design as "一键复制".
  const pillClass = 'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-[#e6bad0] bg-white px-3 py-1.5 text-xs font-semibold text-[#8a4e6c] shadow-sm transition-colors hover:border-[#cf91b1] hover:bg-[#fff0f7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96a91] disabled:cursor-not-allowed disabled:opacity-50';
  const fieldClass = 'w-full rounded-xl border border-[#e6bad0] bg-white px-3 py-2.5 text-sm text-[#5f3f51] outline-none placeholder:text-[#b39aa8] focus:border-[#cf91b1] focus:ring-2 focus:ring-[#f9dce9]';

  useEffect(() => {
    if (isOpen) {
      setCopyStatus('idle');
      setProvider(readCustomProvider());
      setShowProviderDialog(false);
      setProviderError(null);
    }
  }, [isOpen]);

  const openProviderDialog = () => {
    setProviderDraft(provider || { endpoint: '', apiKey: '', model: '', remember: false });
    setProviderError(null);
    setShowProviderDialog(true);
  };

  const handleSaveProvider = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const config = saveCustomProvider(normalizeCustomProvider(providerDraft));
      setProvider(config);
      setShowProviderDialog(false);
      setProviderError(null);
      setPreviewImage(null);
      setError(null);
    } catch (issue) {
      setProviderError(issue instanceof Error ? issue.message : '保存失败，请检查配置。');
    }
  };

  const handleUseDefault = () => {
    clearCustomProvider();
    setProvider(null);
    setProviderDraft({ endpoint: '', apiKey: '', model: '', remember: false });
    setShowProviderDialog(false);
    setProviderError(null);
    setPreviewImage(null);
    setError(null);
  };

  const handleCopyPrompt = useCallback(async () => {
    const text = customPrompt.trim() || DEFAULT_AI_PROMPT;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      // Some browsers restrict the Clipboard API; try the legacy user-click fallback.
    }
    if (!copied) {
      const input = document.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.select();
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      } finally {
        input.remove();
      }
    }
    setCopyStatus(copied ? 'success' : 'error');
  }, [customPrompt]);

  const handleOptimize = useCallback(async () => {
    if (!imageSrc) return;

    setIsProcessing(true);
    setProgress(0);
    setError(null);
    setPreviewImage(null);

    try {
      const prompt = customPrompt.trim() || DEFAULT_AI_PROMPT;

      const options = { customPrompt: prompt, onProgress: (p: number) => setProgress(p) };
      const result = provider
        ? await optimizeWithCustomProvider(imageSrc, provider, options)
        : await optimizeImageWithAI(imageSrc, options);

      if (result.success && result.imageUrl) {
        // 服务端已安全下载图片并通过同源接口返回 Data URL。
        setPreviewImage(result.imageUrl);
      } else {
        // 处理错误，包括图片风险错误
        let errorMessage = result.error || '优化失败，请重试';
        if (errorMessage.includes('IMAGE_RISK')) {
          errorMessage = '图片未能通过安全检测，请尝试使用其他图片。可能的原因：\n• 图片包含敏感内容\n• 图片格式不支持\n• 图片质量过低';
        }
        setError(errorMessage);
      }
    } catch (err) {
      let errorMessage = err instanceof Error ? err.message : '发生未知错误';

      // 处理图片风险错误
      if (errorMessage.includes('IMAGE_RISK')) {
        errorMessage = '图片未能通过安全检测，请尝试使用其他图片。可能的原因：\n• 图片包含敏感内容\n• 图片格式不支持\n• 图片质量过低';
      }

      setError(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  }, [imageSrc, customPrompt, provider]);

  const handleConfirm = useCallback(() => {
    if (previewImage) {
      onOptimized(previewImage);
      onClose();
    }
  }, [previewImage, onOptimized, onClose]);

  const handleReset = useCallback(() => {
    setPreviewImage(null);
    setError(null);
    setProgress(0);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            AI 图片优化
          </h2>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <button
              type="button"
              onClick={openProviderDialog}
              disabled={isProcessing}
              className={pillClass}
            >
              使用自定义供应商
            </button>
          <button
            onClick={onClose}
            type="button"
            aria-label="关闭 AI 优化"
            disabled={isProcessing}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-auto p-6">
          {/* 提示词输入 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              优化提示词（可选，默认适合拼豆风格）
            </label>
            <textarea
              value={customPrompt}
              onChange={(e) => { setCustomPrompt(e.target.value); setCopyStatus('idle'); }}
              placeholder={DEFAULT_AI_PROMPT}
              disabled={isProcessing || !!previewImage}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none h-20 focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-rose-100 bg-rose-50/65 px-3 py-2">
              <p className="min-w-0 flex-1 text-xs leading-5 text-[#705061]">
                {provider
                  ? `当前使用自定义供应商：${provider.model}。图片将直接发送到你填写的供应商。`
                  : '正在使用 suda 的快捷 API 额度进行优化。若图片生成效果不佳，可使用 GPT 或豆包等更高级的模型，并使用上述提示词。'}
              </p>
              <button
                type="button"
                onClick={handleCopyPrompt}
                aria-label="一键复制提示词"
                className={pillClass}
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="8" y="8" width="12" height="12" rx="2" strokeWidth={1.8} />
                  <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {copyStatus === 'success' ? '已复制' : '一键复制'}
              </button>
              {copyStatus === 'error' && (
                <p role="status" className="w-full text-xs font-medium text-[#984a63]">
                  复制失败，请手动选择上方提示词。
                </p>
              )}
              {copyStatus === 'success' && (
                <span role="status" className="sr-only">提示词已复制到剪贴板</span>
              )}
            </div>
          </div>

          {/* 图片对比 */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* 原图 */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">原图</h3>
              <div className="aspect-square bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                <img
                  src={imageSrc}
                  alt="Original"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            {/* 优化后 */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">AI优化后</h3>
              <div className="aspect-square bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 flex items-center justify-center">
                {previewImage ? (
                  <img
                    src={previewImage}
                    alt="Optimized"
                    className="w-full h-full object-contain"
                  />
                ) : isProcessing ? (
                  <div className="text-center p-4">
                    <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">AI处理中...</p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">{progress}%</p>
                    {/* 进度条 */}
                    <div className="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full mt-2 mx-auto overflow-hidden">
                      <div
                        className="h-full bg-purple-500 transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-center p-4 text-gray-400 dark:text-gray-600">
                    <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm">点击优化按钮开始</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="whitespace-pre-line">{error}</span>
              </div>
            </div>
          )}
        </div>

        {showProviderDialog && (
          <div className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-[#3e2936]/40 p-4 backdrop-blur-[2px]">
            <div role="dialog" aria-modal="true" aria-labelledby="ai-provider-title" className="w-full max-w-sm overflow-auto rounded-2xl border border-[#e6bad0] bg-[#fffafd] p-5 shadow-2xl max-h-full sm:p-6">
              <h3 id="ai-provider-title" className="mb-4 text-base font-semibold text-[#6a3c53]">自定义供应商</h3>
              <form onSubmit={handleSaveProvider} className="space-y-3">
                <label className="block text-xs font-semibold text-[#795468]">
                  API 接入点
                  <input
                    type="url"
                    name="endpoint"
                    required
                    autoFocus
                    autoComplete="off"
                    placeholder="https://tken.lol/v1"
                    value={providerDraft.endpoint}
                    onChange={(event) => setProviderDraft(current => ({ ...current, endpoint: event.target.value }))}
                    className={`mt-1.5 ${fieldClass}`}
                  />
                </label>
                <label className="block text-xs font-semibold text-[#795468]">
                  API Key
                  <input
                    type="password"
                    name="apiKey"
                    required
                    autoComplete="off"
                    placeholder="sk-..."
                    value={providerDraft.apiKey}
                    onChange={(event) => setProviderDraft(current => ({ ...current, apiKey: event.target.value }))}
                    className={`mt-1.5 ${fieldClass}`}
                  />
                </label>
                <label className="block text-xs font-semibold text-[#795468]">
                  模型名称
                  <input
                    type="text"
                    name="model"
                    required
                    autoComplete="off"
                    placeholder="gpt-image-2.6"
                    value={providerDraft.model}
                    onChange={(event) => setProviderDraft(current => ({ ...current, model: event.target.value }))}
                    className={`mt-1.5 ${fieldClass}`}
                  />
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[#795468]">
                  <input
                    type="checkbox"
                    name="rememberKey"
                    checked={providerDraft.remember}
                    onChange={(event) => setProviderDraft(current => ({ ...current, remember: event.target.checked }))}
                    className="h-4 w-4 accent-[#b5658a]"
                  />
                  在本机记住 Key
                </label>
                <p className="text-[11px] leading-5 text-[#9b798a]">
                  默认仅保存在当前浏览器会话；勾选后保存在本机。Key 会直接发送给你填写的供应商，不经过 PinDou 服务器。
                </p>
                {providerError && <p role="alert" className="text-xs font-medium text-[#a44166]">{providerError}</p>}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                  {provider && (
                    <button type="button" className={pillClass} onClick={handleUseDefault}>恢复默认</button>
                  )}
                  <button type="button" className={pillClass} onClick={() => setShowProviderDialog(false)}>取消</button>
                  <button type="submit" className={pillClass}>确认</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          {!previewImage ? (
            <>
              <button
                onClick={onClose}
                disabled={isProcessing}
                className="px-4 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleOptimize}
                disabled={isProcessing}
                className="px-6 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    处理中...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    开始优化
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleReset}
                className="px-4 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                重新优化
              </button>
              <button
                onClick={handleConfirm}
                className="px-6 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                使用此图
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
