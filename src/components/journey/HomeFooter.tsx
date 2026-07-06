import Link from "next/link";
import { Globe, Heart, MessageCircle, Send } from "lucide-react";
import { site, type SocialId } from "@/config/site";
import { CopyAddress } from "@/components/primitives/CopyAddress";
import { SoundToggle } from "@/components/eggs/SoundToggle";

function XLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function SocialIcon({ id }: { id: SocialId }) {
  switch (id) {
    case "x":
      return <XLogo />;
    case "telegram":
      return <Send size={20} aria-hidden="true" />;
    case "discord":
      return <MessageCircle size={20} aria-hidden="true" />;
    default:
      return <Globe size={20} aria-hidden="true" />;
  }
}

/** New-home footer: wordmark, socials, contract copy, classic link, sound toggle. */
export function HomeFooter() {
  return (
    <footer className="grain border-t border-paper/10 bg-nori py-12 text-steamed">
      <div className="mx-auto max-w-[1180px] px-6">
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-sm border-2 border-steamed/50 text-olive">
              <Heart size={16} fill="currentColor" aria-hidden="true" />
            </span>
            <div className="text-left">
              <p className="font-display-round text-xl font-bold">{site.ticker}</p>
              <p className="font-mono text-xs text-steamed/60">the meme coin with a pulse.</p>
            </div>
          </div>

          <ul className="flex items-center gap-3">
            {site.socials.map((social, i) => (
              <li key={`${social.id}-${i}`}>
                <a
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-full border-2 border-steamed/30 text-steamed/80 transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
                >
                  <SocialIcon id={social.id} />
                </a>
              </li>
            ))}
          </ul>

          <div>
            <p className="mb-2 font-mono text-xs font-bold tracking-widest text-steamed/60 uppercase">
              contract address
            </p>
            <div className="flex justify-center">
              <CopyAddress address={site.token.contract} />
            </div>
          </div>

          <div className="flex items-center gap-4 font-mono text-xs text-steamed/60">
            <Link href={site.classicUrl} className="underline underline-offset-4 hover:text-steamed">
              {site.nav.classicLabel}
            </Link>
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
