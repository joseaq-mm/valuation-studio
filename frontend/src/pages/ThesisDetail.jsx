import React, { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { thesisGet, thesisGenerateContra, thesisRefreshRun, thesisGeneratePlan, thesisWaitPlanDone } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import ThesisResult from "@/components/thesis/ThesisResult";
import TendenciaResult from "@/components/thesis/TendenciaResult";
import RefreshButton from "@/components/RefreshButton";

export default function ThesisDetail() {
    const { id } = useParams();
    const { user } = useAuth();
    const navigate = useNavigate();
    const [thesis, setThesis] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sourceCompany, setSourceCompany] = useState(null);
    const [generatingContra, setGeneratingContra] = useState(false);
    const [generatingPlan, setGeneratingPlan] = useState(false);

    // If this thesis was born from a company plan, resolve the origin company's
    // name so we can offer a "back to <company>" link to its plan page.
    useEffect(() => {
        const srcId = thesis?.source_company_thesis_id;
        if (!srcId) { setSourceCompany(null); return; }
        let alive = true;
        thesisGet(srcId)
            .then((d) => { if (alive) setSourceCompany({ id: srcId, name: d?.company?.name || thesis?.origin_ticker || "la empresa" }); })
            .catch(() => { if (alive) setSourceCompany({ id: srcId, name: thesis?.origin_ticker || "la empresa" }); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [thesis?.source_company_thesis_id]);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        thesisGet(id)
            .then((d) => { if (alive) { setThesis(d); setError(null); } })
            .catch((e) => { if (alive) setError(e?.response?.data?.detail || "No se pudo cargar la tesis"); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [id]);

    const generateContra = async () => {
        setGeneratingContra(true);
        try {
            const contra = await thesisGenerateContra(id);
            setThesis((prev) => ({ ...prev, contra }));
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo generar la contratesis");
        } finally {
            setGeneratingContra(false);
        }
    };

    const isTendencia = thesis?.type === "tendencia";

    // "Generar plan": execute the whole plan (enqueue every non-merged driver, serial).
    // Reloads the thesis immediately to show locked planning + pending states, then
    // keeps polling until EVERY queued job lands (not just the first) so the UI reflects
    // each new "✓ generada" as it happens without needing a manual refresh.
    const generatePlan = async (companyId) => {
        if (!companyId) return;
        setGeneratingPlan(true);
        try {
            const res = await thesisGeneratePlan(companyId);
            toast.success(`Plan en marcha: ${res.count} tesis (1ª generándose, el resto en cola).`);
            const fresh = await thesisGet(companyId);
            setThesis(fresh);
            thesisWaitPlanDone(companyId, {
                onProgress: (doc) => { if (doc) setThesis(doc); },
            }).catch(() => {});
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo generar el plan.");
        } finally {
            setGeneratingPlan(false);
        }
    };

    const refresh = async () => {
        // Full-scope refresh (no thesis_id / no ticker): re-fetches fundamentals for
        // every ticker in the user's saved theses and recomputes every TAM Score in
        // place. Guarantees coherence between this page, the dashboard treemap and
        // the standalone company page when the user presses the refresh icon.
        const res = await thesisRefreshRun({});
        if (res?.thesis) setThesis(res.thesis);
        else { const d = await thesisGet(id); setThesis(d); }
    };

    return (
        <div data-testid="thesis-detail-page">
            <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex flex-col gap-1">
                    <Link to="/thesis" className="inline-flex items-center gap-1 text-sm text-[#052049] hover:underline" data-testid="back-to-thesis">
                        <ArrowLeft size={14} /> Volver a Tesis
                    </Link>
                    {sourceCompany && (
                        <Link to={`/thesis/${sourceCompany.id}`} className="inline-flex items-center gap-1 text-sm text-[#052049] hover:underline" data-testid="back-to-source-company">
                            <ArrowLeft size={14} /> Volver a {sourceCompany.name}
                        </Link>
                    )}
                </div>
                {user && thesis && !isTendencia && <RefreshButton onRefresh={refresh} testid="thesis-detail-refresh" />}
            </div>
            {loading && (
                <div className="flex items-center gap-2 text-[#4A4A4A] py-10" data-testid="thesis-detail-loading">
                    <Loader2 size={16} className="animate-spin" /> Cargando tesis…
                </div>
            )}
            {error && !loading && (
                <div className="border border-[#B32A22]/40 bg-white p-6 text-[#B32A22]" data-testid="thesis-detail-error">{error}</div>
            )}
            {thesis && !loading && (
                isTendencia ? (
                    <TendenciaResult
                        tendencia={thesis}
                        saved
                        canSave={false}
                        onDevelopCompany={(ticker) => ticker && navigate(`/thesis?company=${encodeURIComponent(ticker)}`)}
                    />
                ) : (
                    <ThesisResult
                        thesis={thesis}
                        canGenerateContra={!!user}
                        onGenerateContra={generateContra}
                        generatingContra={generatingContra}
                        onGeneratePlan={generatePlan}
                        generatingPlan={generatingPlan}
                        onThesisUpdate={(d) => setThesis(d)}
                    />
                )
            )}
        </div>
    );
}
