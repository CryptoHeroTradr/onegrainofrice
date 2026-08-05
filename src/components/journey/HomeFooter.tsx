import Link from "next/link";
import { site } from "@/config/site";
import { CopyAddress } from "@/components/primitives/CopyAddress";
import { SocialLinks } from "@/components/primitives/SocialLinks";
import { SoundToggle } from "@/components/eggs/SoundToggle";

/**
 * New-home footer: wordmark, socials, contract copy, classic link, sound toggle.
 *
 * *2026-08-05:* the socials row was a hand-copied duplicate of
 * `primitives/SocialLinks` — its own `<ul>`, its own inline X logo, its own
 * `SocialIcon` switch — and it had already drifted: the switch had no
 * `instagram` case, so Instagram had been rendering as a generic globe here
 * while showing its real mark in the nav. Adding TikTok would have needed the
 * same glyph written twice, so the copy is deleted instead and this renders the
 * shared component with the footer's colours passed in.
 */
export function HomeFooter() {
  return (
    <footer className="grain border-t border-paper/10 bg-nori py-12 text-steamed">
      <div className="mx-auto max-w-[1180px] px-6">
        <div className="flex flex-col items-center gap-6 text-center">
          {/* Home is `/` as of Phase 7. A <Link>, not `asset("/home")` — asset()
              cache-stamps static files and was minting `/home?v=<build>` for a page. */}
          <Link href="/" className="font-display-round text-2xl font-bold tracking-tight">
            {site.nav.logo}
          </Link>

          <SocialLinks
            className="flex items-center gap-3"
            linkClassName="flex min-h-11 min-w-11 items-center justify-center rounded-full border-2 border-steamed/30 text-steamed/80 transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
          />

          <div>
            <p className="mb-2 font-mono text-xs font-bold tracking-widest text-steamed/60 uppercase">
              contract address
            </p>
            <div className="flex justify-center">
              <CopyAddress address={site.token.contract} />
            </div>
          </div>

          <div className="flex items-center gap-4 font-mono text-xs text-steamed/60">
            <span className="flex items-center gap-1">
              sound
              <SoundToggle className="text-steamed/70 hover:text-steamed" />
            </span>
          </div>

          <p className="mt-2 max-w-xl font-mono text-[0.7rem] leading-relaxed text-steamed/45">
            {site.footer.disclaimer}
          </p>
        </div>
      </div>
    </footer>
  );
}
