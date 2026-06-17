import React, { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { thesisGet, thesisGenerateContra, thesisRefreshRun, thesisGeneratePlan, thesisPollJob } from "@/lib/api";
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
    const [generatingContra, setGeneratingContra] = useState(false);
    const [generatingPlan, setGeneratingPlan] = useState(false);

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
    // Reloads the thesis to show locked planning + pending states; polls the first job.
    const generatePlan = async (companyId) => {
        if (!companyId) return;
        setGeneratingPlan(true);
        try {
            const res = await thesisGeneratePlan(companyId);
            toast.success(`Plan en marcha: ${res.count} tesis (1ª generándose, el resto en cola).`);
            const fresh = await thesisGet(companyId);
            setThesis(fresh);
            if (res.first_job_id) {
                thesisPollJob(res.first_job_id)
                    .then(async () => { const f2 = await thesisGet(companyId); setThesis(f2); })
                    .catch(() => {});
            }
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
            <div className="flex items-center justify-between gap-3 mb-4">
                <Link to="/thesis" className="inline-flex items-center gap-1 text-sm text-[#052049] hover:underline" data-testid="back-to-thesis">
                    <ArrowLeft size={14} /> Volver a Tesis
                </Link>
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
