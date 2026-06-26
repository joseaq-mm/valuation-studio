import React from "react";
import HoverTip from "./HoverTip";
import { freshnessInfo, freshnessTip } from "../lib/freshness";

// Small "Nd" badge with tooltip. Red when a newer company report exists after the update.
export function FreshnessBadge({ updatedAt, mostRecentQuarter, noun = "la última actualización", testid, className = "" }) {
    const info = freshnessInfo(updatedAt, mostRecentQuarter);
    if (!info) return null;
    return (
        <HoverTip text={freshnessTip(info, noun)}>
            <span
                className={`font-mono tabular-nums cursor-help ${className}`}
                style={{ color: info.stale ? "#B32A22" : "#9CA3AF", fontWeight: info.stale ? 700 : 400 }}
                data-testid={testid}
            >
                {info.days}d
            </span>
        </HoverTip>
    );
}
