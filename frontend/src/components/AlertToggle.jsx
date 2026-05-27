import React from "react";
import { Bell, BellOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

/**
 * Compact bell toggle that turns the per-row email alert on/off for a single
 * ticker. Requires the user to be authenticated; otherwise it just nudges them
 * to log in (we don't want anonymous "alerts" with nowhere to send the email).
 *
 * Props:
 *   - enabled (bool): current state
 *   - onChange (bool => void): called with the new state
 *   - testid (string): suffix for data-testid
 */
export default function AlertToggle({ enabled, onChange, testid }) {
    const { user } = useAuth();
    const { t } = useI18n();
    const handle = () => {
        if (!user) {
            toast.message(t("alerts.requires_login"));
            return;
        }
        onChange(!enabled);
    };
    const tip = !user ? t("alerts.requires_login")
              : enabled ? t("alerts.row_on")
              : t("alerts.row_off");
    return (
        <button
            type="button"
            onClick={handle}
            title={tip}
            aria-pressed={!!enabled}
            className="inline-flex items-center justify-center w-7 h-7 border"
            style={{
                background: enabled ? "var(--cheap)" : "transparent",
                borderColor: enabled ? "var(--cheap)" : "var(--border-strong)",
                color: enabled ? "var(--text-on-dark)" : (user ? "var(--text-primary)" : "var(--text-secondary)"),
                opacity: user ? 1 : 0.55,
            }}
            data-testid={`alert-toggle-${testid}`}
        >
            {enabled ? <Bell size={12} /> : <BellOff size={12} />}
        </button>
    );
}
