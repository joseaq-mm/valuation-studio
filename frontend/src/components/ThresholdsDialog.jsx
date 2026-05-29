import React, { useState, useEffect } from "react";
import { loadThresholds, saveThresholds, resetThresholds, DEFAULT_THRESHOLDS } from "@/lib/thresholds";
import { useI18n } from "@/lib/i18n";
import { Sliders, X, RotateCcw } from "lucide-react";

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
        // Enforce cheap > fair to avoid inverted colour bands
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
                data-testid="thresholds-open"
                title="Configurar umbrales de señal cara / justa / barata"
            >
                <Sliders size={14} /> {tr("nav.thresholds")}
            </button>

            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(17,17,17,0.4)" }} data-testid="thresholds-modal">
                    <div className="bg-white border border-black w-full max-w-lg p-6">
                        <div className="flex items-start justify-between mb-2">
                            <div>
                                <div className="overline text-[#B32A22]">Configurar señales</div>
                                <h2 className="font-serif text-2xl">Umbrales cara / justa / barata</h2>
                            </div>
                            <button onClick={() => setOpen(false)} className="text-[#4A4A4A] hover:text-black" data-testid="thresholds-close"><X size={16} /></button>
                        </div>
                        <p className="text-xs text-[#4A4A4A] mb-4">
                            Ajusta a partir de qué porcentaje de upside (Ratio Compra/Venta) consideras una acción cara, justa o barata. Se aplica en toda la app y se guarda en este navegador.
                        </p>

                        <ThresholdRow
                            label="Ratio de Compra"
                            kind="compra"
                            cheap={t.compra.cheap} fair={t.compra.fair}
                            onChange={update}
                        />
                        <div className="h-3" />
                        <ThresholdRow
                            label="Ratio de Venta"
                            kind="venta"
                            cheap={t.venta.cheap} fair={t.venta.fair}
                            onChange={update}
                        />

                        <div className="flex justify-between gap-2 mt-6 items-center">
                            <button onClick={handleReset} className="btn-ghost flex items-center gap-2 text-xs" data-testid="thresholds-reset">
                                <RotateCcw size={12} /> Valores por defecto
                            </button>
                            <div className="flex gap-2">
                                <button onClick={() => setOpen(false)} className="btn-ghost" data-testid="thresholds-cancel">Cancelar</button>
                                <button onClick={handleSave} className="btn-primary" data-testid="thresholds-save">Guardar</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
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
                        <input
                            type="range" min="0" max="200" step="1"
                            value={cheap}
                            onChange={(e) => onChange(kind, "cheap", e.target.value)}
                            className="flex-1"
                            data-testid={`slider-${kind}-cheap`}
                        />
                        <input
                            type="number" step="0.5"
                            value={cheap}
                            onChange={(e) => onChange(kind, "cheap", e.target.value)}
                            className="w-16 input-paper text-right font-mono"
                            data-testid={`input-${kind}-cheap`}
                        />
                        <span className="font-mono">%</span>
                    </div>
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[#4A4A4A]">Umbral JUSTA ≥</span>
                    <div className="flex items-center gap-2">
                        <input
                            type="range" min="-100" max="100" step="1"
                            value={fair}
                            onChange={(e) => onChange(kind, "fair", e.target.value)}
                            className="flex-1"
                            data-testid={`slider-${kind}-fair`}
                        />
                        <input
                            type="number" step="0.5"
                            value={fair}
                            onChange={(e) => onChange(kind, "fair", e.target.value)}
                            className="w-16 input-paper text-right font-mono"
                            data-testid={`input-${kind}-fair`}
                        />
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
