import { Globe, Heart, MessageCircle, Send } from "lucide-react";
import { site, type SocialId } from "@/config/site";

/** X has no lucide glyph — small inline logo, still bundled, no network. */
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

export function Footer() {
  return (
    <footer className="grain border-t border-paper/10 bg-ink py-10">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <span className="flex h-8 w-8 items-center justify-center rounded-sm border-2 border-paper/50 text-olive">
              <Heart size={16} fill="currentColor" aria-hidden="true" />
            </span>
            <div>
              <p className="font-display text-xl font-bold text-bone">{site.ticker}</p>
              <p className="font-mono text-xs text-paper/60">the meme coin with a pulse.</p>
            </div>
          </div>

          <ul className="flex items-center gap-3">
            {site.socials.map((social) => (
              <li key={social.id}>
                <a
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-full border-2 border-paper/30 text-paper/80 transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
                >
                  <SocialIcon id={social.id} />
                </a>
              </li>
            ))}
          </ul>
        </div>

        <p className="mx-auto mt-8 max-w-xl text-center font-mono text-xs leading-relaxed text-paper/45">
          {site.footer.disclaimer}
        </p>
      </div>
    </footer>
  );
}
