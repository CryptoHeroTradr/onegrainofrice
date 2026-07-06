/**
 * Phase 10 demo harness for the DAO vote bowls + roadmap terraces. Visit
 * /onegrainofrice/dao-demo. Removable once wired into the home in Phase 12.
 */
import { VoteBowls } from "@/components/dao/VoteBowls";
import { PaddyTerraces } from "@/components/roadmap/PaddyTerraces";

export default function DaoDemo() {
  return (
    <main>
      <VoteBowls />
      <PaddyTerraces />
    </main>
  );
}
