"use client";

// Building blocks for the ported /charity page. Mirrors RiceDAO's landing/ui.tsx
// (frosted content cards, scroll-reveal, full-bleed sections) so the page looks
// identical here. Deliberately self-contained: the rest of this site is the
// light "zine" Tailwind theme, and nothing outside /charity consumes these.
// The palette itself comes from the existing shim in @/components/landing/ui.

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { C, SERIF, GAME_API } from "@/components/landing/ui";
import { asset } from "@/lib/asset";
import { readJson } from "@/lib/readJson";

export { C, SERIF };

export const CHARITY_WALLET_ADDR = "7SY8eauzB9bSJvM3tShxZEGnf354UiAucq9yDWZb3kVj";
export const CHARITY_SOLSCAN = `https://solscan.io/account/${CHARITY_WALLET_ADDR}`;

/** Height of JourneyNav: h-16 (64px) on mobile, lg:h-24 (96px) from 1024px up. */
export const NAV_H = 64;
export const NAV_H_LG = 96;

// ── Viewport helpers ─────────────────────────────────────────────────────────
/** SSR-safe media query. Starts false, corrects on mount. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** <768px. Drives the slightly-more-opaque card background on small screens. */
export function useMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

/** Frosted-card background — a touch more opaque on mobile, where it sits over
 *  busy background art. */
export function cardBg(mobile: boolean): string {
  return mobile ? "rgba(10, 8, 5, 0.55)" : "rgba(10, 8, 5, 0.45)";
}

/** Fires once when the element scrolls into view. */
function useInView<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

// ── Entrance animation wrapper ───────────────────────────────────────────────
export function Reveal({
  children,
  className,
  delay = 0,
  style,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  style?: CSSProperties;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.2);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(30px)",
        transition: `opacity 0.8s ease ${delay}ms, transform 0.8s ease ${delay}ms`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Section shell: full viewport, bg image + gradient fallback ───────────────
export function Section({
  id,
  children,
  bgImage,
  fallback,
  overlay,
  maxWidth = 1100,
  style,
}: {
  id?: string;
  children: ReactNode;
  /** Root-relative public path; run through asset() for the basePath + build stamp. */
  bgImage?: string;
  fallback?: string;
  /** Dark overlay opacity over the bg image (0–1). */
  overlay?: number;
  maxWidth?: number;
  style?: CSSProperties;
}) {
  const mobile = useMobile();
  return (
    <section
      id={id}
      style={{
        position: "relative",
        minHeight: "100svh",
        width: "100%",
        display: "flex",
        // On mobile, top-align so tall cards flow DOWN instead of centering and
        // spilling out of the viewport. An explicit alignItems in `style` wins.
        alignItems: mobile ? "flex-start" : "center",
        justifyContent: "center",
        padding: "clamp(2.5rem, 6vh, 5rem) clamp(1.25rem, 5vw, 4rem)",
        overflow: "hidden",
        background: fallback ?? C.bg,
        ...style,
      }}
    >
      {bgImage && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url('${asset(bgImage)}')`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            zIndex: 0,
          }}
        />
      )}
      {overlay != null && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: `rgba(10,8,5,${overlay})`,
            zIndex: 1,
          }}
        />
      )}
      <div style={{ position: "relative", zIndex: 2, width: "100%", maxWidth }}>
        {children}
      </div>
    </section>
  );
}

// ── Frosted content card ─────────────────────────────────────────────────────
export function ContentCard({
  children,
  variant = "default",
  style,
}: {
  children: ReactNode;
  variant?: "default" | "hero";
  style?: CSSProperties;
}) {
  const mobile = useMobile();
  const bg = cardBg(mobile);
  const variants: Record<string, CSSProperties> = {
    default: {
      backgroundColor: bg,
      backdropFilter: "blur(3px)",
      WebkitBackdropFilter: "blur(3px)",
      borderRadius: 12,
      padding: "clamp(1.75rem, 4vw, 40px) clamp(1.5rem, 4vw, 48px)",
      border: "1px solid rgba(201, 168, 76, 0.2)",
    },
    hero: {
      backgroundColor: bg,
      backdropFilter: "blur(3px)",
      WebkitBackdropFilter: "blur(3px)",
      borderRadius: 16,
      padding: "clamp(2rem, 5vw, 60px) clamp(1.75rem, 5vw, 80px)",
      border: "1px solid rgba(201, 168, 76, 0.3)",
      maxWidth: 700,
      textAlign: "center" as const,
    },
  };
  return <div style={{ ...variants[variant], ...style }}>{children}</div>;
}

// ── Small reusable bits ──────────────────────────────────────────────────────
export function GoldLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        color: C.gold,
        letterSpacing: "0.28em",
        fontSize: "0.8rem",
        fontWeight: 600,
        textTransform: "uppercase",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  );
}

export function Heading({
  children,
  size = "clamp(2.2rem, 6vw, 4rem)",
  color = C.gold,
}: {
  children: ReactNode;
  size?: string;
  color?: string;
}) {
  return (
    <h2
      style={{
        fontFamily: SERIF,
        color,
        fontSize: size,
        lineHeight: 1.05,
        margin: "0 0 1.25rem",
      }}
    >
      {children}
    </h2>
  );
}

export function Body({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <p
      style={{
        color: C.white,
        fontSize: "clamp(1rem, 1.4vw, 1.15rem)",
        lineHeight: 1.7,
        maxWidth: 600,
        whiteSpace: "pre-line",
        ...style,
      }}
    >
      {children}
    </p>
  );
}

export function OutlineCTA({
  href,
  children,
  color = C.gold,
}: {
  href: string;
  children: ReactNode;
  color?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        padding: "0.9rem 1.6rem",
        borderRadius: 10,
        fontSize: "1rem",
        fontWeight: 600,
        fontFamily: "system-ui, sans-serif",
        cursor: "pointer",
        textDecoration: "none",
        background: "transparent",
        color,
        border: `1px solid ${color}`,
        transition: "transform 0.15s ease, background 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = `${color}22`;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {children}
    </a>
  );
}

// ── Live charity wallet hook (balances / recipients / transactions) ──────────
export interface WalletBalances {
  walletAddress: string;
  sol: number;
  usdc: number;
  rice: number;
  lastUpdated: string;
  solscanUrl: string;
  error?: boolean;
}

export interface Recipient {
  id: string;
  country: string;
  flag: string;
  name: string;
  walletAddress: string | null;
  url: string | null;
  /** USD value received from the charity wallet, across all tokens. */
  totalReceived: number;
  currency: string;
  donationCount: number;
  lastDonationAt: string | null;
  status: "forming" | "active" | "donated";
  description: string;
}

export interface WalletTx {
  signature: string;
  /** SWAP = the treasury converting its own holdings; not a donation either way. */
  type: "INCOMING" | "OUTGOING" | "SWAP" | "UNKNOWN";
  amount: number;
  token: "SOL" | "USDC" | "RICE";
  /** Truncated for display. */
  from: string;
  to: string;
  /** Full counterparty addresses. */
  fromAddress: string;
  toAddress: string;
  /** USD value at current prices, or null when the token has no live price. */
  usd: number | null;
  timestamp: string;
  solscanUrl: string;
}

/**
 * Polls the live charity wallet every 60s. GAME_API is this app's basePath, so
 * these resolve to the same-origin route handlers in
 * src/app/api/charity-wallet/[endpoint], which proxy the RiceDAO server.
 *
 * Per-partner and per-donor totals are NOT read here — they come from
 * useCharityImpact(), which serves every surface on the site from one figure.
 */
export function useCharityWallet() {
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [secondsAgo, setSecondsAgo] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const [balRes, txRes] = await Promise.all([
          fetch(`${GAME_API}/api/charity-wallet/balances`),
          fetch(`${GAME_API}/api/charity-wallet/transactions`),
        ]);
        if (balRes.ok) {
          const data = await readJson<WalletBalances>(balRes);
          if (!cancelled) {
            setBalances(data);
            setSecondsAgo(0);
            setLoading(false);
          }
        } else if (!cancelled) {
          setLoading(false);
        }
        if (txRes.ok) {
          const data = await readJson<{ transactions?: WalletTx[] }>(txRes);
          if (!cancelled) setTransactions(data.transactions ?? []);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    fetchAll();
    const interval = setInterval(fetchAll, 60_000);
    const counter = setInterval(() => setSecondsAgo((s) => s + 1), 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(counter);
    };
  }, []);

  return { balances, loading, transactions, secondsAgo };
}
