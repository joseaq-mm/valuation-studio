import React, { useState, useEffect, useRef } from "react";
import { fmtInputDisplay, parseLocaleNumber } from "@/lib/format";

/**
 * Locale-aware number input that does NOT reformat while typing
 * (so the cursor doesn't jump). Format is applied only on blur.
 *
 * Props:
 *   value      — raw numeric value (decimal). If percent=true, this is the decimal (0.20 for 20%).
 *   onChange   — receives the parsed numeric value (in the same scale as `value`).
 *   percent    — if true: displays value*100 in the input and appends a "%" suffix.
 *                When the user types, the input value is divided by 100 before being emitted.
 *   suffix     — optional custom suffix label appended after the input (e.g., "USD"). Ignored if percent=true.
 */
export default function LocaleNumberInput({ value, onChange, percent = false, suffix, className, style, ...rest }) {
    const displayScale = percent ? 100 : 1;
    const displayValue = value == null || isNaN(value) ? null : value * displayScale;

    const [text, setText] = useState(fmtInputDisplay(displayValue));
    const focusedRef = useRef(false);

    useEffect(() => {
        if (!focusedRef.current) {
            setText(fmtInputDisplay(displayValue));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [displayValue]);

    const effectiveSuffix = percent ? "%" : suffix;

    return (
        <div className="flex items-baseline gap-1 w-full">
            <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                className={className}
                style={style}
                value={text}
                onFocus={() => { focusedRef.current = true; }}
                onChange={(e) => {
                    const raw = e.target.value;
                    setText(raw);
                    const parsed = parseLocaleNumber(raw);
                    if (parsed === null) {
                        onChange(null);
                    } else {
                        onChange(parsed / displayScale);
                    }
                }}
                onBlur={() => {
                    focusedRef.current = false;
                    setText(fmtInputDisplay(displayValue));
                }}
                {...rest}
            />
            {effectiveSuffix && (
                <span className="text-sm font-mono text-[#4A4A4A] shrink-0" style={style?.color ? { color: style.color } : undefined}>{effectiveSuffix}</span>
            )}
        </div>
    );
}
