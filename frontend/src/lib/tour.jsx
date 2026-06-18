import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { X, ArrowLeft, ArrowRight } from "lucide-react";

// Cross-page guided tour. Each step may navigate to a route and spotlight a
// target element (by CSS selector). Custom-built (no external deps) for React 19.
const STEPS = [
    {
        path: "/", target: '[data-testid="hero-section"]',
        title: { es: "Bienvenido a Valuation Studio", en: "Welcome to Valuation Studio" },
        body: {
            es: "Esta es tu mesa de análisis fundamental. Busca cualquier empresa cotizada y la app calcula al instante si está cara o barata con tus propias fórmulas. Te enseño las funciones clave en 1 minuto.",
            en: "This is your fundamental research desk. Search any listed company and the app instantly shows if it's expensive or cheap using your own formulas. Let me show you the key features in 1 minute.",
        },
    },
    {
        path: "/", target: '[data-testid="search-form"]',
        title: { es: "Buscador global", en: "Global search" },
        body: {
            es: "Desde aquí buscas cualquier ticker del mundo (AAPL, SAN.MC, SAP.DE, VOD.L…). Los datos vienen de Yahoo Finance y se actualizan solos.",
            en: "Search any ticker worldwide (AAPL, SAN.MC, SAP.DE, VOD.L…). Data comes from Yahoo Finance and stays up to date automatically.",
        },
    },
    {
        path: "/company/AAPL", target: '[data-testid="company-header"]',
        title: { es: "Ficha de empresa · POC y POV", en: "Company page · POC & POV" },
        body: {
            es: "Aquí ves los KPIs y los precios objetivo POC (compra) y POV (venta). El Ratio de Compra te dice el margen frente al precio actual. Puedes editar los inputs y recalcular en vivo.",
            en: "Here you see the KPIs and the POC (buy) and POV (sell) target prices. The Buy Ratio shows the gap to the current price. You can edit inputs and recompute live.",
        },
    },
    {
        path: "/watchlist", target: '[data-testid="watchlist-page"]',
        title: { es: "Watchlist", en: "Watchlist" },
        body: {
            es: "Tu lista de seguimiento. Guarda ajustes manuales por empresa y activa la campana para recibir alertas cuando una acción cruce de cara a barata.",
            en: "Your watchlist. Save manual tweaks per company and turn on the bell to get alerts when a stock crosses from expensive to cheap.",
        },
    },
    {
        path: "/portfolio", target: '[data-testid="portfolio-page"]',
        title: { es: "Cartera", en: "Portfolio" },
        body: {
            es: "Registra tus posiciones reales y mira el P/L vivo, el P/L % y los totales. También puedes añadir posiciones de «solo seguimiento» sin compra.",
            en: "Track your real positions and see live P/L, P/L % and totals. You can also add 'watch-only' positions without a purchase.",
        },
    },
    {
        path: "/compare", target: '[data-testid="compare-page"]',
        title: { es: "Comparar", en: "Compare" },
        body: {
            es: "Pon hasta 6 empresas lado a lado para comparar sus ratios y señales de un vistazo.",
            en: "Put up to 6 companies side by side to compare their ratios and signals at a glance.",
        },
    },
    {
        path: "/thesis", target: '[data-testid="thesis-generator"]',
        title: { es: "Tesis · el cerebro cualitativo", en: "Thesis · the qualitative brain" },
        body: {
            es: "El Thesis Engine usa IA para explorar tendencias y generar tesis de inversión por empresa, con scores de calidad, probabilidad y TAM Score. Los números dicen si está barata; aquí ves si el negocio va a crecer.",
            en: "The Thesis Engine uses AI to explore trends and generate investment theses per company, with quality, probability and TAM scores. Numbers tell you if it's cheap; here you see if the business will grow.",
        },
    },
    {
        path: "/", target: '[data-testid="home-help-buttons"]',
        title: { es: "¿Necesitas más ayuda?", en: "Need more help?" },
        body: {
            es: "Tienes las Instrucciones completas (con descarga en PDF) y el botón de Ayuda en la cabecera para preguntarle cualquier duda al asistente. ¡Listo para empezar!",
            en: "You have the full Instructions (with PDF download) and the Help button in the header to ask the assistant anything. You're ready to start!",
        },
    },
];

const TourCtx = createContext(null);
export const useTour = () => useContext(TourCtx);

export function TourProvider({ children }) {
    const navigate = useNavigate();
    const location = useLocation();
    const [running, setRunning] = useState(false);
    const [idx, setIdx] = useState(0);
    const [rect, setRect] = useState(null);
    const pollRef = useRef(null);

    const start = useCallback(() => { setIdx(0); setRunning(true); }, []);
    const finish = useCallback(() => {
        setRunning(false);
        setRect(null);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }, []);

    const step = STEPS[idx];

    // Drive navigation + element spotlight as the step / route changes.
    useEffect(() => {
        if (!running) return;
        const s = STEPS[idx];
        if (!s) return;
        if (location.pathname !== s.path) {
            navigate(s.path);
            return; // location change re-triggers this effect
        }
        if (pollRef.current) clearInterval(pollRef.current);
        let tries = 0;
        setRect(null);
        pollRef.current = setInterval(() => {
            tries += 1;
            const el = s.target ? document.querySelector(s.target) : null;
            if (el) {
                clearInterval(pollRef.current);
                pollRef.current = null;
                try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { /* noop */ }
                setTimeout(() => setRect(el.getBoundingClientRect()), 350);
            } else if (tries > 60) {
                clearInterval(pollRef.current);
                pollRef.current = null;
                setRect(null); // fall back to a centered tooltip
            }
        }, 100);
        return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
    }, [running, idx, location.pathname, navigate]);

    // Keep the spotlight aligned on resize/scroll.
    useEffect(() => {
        if (!running) return;
        const s = STEPS[idx];
        const recompute = () => {
            const el = s && s.target ? document.querySelector(s.target) : null;
            if (el) setRect(el.getBoundingClientRect());
        };
        window.addEventListener("resize", recompute);
        window.addEventListener("scroll", recompute, true);
        const onKey = (e) => { if (e.key === "Escape") finish(); };
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("resize", recompute);
            window.removeEventListener("scroll", recompute, true);
            window.removeEventListener("keydown", onKey);
        };
    }, [running, idx, finish]);

    const next = () => { if (idx >= STEPS.length - 1) finish(); else setIdx((i) => i + 1); };
    const prev = () => setIdx((i) => Math.max(0, i - 1));

    return (
        <TourCtx.Provider value={{ start, running }}>
            {children}
            {running && step && (
                <TourOverlay
                    rect={rect}
                    step={step}
                    idx={idx}
                    total={STEPS.length}
                    onNext={next}
                    onPrev={prev}
                    onClose={finish}
                />
            )}
        </TourCtx.Provider>
    );
}

function TourOverlay({ rect, step, idx, total, onNext, onPrev, onClose }) {
    const { lang } = useI18n();
    const L = (o) => (o && (o[lang] || o.es)) || "";
    const pad = 8;

    // Tooltip position: below the target if there's room, otherwise above; centered if no rect.
    const cardW = 360;
    let cardStyle;
    if (rect) {
        const vh = window.innerHeight;
        const below = rect.bottom + 16 + 200 < vh;
        const top = below ? rect.bottom + pad + 12 : Math.max(12, rect.top - pad - 12 - 200);
        let left = rect.left + rect.width / 2 - cardW / 2;
        left = Math.max(12, Math.min(left, window.innerWidth - cardW - 12));
        cardStyle = { top, left, width: cardW };
    } else {
        cardStyle = { top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: cardW };
    }

    return createPortal(
        <div className="fixed inset-0 z-[9999]" data-testid="tour-overlay">
            {/* Spotlight (or full dim if no target) */}
            {rect ? (
                <div
                    className="absolute pointer-events-none transition-all duration-300"
                    style={{
                        top: rect.top - pad,
                        left: rect.left - pad,
                        width: rect.width + pad * 2,
                        height: rect.height + pad * 2,
                        boxShadow: "0 0 0 9999px rgba(10,10,10,0.62)",
                        border: "2px solid #B32A22",
                        borderRadius: 2,
                    }}
                />
            ) : (
                <div className="absolute inset-0" style={{ background: "rgba(10,10,10,0.62)" }} />
            )}

            {/* Tooltip card */}
            <div
                className="absolute bg-[#FDF1E6] border border-black shadow-xl p-5"
                style={cardStyle}
                data-testid="tour-card"
            >
                <button
                    onClick={onClose}
                    className="absolute top-2 right-2 text-black/50 hover:text-black"
                    aria-label="cerrar"
                    data-testid="tour-close"
                >
                    <X size={16} />
                </button>
                <div className="overline text-[#B32A22] mb-1 text-[11px]">
                    {idx + 1} / {total}
                </div>
                <div className="font-serif text-xl leading-tight mb-2 pr-4">{L(step.title)}</div>
                <p className="text-sm text-[#3A3A3A] leading-relaxed mb-4">{L(step.body)}</p>
                <div className="flex items-center justify-between gap-2">
                    <button
                        onClick={onClose}
                        className="text-xs uppercase tracking-[0.12em] text-[#4A4A4A] hover:text-black"
                        data-testid="tour-skip"
                    >
                        {lang === "en" ? "Skip" : "Saltar"}
                    </button>
                    <div className="flex items-center gap-2">
                        {idx > 0 && (
                            <button
                                onClick={onPrev}
                                className="btn-ghost !py-1.5 !px-3 flex items-center gap-1"
                                data-testid="tour-prev"
                            >
                                <ArrowLeft size={13} /> {lang === "en" ? "Back" : "Atrás"}
                            </button>
                        )}
                        <button
                            onClick={onNext}
                            className="btn-primary !py-1.5 !px-3 flex items-center gap-1"
                            data-testid="tour-next"
                        >
                            {idx >= total - 1 ? (lang === "en" ? "Finish" : "Finalizar") : (lang === "en" ? "Next" : "Siguiente")}
                            {idx < total - 1 && <ArrowRight size={13} />}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
