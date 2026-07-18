import React from "react";
import HoverTip from "./HoverTip";
import { freshnessInfo, freshnessTip } from "../lib/freshness";

// Small "Nd" badge with tooltip. Red when the company has published earnings after the update.
export function FreshnessBadge({ updatedAt, lastEarningsDate, nextEarningsDate, noun = "la última actualización", testid, className = "" }) {
    const info = freshnessInfo(updatedAt, lastEarningsDate, nextEarningsDate);
    if (!info) return null;
    return (
        <HoverTip text={freshnessTip(info, noun)}>
            <span
                className={`font-mono tabular-nums cursor-help ${className}`}
                style={{ color: info.stale ? "#B32A22" : "#111111", fontWeight: info.stale ? 700 : 400 }}
                data-testid={testid}
            >
                {info.days}d
            </span>
        </HoverTip>
    );
}
