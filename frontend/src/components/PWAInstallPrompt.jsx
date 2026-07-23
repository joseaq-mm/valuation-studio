import React, { useState, useEffect, useCallback } from "react";
import { Download, X, Share } from "lucide-react";

const DISMISS_KEY = "vs_pwa_dismissed_at";
const DISMISS_DAYS = 14;

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  window.matchMedia?.("(display-mode: minimal-ui)").matches ||
  window.navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;

const recentlyDismissed = () => {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return t && Date.now() - t < DISMISS_DAYS * 86400000;
  } catch { return false; }
};

// Floating banner to install the app. Uses beforeinstallprompt on Android/Chrome/Edge;
// on iOS Safari (no such event) it shows the manual "Compartir → Añadir a pantalla de inicio" hint.
export default function PWAInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;
    const onBIP = (e) => {
      e.preventDefault();
      setDeferred(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    // iOS never fires beforeinstallprompt → offer the manual hint after a short delay.
    let t;
    if (isIOS()) {
      t = setTimeout(() => { setIosHint(true); setShow(true); }, 2500);
    }
    const onInstalled = () => { setShow(false); dismiss(); };
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
      if (t) clearTimeout(t);
    };
  }, []);

  const dismiss = useCallback(() => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setShow(false);
  }, []);

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* ignore */ }
    setDeferred(null);
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-md border-2 border-[#052049] bg-white shadow-[6px_6px_0_0_rgba(5,32,73,0.18)] p-3 flex items-start gap-3 animate-in slide-in-from-bottom-4"
      data-testid="pwa-install-prompt"
      role="dialog"
      aria-label="Instalar Valuation Studio"
    >
      <img src="/icon-192.png" alt="" className="w-11 h-11 border border-black/10 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-serif text-lg leading-tight text-[#052049]">Instala Valuation Studio</div>
        {iosHint ? (
          <p className="text-xs text-[#4A4A4A] mt-0.5 leading-snug">
            Pulsa <Share size={12} className="inline -mt-0.5 text-[#052049]" /> <strong>Compartir</strong> y luego
            <strong> “Añadir a pantalla de inicio”</strong> para usarla como app.
          </p>
        ) : (
          <p className="text-xs text-[#4A4A4A] mt-0.5 leading-snug">
            Añádela a tu pantalla de inicio y ábrela como una app, con acceso directo y pantalla completa.
          </p>
        )}
        {!iosHint && (
          <button
            onClick={install}
            className="btn-primary mt-2 inline-flex items-center gap-1.5 !py-1.5 !px-3 text-xs"
            data-testid="pwa-install-btn"
          >
            <Download size={13} /> Instalar app
          </button>
        )}
      </div>
      <button
        onClick={dismiss}
        className="text-[#9A9A9A] hover:text-[#052049] p-0.5 shrink-0"
        aria-label="Cerrar"
        data-testid="pwa-install-dismiss"
      >
        <X size={18} />
      </button>
    </div>
  );
}
