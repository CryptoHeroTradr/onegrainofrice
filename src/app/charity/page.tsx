import type { Metadata } from "next";
import { JourneyNav } from "@/components/journey/JourneyNav";
import { HomeFooter } from "@/components/journey/HomeFooter";
import { CharityContent } from "@/components/charity/CharityContent";

export const metadata: Metadata = {
  title: "Charity — One Grain of Rice",
  description:
    "From meme energy to meals on real tables. Donate USDC straight to the $RICE charity wallet and watch every transaction settle on-chain.",
};

/**
 * /charity — a clone of the RiceDAO charity page. Donations are direct on-chain
 * USDC transfers signed by the visitor's own wallet (no server in the loop), and
 * the wallet tracker reads live balances/transactions from the RiceDAO server
 * through the same-origin proxy in src/app/api/charity-wallet.
 */
export default function CharityPage() {
  return (
    <>
      <JourneyNav overHero />
      <CharityContent />
      <HomeFooter />
    </>
  );
}
