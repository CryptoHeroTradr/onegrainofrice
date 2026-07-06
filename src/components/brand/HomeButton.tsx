"use client";

import { useRouter } from "next/navigation";
import { RiceButton } from "@/components/rice/RiceButton";

/**
 * "Back home" control for the 404. A RiceButton (pours on click) that routes to
 * "/" — next/navigation applies the basePath, so it lands on /onegrainofrice.
 */
export function HomeButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <RiceButton
      pourCount={28}
      aria-label={label}
      onClick={() => router.push("/")}
      className="bg-tuna px-7 py-3 font-display-round text-lg font-bold text-steamed transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-porcelain"
    >
      {label}
    </RiceButton>
  );
}
