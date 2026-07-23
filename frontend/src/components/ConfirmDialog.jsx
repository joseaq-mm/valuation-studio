import React from "react";
import { AlertTriangle } from "lucide-react";

// Lightweight controlled confirmation modal for destructive actions.
export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = "Eliminar",
    cancelLabel = "Cancelar",
    onConfirm,
    onCancel,
    testid = "confirm-dialog",
}) {
    if (!open) return null;
    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
            style={{ background: "rgba(17,17,17,0.5)" }}
            data-testid={testid}
            onClick={onCancel}
        >
            <div className="bg-white border border-black p-6 w-full max-w-sm shadow-[6px_6px_0_0_rgba(17,17,17,0.15)]" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start gap-3">
                    <AlertTriangle size={20} className="text-[#B32A22] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                        <h2 className="font-serif text-xl leading-tight text-[#111]">{title}</h2>
                        {message && <p className="text-sm text-[#4A4A4A] mt-1 leading-snug">{message}</p>}
                    </div>
                </div>
                <div className="flex justify-end gap-2 mt-5">
                    <button onClick={onCancel} className="btn-ghost" data-testid="confirm-cancel">{cancelLabel}</button>
                    <button
                        onClick={onConfirm}
                        className="px-3 py-1.5 text-xs font-mono uppercase tracking-wide bg-[#B32A22] text-white border border-[#B32A22] hover:bg-[#111] hover:border-[#111] transition-colors"
                        data-testid="confirm-accept"
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
