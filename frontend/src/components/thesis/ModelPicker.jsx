import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cpu, Loader2, Check, FlaskConical } from "lucide-react";
import { thesisModels, thesisSetModel } from "@/lib/api";
import HoverTip from "@/components/HoverTip";

const ENABLED = process.env.REACT_APP_ENABLE_MODEL_PANEL === "true";

const fmtEur = (n) => `${(Number(n) || 0).toFixed(n >= 1 ? 2 : 4)} €`;

/** DEV-ONLY cost/quality model switch with per-preset usage counters.
 *  Hidden in production (gated by REACT_APP_ENABLE_MODEL_PANEL). */
export default function ModelPicker({ canSwitch = true, reloadSignal = 0 }) {
    const [data, setData] = useState(null);
    const [saving, setSaving] = useState(null);

    const load = () => thesisModels().then(setData).catch(() => {});
    useEffect(() => { if (ENABLED) load(); }, [reloadSignal]);

    if (!ENABLED || !data) return null;

    const choose = async (key) => {
        if (key === data.active || saving) return;
        if (!canSwitch) { toast.error("Inicia sesión para cambiar el modelo"); return; }
        setSaving(key);
        try {
            const res = await thesisSetModel(key);
            setData((d) => ({ ...d, active: res.active }));
            const p = data.presets.find((x) => x.key === key);
            toast.success(`Modelo activo: ${p?.label || key}`);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo cambiar el modelo");
        } finally {
            setSaving(null);
        }
    };

    return (
        <div className="border border-dashed border-[#B8860B] bg-[#FCF6E8] p-4 mb-6" data-testid="model-picker">
            <div className="flex items-center gap-2 mb-1">
                <FlaskConical size={13} className="text-[#B8860B]" />
                <span className="overline text-[#7a5a10]">Modelos de IA · solo entorno de pruebas</span>
            </div>
            <p className="text-[11px] text-[#7a5a10] mb-3 leading-snug">
                Cambia el coste/calidad de las generaciones. Pasa el cursor sobre cada botón para ver qué modelos actúan. Contadores = generaciones hechas y € estimados con ese preset.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="model-picker-options">
                {data.presets.map((p) => {
                    const active = p.key === data.active;
                    return (
                        <div key={p.key} className="flex flex-col">
                            <HoverTip
                                text={`${p.desc}\n\n• Investigación: ${p.investigator}\n• Síntesis/scoring: ${p.synthesizer}`}
                                maxWidth={320}
                            >
                                <button
                                    onClick={() => choose(p.key)}
                                    disabled={!!saving}
                                    className={`w-full px-3 py-2.5 text-xs uppercase tracking-[0.1em] font-semibold border flex items-center justify-center gap-1.5 transition-colors ${
                                        active
                                            ? "bg-black text-[#FDF1E6] border-black"
                                            : "bg-white text-[#4A4A4A] border-black/30 hover:bg-[#F5E4D4]"
                                    } disabled:opacity-60`}
                                    data-testid={`model-preset-${p.key}`}
                                >
                                    {saving === p.key ? <Loader2 size={13} className="animate-spin" />
                                        : active ? <Check size={13} /> : <Cpu size={13} />}
                                    {p.label}
                                </button>
                            </HoverTip>
                            <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#7a5a10] font-mono px-0.5" data-testid={`model-counter-${p.key}`}>
                                <span title="Generaciones realizadas con este preset">{p.theses} tesis</span>
                                <span title="Coste estimado acumulado (€)">{fmtEur(p.cost_eur)}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
            <p className="text-[10px] text-[#9a8048] mt-2">Coste en € estimado a partir del nº de tokens (ajustable). Mide el consumo real en Profile → Universal Key.</p>
        </div>
    );
}
