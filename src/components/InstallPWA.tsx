'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * A quiet install action in the header, not a floating promotion.
 * Browsers without beforeinstallprompt still get useful manual instructions.
 */
export default function InstallPWA() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const ios = /iPad|iPhone|iPod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIsIOS(ios);

    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsInstalled(standalone);

    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setShowInstructions(false);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      setShowInstructions(false);
    };

    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) {
      setShowInstructions((open) => !open);
      return;
    }

    setShowInstructions(false);
    try {
      // Must be invoked directly from the user's click for browser permission.
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') setInstallPrompt(null);
    } catch {
      setShowInstructions(true);
    }
  };

  if (isInstalled) return null;

  return (
    <div className="studio-install-wrap">
      <button
        type="button"
        className="studio-nav-note studio-install-button"
        onClick={handleInstall}
        aria-expanded={showInstructions}
        aria-controls={showInstructions ? 'studio-install-help' : undefined}
      >
        安装应用
      </button>

      {showInstructions && (
        <div className="studio-install-help" id="studio-install-help" role="status">
          <strong>添加到桌面</strong>
          <p>
            {isIOS
              ? '在 Safari 中点击分享按钮，选择「添加到主屏幕」。'
              : '打开浏览器菜单，选择「安装应用」或「添加到主屏幕」。如果没有此选项，可能是浏览器暂不支持。'}
          </p>
          <button type="button" className="studio-install-close" onClick={() => setShowInstructions(false)}>
            知道了
          </button>
        </div>
      )}
    </div>
  );
}
