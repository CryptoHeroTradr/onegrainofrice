"use client";

/**
 * Phase 2 demo harness for the rice particle system. Visit
 * /onegrainofrice/rice-demo to exercise pour (click), the cursor trail (move
 * the mouse), and bowl-fill (scroll the tall panel). Safe to delete once the
 * effects are wired into the real homepage in a later phase.
 */
import { useRef } from "react";
import { RiceButton } from "@/components/rice/RiceButton";
import { RicePile } from "@/components/rice/RicePile";
import { useBowlFill } from "@/components/rice/useBowlFill";

export default function RiceDemo() {
  const bowlRef = useRef<HTMLDivElement>(null);
  useBowlFill(bowlRef);

  return (
    <main className="min-h-screen bg-steamed text-nori">
      <section className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="font-display-round text-5xl font-bold text-bamboo">rice particles demo</h1>
        <p className="max-w-md font-mono text-sm text-nori/70">
          Click the button to pour grains from the cursor. Move the mouse for a faint trail.
          Scroll down to fill the bowl.
        </p>
        <RiceButton
          aria-label="Pour rice"
          pourCount={40}
          className="porcelain-edge bg-tuna px-8 py-3 font-display-round text-lg font-bold text-steamed transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-porcelain"
        >
          Pour $RICE 🍚
        </RiceButton>

        {/* data-grab target: non-interactive, but the chopsticks pinch over it. */}
        <div
          data-grab
          className="border-2 border-porcelain bg-bamboo/15 px-5 py-3 font-mono text-sm text-nori"
        >
          hover me — a <code>[data-grab]</code> target (chopsticks pinch)
        </div>

        {/* text field: native caret returns, typing unaffected */}
        <input
          type="text"
          aria-label="Type here — native cursor test"
          placeholder="type here — native caret returns"
          className="border-2 border-porcelain bg-steamed px-4 py-2 font-mono text-sm text-nori placeholder:text-nori/40"
        />
      </section>

      {/* Live charity pile (Phase 5) */}
      <section className="border-y-2 border-porcelain bg-bone px-6 py-16">
        <RicePile />
      </section>

      <div className="h-[40vh]" aria-hidden="true" />

      {/* Bowl-fill panel: --bowl-color set inline, level driven by useBowlFill */}
      <section
        ref={bowlRef}
        className="bowl-fill relative mx-auto mb-[40vh] flex h-[70vh] max-w-3xl items-end justify-center overflow-hidden border-2 border-porcelain"
        style={{ ["--bowl-color" as string]: "var(--color-bamboo)" }}
      >
        <p className="relative z-10 mb-8 font-display-round text-3xl font-bold text-nori">
          the bowl fills as you scroll
        </p>
      </section>
    </main>
  );
}
