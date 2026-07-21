import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

// Global "back" button. Uses the router history so the destination page keeps
// its state (e.g. returning to Comparar restores the loaded comparison).
// Hidden on Home and when there is no previous in-app entry to go back to.
export default function BackButton() {
    const navigate = useNavigate();
    const location = useLocation();
    const idx = (typeof window !== "undefined" && window.history.state && window.history.state.idx) || 0;
    if (location.pathname === "/" || idx <= 0) return null;
    return (
        <div className="mb-4">
            <button
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.12em] border border-black bg-white px-3 py-1.5 hover:bg-black hover:text-[#FDF1E6] transition-colors"
                data-testid="back-button"
            >
                <ArrowLeft size={14} /> Volver
            </button>
        </div>
    );
}
