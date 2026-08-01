import { Globe, MessageCircle, Send } from "lucide-react";
import { site, type SocialId } from "@/config/site";

/** X has no lucide glyph — small inline logo, still bundled, no network. */
function XLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/**
 * Instagram, same story as X — lucide dropped its brand icons, so the glyph is
 * inline. Stroked rather than filled so it sits at the same visual weight as
 * the lucide icons beside it (Send, Globe).
 */
function InstagramLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

export function SocialIcon({ id }: { id: SocialId }) {
  switch (id) {
    case "x":
      return <XLogo />;
    case "instagram":
      return <InstagramLogo />;
    case "telegram":
      return <Send size={20} aria-hidden="true" />;
    case "discord":
      return <MessageCircle size={20} aria-hidden="true" />;
    default:
      return <Globe size={20} aria-hidden="true" />;
  }
}

const DEFAULT_LINK_CLASS =
  "flex min-h-11 min-w-11 items-center justify-center rounded-full border-2 border-paper/30 text-paper/80 transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki";

/**
 * Shared social-links row, driven by `site.socials`. Extracted from the footer
 * so the /grains header and both footers render the same set consistently.
 * Override `className` (the <ul>) / `linkClassName` (each pill) to restyle per
 * surface without duplicating the markup.
 */
export function SocialLinks({
  className = "flex items-center gap-3",
  linkClassName = DEFAULT_LINK_CLASS,
}: {
  className?: string;
  linkClassName?: string;
}) {
  return (
    <ul className={className}>
      {site.socials.map((social, i) => (
        <li key={`${social.id}-${i}`}>
          <a
            href={social.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={social.label}
            className={linkClassName}
          >
            <SocialIcon id={social.id} />
          </a>
        </li>
      ))}
    </ul>
  );
}
