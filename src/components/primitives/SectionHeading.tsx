/**
 * Two-tone poster heading: `lead` in the section's foreground color, `accent`
 * in olive, with a rough hand-drawn brush underline (as in the mockup).
 * `tone="light"` for dark sections (cream lead), `tone="dark"` for paper sections.
 */
export function SectionHeading({
  lead,
  accent,
  tone = "dark",
  as: Tag = "h2",
  className = "",
  accentColor = "text-olive",
  brushColor = "#6A6C3A",
}: {
  lead: string;
  accent?: string;
  tone?: "light" | "dark";
  as?: "h1" | "h2";
  className?: string;
  accentColor?: string;
  brushColor?: string;
}) {
  const leadColor = tone === "light" ? "text-bone" : "text-ink";
  return (
    <div className={`relative inline-block ${className}`}>
      <Tag className={`font-display text-4xl leading-[0.95] font-bold tracking-tight sm:text-5xl ${leadColor}`}>
        {lead}
        {accent ? <> <span className={accentColor}>{accent}</span></> : null}
      </Tag>
      <BrushUnderline color={brushColor} />
    </div>
  );
}

/** Rough tapered brush stroke used under headings. Decorative. */
export function BrushUnderline({ color = "#6A6C3A" }: { color?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 300 16"
      preserveAspectRatio="none"
      className="mt-1 block h-2.5 w-[62%] max-w-[16rem]"
    >
      <path
        d="M2 9 C 40 4, 85 12, 130 7 S 220 3, 298 8 L 296 13 C 210 9, 150 15, 92 12 S 30 14, 4 14 Z"
        fill={color}
      />
    </svg>
  );
}
