import { Heart } from "lucide-react";
import { site } from "@/config/site";
import { SocialLinks } from "@/components/primitives/SocialLinks";

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

          <SocialLinks />
        </div>

        <p className="mx-auto mt-8 max-w-xl text-center font-mono text-xs leading-relaxed text-paper/45">
          {site.footer.disclaimer}
        </p>
      </div>
    </footer>
  );
}
