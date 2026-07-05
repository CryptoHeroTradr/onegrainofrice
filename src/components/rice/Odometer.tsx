"use client";

/**
 * Monospace odometer. Each digit is a 0–9 strip translated to the current
 * value; as the number counts up the strips roll. Under reduced motion the
 * final number is rendered directly with no roll. Purely presentational —
 * `aria-label` carries the plain formatted number for screen readers.
 */
export function Odometer({
  value,
  reducedMotion = false,
  className = "",
}: {
  value: number;
  reducedMotion?: boolean;
  className?: string;
}) {
  const formatted = Math.max(0, Math.round(value)).toLocaleString("en-US");

  if (reducedMotion) {
    return (
      <span className={`font-mono tabular-nums ${className}`}>{formatted}</span>
    );
  }

  return (
    <span
      className={`odometer font-mono tabular-nums ${className}`}
      role="text"
      aria-label={formatted}
    >
      {formatted.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} className="odo-digit" aria-hidden="true">
            <span className="odo-strip" style={{ transform: `translateY(-${Number(ch) * 10}%)` }}>
              {Array.from({ length: 10 }, (_, n) => (
                <span key={n} className="odo-cell">
                  {n}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span key={i} className="odo-sep" aria-hidden="true">
            {ch}
          </span>
        ),
      )}
    </span>
  );
}
