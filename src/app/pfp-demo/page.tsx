/**
 * Phase 9 demo harness for the client-only PFP compositor. Visit
 * /onegrainofrice/pfp-demo. Removable once wired into the home in Phase 12.
 */
import { RiceifyPFP } from "@/components/pfp/RiceifyPFP";

export default function PfpDemo() {
  return (
    <main className="min-h-screen bg-steamed">
      <RiceifyPFP />
    </main>
  );
}
