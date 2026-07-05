/**
 * Washi-tape strip. Decorative only (aria-hidden). Position it absolutely
 * from the parent, e.g.:
 *   <Tape className="absolute -top-3 left-8 w-24 -rotate-6" />
 */
export function Tape({
  className = "",
  variant = "khaki",
}: {
  className?: string;
  variant?: "khaki" | "olive" | "paper";
}) {
  const variantClass =
    variant === "olive" ? "tape tape-olive" : variant === "paper" ? "tape tape-paper" : "tape";
  return <span aria-hidden="true" className={`block h-7 ${variantClass} ${className}`} />;
}
