import React, { useState, useEffect, useRef } from "react";
import { fmtInputDisplay, parseLocaleNumber } from "@/lib/format";

/**
 * Input that displays numbers in es-ES locale (1.234.567,89) but does NOT
 * re-format on every keystroke. The user types freely; on blur the value
 * is re-formatted cleanly. This avoids cursor jumps while editing.
 */
export default function LocaleNumberInput({ value, onChange, className, ...rest }) {
    const [text, setText] = useState(fmtInputDisplay(value));
    const focusedRef = useRef(false);

    // When external value changes (e.g., parent reset / load), sync text — but only if user is not editing.
    useEffect(() => {
        if (!focusedRef.current) {
            setText(fmtInputDisplay(value));
        }
    }, [value]);

    return (
        <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            className={className}
            value={text}
            onFocus={() => { focusedRef.current = true; }}
            onChange={(e) => {
                const raw = e.target.value;
                setText(raw);
                // Live-emit parsed value so downstream calculations can update,
                // but we DO NOT reformat the text — cursor stays where the user put it.
                onChange(parseLocaleNumber(raw));
            }}
            onBlur={() => {
                focusedRef.current = false;
                // Final tidy-up: reformat with thousand separators
                setText(fmtInputDisplay(value));
            }}
            {...rest}
        />
    );
}
