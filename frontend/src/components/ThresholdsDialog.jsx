import React, { useState, useEffect } from "react";
import { loadThresholds, saveThresholds, resetThresholds, DEFAULT_THRESHOLDS } from "@/lib/thresholds";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { settingsGet, settingsUpdate, settingsTestWebhook } from "@/lib/api";
import CurrencySelector from "@/components/CurrencySelector";
import { Settings, X, RotateCcw, Loader2, Check, MessagesSquare, Slack, Send } from "lucide-react";
import { toast } from "sonner";

export default function ThresholdsDialog() {
    const [open, setOpen] = useState(false);
    const [t, setT] = useState(loadThresholds());
    const { t: tr } = useI18n();

    useEffect(() => {
        if (open) setT(loadThresholds());
    }, [open]);

    const update = (kind, key, val) => {
        const num = parseFloat(val);
        setT(prev => ({
            ...prev,
            [kind]: { ...prev[kind], [key]: isNaN(num) ? 0 : num },
        }));
    };

    const handleSave = () => {
        const fix = (k) => ({
            cheap: Math.max(t[k].cheap, t[k].fair + 0.1),
            fair: t[k].fair,
        });
        const safe = { compra: fix("compra"), venta: fix("venta") };
        saveThresholds(safe);
        setT(safe);
        setOpen(false);
    };

    const handleReset = () => {
        resetThresholds();
        setT(DEFAULT_THRESHOLDS);
    };

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="btn-ghost flex items-center gap-2 !py-1 !px-2 text-xs"
                data-testid="settings-open"
                title="Ajustes: umbrales, integraciones para compartir y moneda"
            >
                <Settings size={14} /> Ajustes
            </button>

            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(17,17,17,0.4)" }} data-testid="settings-modal">
                    <div className="bg-white border border-black w-full max-w-lg p-6 max-h-[92vh] overflow-y-auto">
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <div className="overline text-[#B32A22]">Ajustes</div>
                                <h2 className="font-serif text-2xl">Preferencias de Valuation Studio</h2>
                            </div>
                            <button onClick={() => setOpen(false)} className="text-[#4A4A4A] hover:text-black" data-testid="settings-close"><X size={16} /></button>
                        </div>

                        {/* Moneda */}
                        <section className="mb-6">
                            <div className="overline text-[#4A4A4A] mb-2">Moneda de los precios</div>
                            <CurrencySelector />
                        </section>

                        {/* Compartir / Integraciones */}
                        <IntegrationsSection />

                        {/* Umbrales */}
                        <section>
                            <div className="overline text-[#4A4A4A] mb-1">Umbrales cara / justa / barata</div>
                            <p className="text-xs text-[#4A4A4A] mb-3">
                                Ajusta a partir de qué porcentaje de upside (Ratio Compra/Venta) consideras una acción cara, justa o barata. Se aplica en toda la app y se guarda en este navegador.
                            </p>
                            <ThresholdRow label="Ratio de Compra" kind="compra" cheap={t.compra.cheap} fair={t.compra.fair} onChange={update} />
                            <div className="h-3" />
                            <ThresholdRow label="Ratio de Venta" kind="venta" cheap={t.venta.cheap} fair={t.venta.fair} onChange={update} />
                            <div className="flex justify-between gap-2 mt-4 items-center">
                                <button onClick={handleReset} className="btn-ghost flex items-center gap-2 text-xs" data-testid="thresholds-reset">
                                    <RotateCcw size={12} /> Valores por defecto
                                </button>
                                <div className="flex gap-2">
                                    <button onClick={() => setOpen(false)} className="btn-ghost" data-testid="settings-cancel">Cerrar</button>
                                    <button onClick={handleSave} className="btn-primary" data-testid="thresholds-save">Guardar umbrales</button>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            )}
        </>
    );
}

function IntegrationsSection() {
    const { user } = useAuth();
    const [st, setSt] = useState(null);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        setLoading(true);
        try { setSt(await settingsGet()); } catch { /* ignore */ } finally { setLoading(false); }
    };
    useEffect(() => { if (user) load(); }, [user]);

    return (
        <section className="mb-6 border border-black/15 bg-[#FAF6EE] p-3">
            <div className="overline text-[#4A4A4A] mb-1">Compartir · Integraciones</div>
            <p className="text-[11px] text-[#4A4A4A] mb-3 leading-snug">
                Pega la URL de un <strong>webhook entrante</strong> de tu canal de Discord o Slack para poder publicar en él los documentos que compartas. La URL se guarda en tu cuenta y no se muestra completa.
            </p>
            {!user ? (
                <div className="text-xs text-[#7A7A7A]" data-testid="settings-integrations-nologin">Inicia sesión para configurar las integraciones.</div>
            ) : loading ? (
                <div className="text-xs text-[#7A7A7A] inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Cargando…</div>
            ) : (
                <div className="space-y-3">
                    <WebhookRow target="discord" label="Discord" Icon={MessagesSquare} placeholder="https://discord.com/api/webhooks/…"
                        isSet={st?.discord_webhook_set} masked={st?.discord_webhook_masked} onSaved={load} />
                    <WebhookRow target="slack" label="Slack" Icon={Slack} placeholder="https://hooks.slack.com/services/…"
                        isSet={st?.slack_webhook_set} masked={st?.slack_webhook_masked} onSaved={load} />
                </div>
            )}
        </section>
    );
}

function WebhookRow({ target, label, Icon, placeholder, isSet, masked, onSaved }) {
    const [val, setVal] = useState("");
    const [busy, setBusy] = useState(false);
    const [testing, setTesting] = useState(false);

    const save = async () => {
        setBusy(true);
        try {
            await settingsUpdate({ [`${target}_webhook`]: val.trim() });
            setVal("");
            toast.success(`${label}: guardado`);
            onSaved?.();
        } catch (e) { toast.error(e?.response?.data?.detail || "No se pudo guardar"); }
        finally { setBusy(false); }
    };
    const clear = async () => {
        setBusy(true);
        try { await settingsUpdate({ [`${target}_webhook`]: "" }); toast.success(`${label}: eliminado`); onSaved?.(); }
        catch { toast.error("No se pudo eliminar"); } finally { setBusy(false); }
    };
    const test = async () => {
        setTesting(true);
        try { await settingsTestWebhook(target); toast.success(`${label}: mensaje de prueba enviado`); }
        catch (e) { toast.error(e?.response?.data?.detail || "No se pudo enviar la prueba"); }
        finally { setTesting(false); }
    };

    return (
        <div className="bg-white border border-black/15 p-2.5" data-testid={`webhook-row-${target}`}>
            <div className="flex items-center justify-between mb-1.5">
                <div className="text-xs font-semibold inline-flex items-center gap-1.5"><Icon size={14} /> {label}</div>
                {isSet ? (
                    <span className="text-[10px] text-[#1D7044] inline-flex items-center gap-1" data-testid={`webhook-status-${target}`}><Check size={11} /> Configurado {masked}</span>
                ) : (
                    <span className="text-[10px] text-[#9A9A9A]" data-testid={`webhook-status-${target}`}>No configurado</span>
                )}
            </div>
            <div className="flex items-center gap-2">
                <input type="password" value={val} onChange={(e) => setVal(e.target.value)} placeholder={placeholder}
                    className="flex-1 min-w-0 border border-black/25 bg-white px-2 py-1 text-xs outline-none" data-testid={`webhook-input-${target}`} />
                <button onClick={save} disabled={busy || !val.trim()} className="btn-primary !py-1 !px-2.5 text-xs disabled:opacity-40" data-testid={`webhook-save-${target}`}>
                    {busy ? <Loader2 size={12} className="animate-spin" /> : "Guardar"}
                </button>
            </div>
            {isSet && (
                <div className="flex items-center gap-3 mt-1.5">
                    <button onClick={test} disabled={testing} className="text-[11px] text-[#052049] inline-flex items-center gap-1 hover:underline disabled:opacity-50" data-testid={`webhook-test-${target}`}>
                        {testing ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Probar
                    </button>
                    <button onClick={clear} disabled={busy} className="text-[11px] text-[#B32A22] hover:underline disabled:opacity-50" data-testid={`webhook-clear-${target}`}>Eliminar</button>
                </div>
            )}
        </div>
    );
}

function ThresholdRow({ label, kind, cheap, fair, onChange }) {
    return (
        <div className="border border-black/15 p-3 bg-[#FAF6EE]">
            <div className="overline text-[#4A4A4A] mb-2">{label}</div>
            <div className="grid grid-cols-2 gap-3 text-xs">
                <label className="flex flex-col gap-1">
                    <span className="text-[#4A4A4A]">Umbral BARATA ≥</span>
                    <div className="flex items-center gap-2">
                        <input type="range" min="0" max="200" step="1" value={cheap} onChange={(e) => onChange(kind, "cheap", e.target.value)} className="flex-1" data-testid={`slider-${kind}-cheap`} />
                        <input type="number" step="0.5" value={cheap} onChange={(e) => onChange(kind, "cheap", e.target.value)} className="w-16 input-paper text-right font-mono" data-testid={`input-${kind}-cheap`} />
                        <span className="font-mono">%</span>
                    </div>
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[#4A4A4A]">Umbral JUSTA ≥</span>
                    <div className="flex items-center gap-2">
                        <input type="range" min="-100" max="100" step="1" value={fair} onChange={(e) => onChange(kind, "fair", e.target.value)} className="flex-1" data-testid={`slider-${kind}-fair`} />
                        <input type="number" step="0.5" value={fair} onChange={(e) => onChange(kind, "fair", e.target.value)} className="w-16 input-paper text-right font-mono" data-testid={`input-${kind}-fair`} />
                        <span className="font-mono">%</span>
                    </div>
                </label>
            </div>
            <div className="text-[10px] font-mono text-[#4A4A4A] mt-2">
                {`Por debajo de ${fair}% → CARA · entre ${fair}% y ${cheap}% → JUSTA · ≥ ${cheap}% → BARATA`}
            </div>
        </div>
    );
}
