import type { PlateTint } from "@/config/memes";

/** Stable shape the browser consumes for the DAO vote bowls. */
export type DaoOption = { label: string; votes: number; plate: PlateTint };

export type DaoProposalDTO = {
  id: string;
  question: string;
  options: DaoOption[];
  totalVotes: number;
  /** true when this is the config example, not a live proposal. */
  illustrative: boolean;
};
