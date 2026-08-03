import type { Metadata } from "next";
import { ChompScreen } from "@/components/chomp/ChompScreen";

export const metadata: Metadata = {
  title: "RICE CHOMP — clear the paddy",
  description:
    "An arcade maze chase for $RICE. Steer a grain of rice through the paddy and chomp it clean.",
};

/**
 * RICE CHOMP. Everything interactive is in <ChompScreen /> (client); this stays a
 * server component so the route keeps its prerender and its immutable cache headers —
 * there is nothing per-request on the page, and the leaderboard (a later phase) will
 * be fetched client-side rather than making this dynamic.
 */
export default function ChompPage() {
  return <ChompScreen />;
}
