"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { useRice } from "./RiceParticles";
import { playPour } from "@/lib/sound";

/**
 * A real <button> that pours rice grains from the click point. Fully
 * accessible and transparent — all button props (aria-label, className,
 * disabled, type, onClick, …) pass straight through. Pouring is purely
 * decorative and no-ops under reduced motion; the button always works.
 */
export type RiceButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Grains to pour per click. */
  pourCount?: number;
};

export const RiceButton = forwardRef<HTMLButtonElement, RiceButtonProps>(function RiceButton(
  { onClick, pourCount = 24, type = "button", children, ...rest },
  ref,
) {
  const { pour } = useRice();

  return (
    <button
      ref={ref}
      type={type}
      onClick={(e) => {
        pour({ x: e.clientX, y: e.clientY, count: pourCount });
        playPour();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
});
