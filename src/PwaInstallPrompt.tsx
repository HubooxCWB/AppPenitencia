import {Download, Share, X} from 'lucide-react';
import {useEffect, useState} from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
}

const DISMISSED_KEY = 'penitencia-pwa-install-dismissed';

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in navigator && (navigator as Navigator & {standalone?: boolean}).standalone === true);

export default function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone() || sessionStorage.getItem(DISMISSED_KEY)) return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      setVisible(true);
    }

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const handleInstalled = () => {
      setVisible(false);
      setInstallEvent(null);
    };

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, 'true');
    setVisible(false);
  };

  const install = async () => {
    if (!installEvent) {
      setShowIosHelp(true);
      return;
    }

    await installEvent.prompt();
    const {outcome} = await installEvent.userChoice;
    if (outcome === 'accepted') setVisible(false);
    setInstallEvent(null);
  };

  return (
    <aside
      className="fixed inset-x-3 z-[100] mx-auto max-w-md rounded-2xl border border-primary/25 bg-black/95 p-4 text-slate-100 shadow-2xl backdrop-blur-xl bottom-[calc(6.3rem+env(safe-area-inset-bottom))]"
      aria-label="Instalar Penitência CWB"
    >
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white"
        aria-label="Fechar convite de instalação"
      >
        <X size={17} />
      </button>

      {showIosHelp ? (
        <div className="pr-7">
          <p className="font-bold text-primary">Adicionar à Tela de Início</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">
            No Safari, toque em <Share size={16} className="mx-1 inline text-primary" aria-label="Compartilhar" />
            e depois em <strong className="text-white">Adicionar à Tela de Início</strong>.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3 pr-7">
          <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" className="size-12 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-white">Instale o Penitência CWB</p>
            <p className="text-xs text-slate-400">Acesso rápido e experiência em tela cheia.</p>
          </div>
          <button
            type="button"
            onClick={install}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-black text-background-dark"
          >
            <Download size={15} />
            Instalar
          </button>
        </div>
      )}
    </aside>
  );
}
