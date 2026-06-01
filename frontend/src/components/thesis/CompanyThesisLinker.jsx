import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Link2, Loader2, Plus, FilePlus2, Check, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { thesisLinkSuggestions, thesisAddCompany } from "@/lib/api";

/**
 * F5 — Cross-linking. On a company thesis, suggests existing trend-theses the
 * company fits (offer to add it) and trends without a thesis (offer to create one).
 */
export default function CompanyThesisLinker({ thesisId, company }) {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState(null);
    const [addingId, setAddingId] = useState(null);
    const [addedIds, setAddedIds] = useState([]);

    if (!user || !thesisId) return null;

    const load = async () => {
        setLoading(true);
        try {
            const res = await thesisLinkSuggestions(thesisId);
            setData(res);
            if (!(res.to_add?.length || res.to_create?.length)) {
                toast.info("Sin sugerencias: aún no tienes tesis de tendencia relacionadas.");
            }
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudieron calcular las sugerencias.");
        } finally {
            setLoading(false);
        }
    };

    const addTo = async (targetThesisId) => {
        setAddingId(targetThesisId);
        try {
            await thesisAddCompany(targetThesisId, company?.ticker, company?.name);
            setAddedIds((p) => [...p, targetThesisId]);
            toast.success(`${company?.ticker || "Empresa"} añadida a la tesis`);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo añadir la empresa.");
        } finally {
            setAddingId(null);
        }
    };

    return (
        <div className="border border-[#052049]/40 bg-[#eef2f8] p-4 mt-6" data-testid="company-linker">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-sm text-[#052049]">
                    <Link2 size={16} className="shrink-0" />
                    <span>Vincula <strong>{company?.ticker || company?.name}</strong> con tus tesis de tendencia.</span>
                </div>
                {!data && (
                    <button
                        onClick={load}
                        disabled={loading}
                        className="text-xs uppercase tracking-[0.12em] font-semibold border border-[#052049] text-[#052049] px-3 py-1.5 hover:bg-[#052049] hover:text-white transition-colors flex items-center gap-2 disabled:opacity-60"
                        data-testid="linker-load-btn"
                    >
                        {loading ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                        {loading ? "Analizando…" : "Buscar vínculos"}
                    </button>
                )}
            </div>

            {data && (
                <div className="mt-4 space-y-4">
                    {data.to_add?.length > 0 && (
                        <div data-testid="linker-to-add">
                            <div className="overline text-[#052049] mb-2">Añadir a una tesis existente</div>
                            <div className="space-y-2">
                                {data.to_add.map((a, i) => {
                                    const added = addedIds.includes(a.thesis_id);
                                    return (
                                        <div key={i} className="border border-black/15 bg-white p-2.5 flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <Link to={`/thesis/${a.thesis_id}`} className="text-sm font-medium hover:underline truncate block">{a.thesis_title}</Link>
                                                <div className="text-xs text-[#4A4A4A]">{a.reason}</div>
                                            </div>
                                            <button
                                                onClick={() => addTo(a.thesis_id)}
                                                disabled={added || addingId === a.thesis_id}
                                                className={`text-xs font-semibold px-2.5 py-1.5 flex items-center gap-1 shrink-0 transition-colors ${added ? "bg-[#1E7D45] text-white" : "bg-black text-[#FDF1E6] hover:bg-[#052049]"} disabled:opacity-70`}
                                                data-testid={`linker-add-${i}`}
                                            >
                                                {addingId === a.thesis_id ? <Loader2 size={12} className="animate-spin" /> : added ? <Check size={12} /> : <Plus size={12} />}
                                                {added ? "Añadida" : addingId === a.thesis_id ? "Añadiendo…" : "Añadir"}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {data.to_create?.length > 0 && (
                        <div data-testid="linker-to-create">
                            <div className="overline text-[#B32A22] mb-2">Tendencias sin tesis · crear nueva</div>
                            <div className="space-y-2">
                                {data.to_create.map((c, i) => (
                                    <div key={i} className="border border-black/15 bg-white p-2.5 flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium truncate">{c.trend_name}</div>
                                            <div className="text-xs text-[#4A4A4A]">{c.why}</div>
                                        </div>
                                        <Link
                                            to={`/thesis?trend=${encodeURIComponent(c.trend_name)}`}
                                            className="text-xs font-semibold border border-[#B32A22] text-[#B32A22] px-2.5 py-1.5 flex items-center gap-1 shrink-0 hover:bg-[#B32A22] hover:text-white transition-colors"
                                            data-testid={`linker-create-${i}`}
                                        >
                                            <FilePlus2 size={12} /> Crear tesis <ArrowRight size={11} />
                                        </Link>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {!data.to_add?.length && !data.to_create?.length && (
                        <div className="text-xs text-[#4A4A4A]">Sin sugerencias de vínculo.</div>
                    )}
                </div>
            )}
        </div>
    );
}
