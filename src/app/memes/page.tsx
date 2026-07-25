import type { Metadata } from "next";
import { JourneyNav } from "@/components/journey/JourneyNav";
import { HomeFooter } from "@/components/journey/HomeFooter";
import { MemesGallery } from "@/components/memes/MemesGallery";

export const metadata: Metadata = {
  title: "Meme Gallery — One Grain of Rice",
  description:
    "The $RICE community meme gallery — synced live from the @ricecontent Telegram group and its topics.",
};

/**
 * /memes — a clone of the RiceDAO memes page. The gallery is fed by the RiceDAO
 * game server's live Telegram meme-sync bot via a same-origin proxy (see
 * next.config.ts rewrite), so it carries the exact same content, topics, and
 * live updates without running a second bot.
 */
export default function MemesPage() {
  return (
    <>
      <JourneyNav />
      <MemesGallery />
      <HomeFooter />
    </>
  );
}
