import React from "react";
import { Bell, BellOff } from "lucide-react";
import HoverTip from "@/components/HoverTip";

/**
 * Three-state master bell shown in the header of the alerts column on the
 * Watchlist and Portfolio tables.
 *
 * States:
 *   - "on":            every row has alerts enabled.
 *   - "off":           no row has alerts enabled.
 *   - "indeterminate": some rows have alerts enabled.
 *
 * Visuals:
 *   - on  → solid green Bell.
 *   - off → muted BellOff.
 *   - indeterminate → amber Bell on a half-filled background (left half tinted).
 *
 * Click behaviour:
 *   - on            → turn all off.
 *   - off / indet.  → turn all on (so an "indeterminate" click is a positive action).
 */
export default function MasterAlertToggle({ total, activeCount, onChange, disabled = false, testid = "alert-toggle-all" }) {
    if (total <= 0) return null;
    const state = activeCount === 0 ? "off" : activeCount === total ? "on" : "indeterminate";
    const next = state === "on" ? false : true;

    const tip = state === "on"
        ? `Desactivar todas las alertas (${activeCount}/${total} activas)`
        : `Activar todas las alertas (${activeCount}/${total} activas)`;

    const baseColor =
        state === "on" ? "var(--cheap)"
        : state === "indeterminate" ? "#D97706"  /* amber */
        : "var(--text-primary)";

    // Indeterminate gets a subtle half-filled background pill to communicate the mixed state.
    const bgStyle = state === "indeterminate"
        ? { background: "linear-gradient(to right, color-mix(in srgb, #D97706 25%, transparent) 50%, transparent 50%)" }
        : undefined;

    const Icon = state === "off" ? BellOff : Bell;

    return (
        <HoverTip text={tip}>
            <button
                type="button"
                onClick={() => onChange(next)}
                disabled={disabled}
                className="inline-flex items-center justify-center w-6 h-6 hover:opacity-70 transition-opacity disabled:opacity-40"
                style={{ color: baseColor, ...bgStyle }}
                aria-pressed={state === "on"}
                aria-label={tip}
                data-testid={testid}
                data-state={state}
            >
                <Icon size={14} strokeWidth={state === "on" ? 2.5 : 2} />
            </button>
        </HoverTip>
    );
}
