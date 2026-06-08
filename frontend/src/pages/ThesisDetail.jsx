import React, { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { thesisGet, thesisGenerateContra, thesisRefreshRun, thesisGenerateRaw, thesisPollJob } from "@/lib/api";
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

    // "Generar todas las particiones": enqueue all splits (1st starts, rest queue),
    // then open the resulting thesis. Keeps the TAM partition conserved.
    const developAllPartitions = async ({ splits, core, companyId }) => {
        if (!splits?.length || !companyId) return;
        let lastJob = null;
        for (const sp of splits) {
            const r = await thesisGenerateRaw("trend", sp.name, { from_company: companyId, core, develop_whole: false, queue: true });
            if (r?.job_id) lastJob = r.job_id;
        }
        if (!lastJob) return;
        toast.promise(
            thesisPollJob(lastJob).then((data) => { if (data?.id) navigate(`/thesis/${data.id}`); return data; }),
            {
                loading: `Generando ${splits.length} particiones (1ª en marcha, resto en cola)…`,
                success: "Particiones generadas",
                error: (e) => e?.response?.data?.detail || "No se pudieron generar las particiones.",
            }
        );
    };

    const refresh = async () => {
        const res = await thesisRefreshRun({ thesis_id: id });
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
                        onDevelopAll={developAllPartitions}
                        onThesisUpdate={(d) => setThesis(d)}
                    />
                )
            )}
        </div>
    );
}
