/**
 * Torn-paper transition between two sections.
 * `from` — bg class of the section the paper is torn FROM (the jagged strip),
 * `to`   — bg class of the section underneath (the backdrop).
 * edge="bottom": `from` sits above and rips downward into `to`.
 * edge="top":    `from` sits below and rips upward into `to`.
 */
export function TornDivider({
  from,
  to,
  edge = "bottom",
}: {
  from: string;
  to: string;
  edge?: "top" | "bottom";
}) {
  return (
    <div aria-hidden="true" className={`relative h-6 w-full sm:h-8 ${to}`}>
      <div
        className={`absolute inset-0 ${from} ${edge === "bottom" ? "torn-bottom" : "torn-top"}`}
      />
    </div>
  );
}
