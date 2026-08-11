"use client";

// JR's Charity — a clone of the RiceDAO /charity page. A full-bleed header, a
// leaderboard of where the money went / where it came from, a country tab bar
// that swaps between full-screen country sections (single-page-app style), and
// live charity-wallet data throughout. Wallet balances, recipients, impact
// totals and transactions are read live from the chain (via the same-origin
// proxy in src/app/api/charity-wallet); donations are direct on-chain USDC
// transfers signed by the visitor's own wallet.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CharityWalletProvider } from "@/components/charity/CharityWalletProvider";
import { DonateButton } from "@/components/charity/DonateButton";
import { asset } from "@/lib/asset";
import {
  useCharityImpact,
  formatUsd,
  type Impact,
  type CountryRank,
} from "@/hooks/useCharityImpact";
import {
  C,
  SERIF,
  NAV_H,
  Section,
  ContentCard,
  Reveal,
  Heading,
  Body,
  OutlineCTA,
  CHARITY_WALLET_ADDR,
  CHARITY_SOLSCAN,
  useCharityWallet,
  type WalletTx,
} from "@/components/charity/ui";
import { readJson } from "@/lib/readJson";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/** SOL transactions below this (dust / rent) are hidden from Recent Activity. */
const MIN_SOL_TX = 0.01;

/**
 * Live SOL/USD price (CoinGecko, refreshed every 60s while visible) so the
 * header "Charity Wallet Balance" can show real USD holdings, not just USDC.
 * Returns null until loaded / on failure — callers fall back to USDC-only.
 */
function useSolPrice(): number | null {
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        );
        if (!r.ok) return;
        const d = await readJson<{ solana?: { usd?: number } }>(r);
        const p = d?.solana?.usd;
        if (!cancelled && typeof p === "number" && p > 0) setPrice(p);
      } catch {
        /* keep last value */
      }
    };
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return price;
}

type CountryKey = "colombia" | "usa" | "peru" | "philippines" | "china";

interface Partner {
  name: string;
  /** Spanish/native name, shown under the English one. */
  nativeName?: string;
  url: string;
  logo?: string;
  photo?: string;
  /** Describes the photo for screen readers. */
  photoAlt?: string;
  /** object-position for the photo's crop; centred when omitted. */
  photoPosition?: string;
  photoCaption?: string;
  /** A short field film. When present it leads the slide instead of the photo. */
  video?: { src: string; poster: string; caption?: string; alt: string };
  /** Headline figures from the partner, shown as a small strip under the blurb. */
  stats?: Array<{ value: string; label: string }>;
  eyebrow: string;
  tagline: string;
  blurb: string;
  pillars: Array<{ title: string; text: string }>;
}

interface Country {
  key: CountryKey;
  /** Matches the recipient `id` the server reports. */
  id: string;
  flag: string;
  tab: string;
  heading: string;
  body: string;
  /** Fallback label when no live partner is on file. */
  partnerLabel: string;
  status?: string;
  bg: string;
  fallback: string;
  partner?: Partner;
}

const COUNTRIES: Country[] = [
  {
    key: "colombia",
    id: "colombia",
    flag: "🇨🇴",
    tab: "Colombia",
    heading: "🇨🇴 Colombia",
    body: "Colombia's displaced communities and urban poor face daily food insecurity.\nOur network reaches families others can't, delivering rice where it's needed most.",
    partnerLabel: "Around the Table Foundation",
    // NB: the source asset is spelled "columbia" (sic).
    bg: "/charity/charity-columbia.png",
    fallback: "linear-gradient(135deg, #161410 0%, #0A0805 100%)",
    partner: {
      name: "Around the Table Foundation",
      nativeName: "Fundación Alrededor de la Mesa",
      url: "http://alrededordelamesa.org/",
      logo: "/charity/colombia-partner-logo.png",
      // The field film leads this slide; it carries burned-in English subtitles,
      // so it still tells the story with the sound off (as it autoplays).
      video: {
        src: "/charity/colombia-story.mp4",
        poster: "/charity/colombia-story-poster.jpg",
        caption: "From the table in Cartagena — 100 children ate today.",
        alt: "Children and volunteers at Around the Table Foundation in Cartagena, Colombia",
      },
      eyebrow: "Cartagena, Colombia · Nonprofit",
      tagline: "Every child deserves a place at the table.",
      blurb:
        "They serve children facing hardship in Cartagena with food, care, and hope — one lunch, and one child, at a time.",
      pillars: [
        {
          title: "A meal every week",
          text: "Lunch for 40–100 children each week, funded by donations. The goal is daily.",
        },
        {
          title: "Learning and play",
          text: "Numbers, letters, art, and games that restore the joy of being a child.",
        },
        {
          title: "Protection and hope",
          text: "Walking with children through abuse, exploitation, and the lack of education and healthcare.",
        },
      ],
    },
  },
  {
    key: "peru",
    id: "peru",
    flag: "🇵🇪",
    tab: "Perú",
    heading: "🇵🇪 Perú",
    body: "Peru faces significant food insecurity, particularly in rural and indigenous communities.\nOur partners distribute rice directly to families in need, sourced locally where possible to support Peruvian farmers too.",
    partnerLabel: "Cáritas Cusco",
    bg: "/charity/charity-peru.png",
    fallback: "linear-gradient(135deg, #19130d 0%, #0A0805 100%)",
    partner: {
      name: "Cáritas Cusco",
      url: "https://www.caritascusco.org/",
      logo: "/charity/peru-partner-logo.svg",
      photo: "/charity/peru-partner.jpg",
      // The source frame is portrait; bias the crop upward to keep faces in it.
      photoPosition: "center 28%",
      photoAlt:
        "A farming couple in traditional Andean dress holding a fresh harvest of lettuce on the high plains outside Cusco",
      photoCaption: "Andean families growing — and eating — their own harvest.",
      eyebrow: "Cusco, Perú · Catholic Church nonprofit",
      tagline: "We sow hope with every gesture.",
      blurb:
        "Born after the 1950 earthquake to deliver emergency aid, Cáritas Cusco now works across all eight provinces of the Archdiocese of Cusco — food, dignity and opportunity for families in the Andes, with the communities themselves leading their own development.",
      stats: [
        { value: "+64", label: "Projects" },
        { value: "+620", label: "Communities" },
        { value: "+64,000", label: "People" },
      ],
      pillars: [
        {
          title: "Banco de Alimentos Cusco",
          text: "Their food bank turns 20 soles into breakfast for a family of four. Rice goes straight into those baskets.",
        },
        {
          title: "Communities in the lead",
          text: "Identity, education, health and decent work — programs run with the families they serve, not handed to them.",
        },
        {
          title: "First on the ground",
          text: "Founded for earthquake relief and still built for it: emergency response and resilience across the Cusco region.",
        },
      ],
    },
  },
  {
    key: "usa",
    id: "usa",
    flag: "🇺🇸",
    tab: "USA",
    heading: "🇺🇸 United States",
    body: "We partner with local churches, community leaders, and outreach organizations feeding hungry families across America.\n$1 = 10 meals. Your donation goes directly to food on tables, no middlemen.",
    partnerLabel: "TBA — Partner organization coming soon",
    status: "🤝 Partnership Forming",
    bg: "/charity/charity-usa.png",
    fallback: "linear-gradient(135deg, #1a1410 0%, #0A0805 100%)",
  },
  {
    key: "philippines",
    id: "philippines",
    flag: "🇵🇭",
    tab: "Philippines",
    heading: "🇵🇭 Philippines",
    body: "The Philippines is one of the world's largest rice consumers. We partner with local rice farming communities — feeding people while supporting the farmers who grow the grain.",
    partnerLabel: "TBA — Partner organization coming soon",
    bg: "/charity/charity-philippines.png",
    fallback: "linear-gradient(135deg, #15120c 0%, #0A0805 100%)",
  },
  {
    key: "china",
    id: "china",
    flag: "🇨🇳",
    tab: "China",
    heading: "🇨🇳 China",
    body: "China's rural poor and elderly communities face food insecurity despite national prosperity.\nOur partners reach those in the gaps — elderly alone, rural families, communities overlooked by larger programs.",
    partnerLabel: "TBA — Partner organization coming soon",
    bg: "/charity/charity-china.png",
    fallback: "linear-gradient(135deg, #1a120e 0%, #0A0805 100%)",
  },
];

function fmt(n: number, d = 2) {
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

function findRank(c: Country, impact: Impact | null): CountryRank | undefined {
  return impact?.countries.find((r) => r.id === c.id);
}

export function CharityContent() {
  return (
    <CharityWalletProvider>
      <CharityBody />
    </CharityWalletProvider>
  );
}

function CharityBody() {
  const [activeCountry, setActiveCountry] = useState<CountryKey>("colombia");
  const { balances, loading, transactions } = useCharityWallet();
  const { impact } = useCharityImpact();
  const solPrice = useSolPrice();

  const usdc = balances?.usdc ?? 0;
  // Charity Wallet Balance tracks real holdings: USDC + live-priced SOL.
  const walletUsd = usdc + (solPrice != null ? (balances?.sol ?? 0) * solPrice : 0);
  // Total Donated traces outflow — every dollar that has left the wallet.
  const totalDonated = impact?.totalDonatedUsd ?? 0;
  const mealsDonated = impact?.mealsDonated ?? 0;
  // Hide SOL dust (0 / sub-0.01 rent transfers) from the activity feed.
  const visibleTx = transactions.filter((tx) => !(tx.token === "SOL" && tx.amount < MIN_SOL_TX));
  const active = COUNTRIES.find((c) => c.key === activeCountry) ?? COUNTRIES[0];

  return (
    <main style={{ background: C.bg }}>
      <CharityStyles />

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <Section
        id="charity-header"
        bgImage="/charity/charity-header.png"
        fallback={`radial-gradient(ellipse at center, ${C.dark} 0%, ${C.bg} 75%)`}
        overlay={0.5}
        maxWidth={820}
        // Clear the fixed JourneyNav (h-16 / lg:h-24).
        style={{ paddingTop: `calc(${NAV_H}px + clamp(2.5rem, 6vh, 5rem))` }}
      >
        <div style={{ display: "flex", justifyContent: "center" }}>
          <ContentCard variant="hero">
            <Reveal delay={80}>
              <Heading size="clamp(1.9rem, 5vw, 3.25rem)">
                From meme energy to meals on real tables.
              </Heading>
            </Reveal>
            <Reveal delay={160}>
              <Body style={{ margin: "0 auto", textAlign: "center" }}>
                {`Rice was born from a mission.
Every transaction feeds the fund.
Every fund feeds a family.
No middlemen. No games.
Just rice on the table.`}
              </Body>
            </Reveal>

            <Reveal delay={240}>
              <div className="charity-stats">
                <HeaderStat
                  label="Charity Wallet Balance"
                  value={loading ? "…" : `$${fmt(walletUsd)}`}
                />
                <HeaderStat
                  label="Total Donated"
                  value={impact ? `$${fmt(totalDonated)}` : "…"}
                />
                <HeaderStat label="Countries" value={`${COUNTRIES.length}`} />
              </div>
            </Reveal>

            {/* Meals funded by real outflow — $1 buys 10 meals. Its own short
                row between the stat tiles and the activity feed. */}
            <Reveal delay={260}>
              <div
                style={{
                  marginTop: "0.75rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "1rem",
                  background: "rgba(26,15,10,0.7)",
                  border: "1px solid rgba(201,168,76,0.4)",
                  borderRadius: 10,
                  padding: "0.75rem clamp(0.9rem, 3vw, 1.25rem)",
                  textAlign: "left",
                }}
              >
                <span style={{ color: C.white, fontSize: "0.95rem" }}>
                  Total Meals Donated
                </span>
                <span
                  style={{
                    color: C.gold,
                    fontFamily: SERIF,
                    fontWeight: 700,
                    fontSize: "clamp(1.15rem, 3vw, 1.5rem)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {impact ? Math.floor(mealsDonated).toLocaleString() : "…"}
                </span>
              </div>
            </Reveal>

            {/* On-chain balance breakdown + recent activity — moved up from the
                old bottom tracker section, which was removed. */}
            <Reveal delay={280}>
              <div
                style={{
                  marginTop: "1.5rem",
                  textAlign: "left",
                  background: "rgba(20,15,8,0.7)",
                  border: `1px solid ${C.gold}`,
                  borderRadius: 12,
                  padding: "1.25rem clamp(1rem, 3vw, 1.5rem)",
                }}
              >
                <div>
                  <div
                    style={{
                      color: C.gold,
                      fontFamily: SERIF,
                      fontSize: "1.1rem",
                      marginBottom: "0.6rem",
                    }}
                  >
                    Recent Wallet Activity
                  </div>
                  <div
                    style={{
                      background: "rgba(10,8,5,0.5)",
                      borderRadius: 8,
                      padding: "0.25rem 1rem",
                    }}
                  >
                    {visibleTx.length === 0 ? (
                      <div style={{ color: C.muted, fontSize: "0.85rem", padding: "0.6rem 0" }}>
                        No transactions yet — be the first to donate!
                      </div>
                    ) : (
                      visibleTx.slice(0, 10).map((tx) => <TxRow key={tx.signature} tx={tx} />)
                    )}
                  </div>
                </div>
              </div>
            </Reveal>

            <Reveal delay={320}>
              <div
                style={{
                  marginTop: "1.75rem",
                  padding: "1.25rem",
                  borderRadius: 12,
                  border: `1px solid ${C.gold}`,
                  background: "rgba(20,15,8,0.7)",
                }}
              >
                <div
                  style={{
                    color: C.gold,
                    fontFamily: SERIF,
                    fontSize: "1.1rem",
                    marginBottom: "0.75rem",
                  }}
                >
                  💳 Donate USDC directly
                </div>
                <DonateButton defaultAmount={5} />

                <div
                  style={{
                    marginTop: "1rem",
                    paddingTop: "1rem",
                    borderTop: "1px solid rgba(201,168,76,0.25)",
                  }}
                >
                  <div
                    style={{
                      color: C.muted,
                      fontSize: "0.72rem",
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      marginBottom: "0.4rem",
                    }}
                  >
                    Charity Wallet Address
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "0.6rem",
                    }}
                  >
                    <span
                      style={{
                        color: C.gold,
                        fontFamily: "monospace",
                        fontSize: "0.82rem",
                        wordBreak: "break-all",
                        flex: "1 1 200px",
                      }}
                    >
                      {CHARITY_WALLET_ADDR}
                    </span>
                    <CopyWalletButton value={CHARITY_WALLET_ADDR} />
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal delay={380}>
              <div style={{ marginTop: "1.25rem" }}>
                <OutlineCTA href={CHARITY_SOLSCAN}>
                  🔗 View Charity Wallet on Solscan
                </OutlineCTA>
              </div>
            </Reveal>
          </ContentCard>
        </div>
      </Section>

      {/* ── ACTIVE COUNTRY SECTION ──────────────────────────────────────────── */}
      <Section
        id={`country-${active.key}`}
        bgImage={active.bg}
        fallback={active.fallback}
        overlay={0.4}
        maxWidth={720}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          {/* Leaderboards — who received, and who gave. */}
          <Leaderboards impact={impact} />

          <ContentCard style={{ maxWidth: 660, width: "100%" }}>
            {/* Country filter tabs — inside the card, where the frosted
                background gives them contrast against the photo behind. */}
            <div
              className="charity-tabs"
              style={{ borderBottom: "1px solid rgba(201,168,76,0.25)", marginBottom: "1.5rem" }}
            >
              {COUNTRIES.map((c) => {
                const isActive = c.key === activeCountry;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setActiveCountry(c.key)}
                    className="charity-tab"
                    aria-current={isActive ? "true" : undefined}
                    style={{
                      color: isActive ? C.gold : C.white,
                      opacity: isActive ? 1 : 0.8,
                      borderBottom: `3px solid ${isActive ? C.gold : "transparent"}`,
                    }}
                  >
                    {c.flag} {c.tab}
                  </button>
                );
              })}
            </div>

            {active.partner ? (
              <PartnerCarousel
                key={active.key}
                country={active}
                partner={active.partner}
                rank={findRank(active, impact)}
                loading={!impact}
              />
            ) : (
              <CountryPanel country={active} rank={findRank(active, impact)} loading={!impact} />
            )}
          </ContentCard>
        </div>
      </Section>
    </main>
  );
}

// ── Leaderboards ─────────────────────────────────────────────────────────────

type BoardTab = "countries" | "donors";

/**
 * Two rankings over the same on-chain history: where the money went (per
 * country, by USD received from the charity wallet) and where it came from
 * (per wallet, by USD donated in). Sits above the country card.
 */
function Leaderboards({ impact }: { impact: Impact | null }) {
  const [tab, setTab] = useState<BoardTab>("countries");
  const countries = impact?.countries ?? [];
  const donors = impact?.donors ?? [];

  return (
    <Reveal style={{ width: "100%", maxWidth: 660, marginBottom: "1.25rem" }}>
      <div
        style={{
          background: "rgba(10,8,5,0.72)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
          border: `1px solid ${C.gold}`,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", borderBottom: "1px solid rgba(201,168,76,0.25)" }}>
          <BoardTabButton active={tab === "countries"} onClick={() => setTab("countries")}>
            🏆 Countries
          </BoardTabButton>
          <BoardTabButton active={tab === "donors"} onClick={() => setTab("donors")}>
            💜 Donations made by
          </BoardTabButton>
        </div>

        <div style={{ padding: "0.5rem clamp(0.75rem, 3vw, 1.25rem) 0.75rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: C.muted,
              fontSize: "0.68rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "0.5rem 0",
            }}
          >
            <span>{tab === "countries" ? "Donations received" : "Wallet"}</span>
            <span>USD</span>
          </div>

          {!impact ? (
            <BoardEmpty>Loading on-chain totals…</BoardEmpty>
          ) : tab === "countries" ? (
            countries.length === 0 ? (
              <BoardEmpty>No donations yet.</BoardEmpty>
            ) : (
              countries.map((c, i) => (
                <BoardRow
                  key={c.id}
                  rank={i + 1}
                  label={`${c.flag} ${c.country}`}
                  sub={
                    c.usd > 0
                      ? `${c.meals.toLocaleString()} meals`
                      : c.status === "forming"
                        ? "Partnership forming"
                        : `${c.name} · partner confirmed`
                  }
                  value={formatUsd(c.usd)}
                  dim={c.usd === 0}
                />
              ))
            )
          ) : donors.length === 0 ? (
            <BoardEmpty>No donations yet — be the first!</BoardEmpty>
          ) : (
            donors.slice(0, 10).map((d, i) => (
              <BoardRow
                key={d.address}
                rank={i + 1}
                label={d.short}
                mono
                sub={`${d.donationCount} donation${d.donationCount === 1 ? "" : "s"}`}
                value={formatUsd(d.usd)}
                href={d.solscanUrl}
              />
            ))
          )}
        </div>
      </div>
    </Reveal>
  );
}

function BoardTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      style={{
        flex: 1,
        background: active ? "rgba(201,168,76,0.12)" : "transparent",
        border: "none",
        borderBottom: `3px solid ${active ? C.gold : "transparent"}`,
        color: active ? C.gold : C.white,
        opacity: active ? 1 : 0.75,
        padding: "0.8rem 0.5rem",
        cursor: "pointer",
        fontSize: "clamp(0.8rem, 2vw, 0.95rem)",
        fontWeight: 600,
        fontFamily: "system-ui, sans-serif",
        whiteSpace: "nowrap",
        transition: "color 0.15s ease, background 0.15s ease",
      }}
    >
      {children}
    </button>
  );
}

function BoardEmpty({ children }: { children: ReactNode }) {
  return (
    <div style={{ color: C.muted, fontSize: "0.85rem", padding: "0.75rem 0" }}>{children}</div>
  );
}

function BoardRow({
  rank,
  label,
  sub,
  value,
  mono,
  dim,
  href,
}: {
  rank: number;
  label: string;
  sub?: string;
  value: string;
  mono?: boolean;
  dim?: boolean;
  href?: string;
}) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  const inner = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.55rem 0",
        borderBottom: "1px solid rgba(201,168,76,0.12)",
        opacity: dim ? 0.55 : 1,
      }}
    >
      <span
        style={{
          width: "1.5rem",
          flexShrink: 0,
          color: C.muted,
          fontSize: "0.8rem",
          textAlign: "center",
        }}
      >
        {medal ?? rank}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            color: C.white,
            fontWeight: 600,
            fontSize: "0.9rem",
            fontFamily: mono ? "monospace" : undefined,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {sub && <span style={{ color: C.muted, fontSize: "0.72rem" }}>{sub}</span>}
      </span>
      <span
        style={{
          color: C.gold,
          fontWeight: 700,
          fontSize: "0.95rem",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: "none", display: "block" }}
    >
      {inner}
    </a>
  ) : (
    inner
  );
}

// ── Country panels ───────────────────────────────────────────────────────────

/** The "Donated to X" figure — condensed for the partner card, full otherwise. */
function DonatedTo({
  country,
  rank,
  loading,
  condensed = false,
}: {
  country: Country;
  rank: CountryRank | undefined;
  loading: boolean;
  condensed?: boolean;
}) {
  const usd = rank?.usd ?? 0;
  const meals = rank?.meals ?? 0;

  if (condensed) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          padding: "0.6rem 0.9rem",
          borderRadius: 10,
          border: `1px solid ${C.gold}`,
          background: "rgba(20,15,8,0.75)",
        }}
      >
        <span
          style={{
            color: C.muted,
            fontSize: "0.68rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Total Donated to {country.tab}
        </span>
        <span
          style={{
            color: C.gold,
            fontFamily: SERIF,
            fontWeight: 700,
            fontSize: "1.15rem",
            whiteSpace: "nowrap",
          }}
        >
          {loading ? "…" : formatUsd(usd)}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "1rem 1.25rem",
        borderRadius: 12,
        border: `1px solid ${C.gold}`,
        background: "rgba(20,15,8,0.75)",
      }}
    >
      <div
        style={{
          color: C.muted,
          fontSize: "0.72rem",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        Total Donated to {country.tab}
      </div>
      <div
        style={{
          color: C.gold,
          fontFamily: SERIF,
          fontSize: "clamp(1.5rem, 4vw, 2.2rem)",
        }}
      >
        {loading ? "…" : formatUsd(usd)}
      </div>
      {!loading && usd > 0 && (
        <div style={{ color: C.white, fontSize: "0.85rem", marginTop: "0.15rem" }}>
          {meals.toLocaleString()} meals funded
        </div>
      )}
      {rank?.walletAddress && (
        <div
          style={{
            color: C.muted,
            fontFamily: "monospace",
            fontSize: "0.78rem",
            marginTop: "0.4rem",
            wordBreak: "break-all",
          }}
        >
          {rank.walletAddress}
        </div>
      )}
    </div>
  );
}

/** Countries without a live partner yet: the original copy + donate CTA. */
function CountryPanel({
  country,
  rank,
  loading,
}: {
  country: Country;
  rank: CountryRank | undefined;
  loading: boolean;
}) {
  return (
    <>
      <Heading size="clamp(1.9rem, 5vw, 3rem)">{country.heading}</Heading>
      <Body style={{ maxWidth: "none" }}>{country.body}</Body>

      <div
        style={{
          marginTop: "1.5rem",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        <span style={{ color: C.muted, fontSize: "0.85rem", letterSpacing: "0.06em" }}>
          Partner:
        </span>
        <span style={{ color: C.white, fontWeight: 600 }}>{country.partnerLabel}</span>
      </div>

      {country.status && (
        <div
          style={{
            display: "inline-block",
            marginTop: "0.75rem",
            fontSize: "0.72rem",
            padding: "4px 10px",
            borderRadius: 999,
            background: "rgba(217,164,6,0.15)",
            border: "1px solid #d4a017",
            color: "#e6b800",
          }}
        >
          {country.status}
        </div>
      )}

      <div style={{ marginTop: "1.5rem" }}>
        <DonatedTo country={country} rank={rank} loading={loading} />
      </div>

      <div style={{ marginTop: "1.5rem" }}>
        <DonateButton defaultAmount={5} label={`💳 DONATE TO ${country.tab.toUpperCase()}`} />
      </div>
    </>
  );
}

/**
 * Collapses the carousel to the height of whichever slide is showing.
 *
 * The track is a flex row, so without this it stands as tall as its TALLEST
 * child and the short donate slide trails a screenful of dead space. Measured
 * rather than CSS'd because the slides' heights are content- and image-driven:
 * a ResizeObserver keeps the viewport correct as the partner photo loads, the
 * running total ticks over, and the window reflows.
 */
function useCarouselHeight(slide: 0 | 1) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const slide0 = useRef<HTMLDivElement>(null);
  const slide1 = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const el = slide === 0 ? slide0.current : slide1.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [slide]);

  return { viewportRef, storyRef: slide0, donateRef: slide1, height };
}

/**
 * The lead visual on a partner's story slide: their field film if they have
 * one, otherwise a photo. The film autoplays muted (its subtitles are burned
 * in, so the sound is optional) and stops whenever the donate slide is showing
 * — nothing should keep playing off-screen.
 */
function PartnerMedia({ partner, paused }: { partner: Partner; paused: boolean }) {
  const reduced = usePrefersReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (paused || reduced) el.pause();
    else void el.play().catch(() => undefined);
  }, [paused, reduced]);

  const caption = partner.video?.caption ?? partner.photoCaption;
  const media = partner.video ? (
    <video
      ref={videoRef}
      src={asset(partner.video.src)}
      poster={asset(partner.video.poster)}
      aria-label={partner.video.alt}
      controls
      muted
      loop
      playsInline
      preload="metadata"
      autoPlay={!reduced}
      style={{
        display: "block",
        width: "auto",
        maxWidth: "100%",
        maxHeight: "clamp(260px, 55vh, 460px)",
        margin: "0 auto",
        borderRadius: 10,
        border: "1px solid rgba(201,168,76,0.35)",
        background: "#000",
      }}
    />
  ) : partner.photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={asset(partner.photo)}
      alt={partner.photoAlt ?? partner.name}
      loading="lazy"
      style={{
        width: "100%",
        height: "clamp(150px, 26vw, 220px)",
        objectFit: "cover",
        objectPosition: partner.photoPosition,
        borderRadius: 10,
        border: "1px solid rgba(201,168,76,0.35)",
        display: "block",
      }}
    />
  ) : null;

  if (!media) return null;

  return (
    <figure style={{ margin: "0 0 1rem" }}>
      {media}
      {caption && (
        <figcaption
          style={{
            color: C.muted,
            fontSize: "0.75rem",
            marginTop: "0.4rem",
            textAlign: "center",
          }}
        >
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Countries with a live partner: a two-slide carousel. Slide 1 is the partner
 * story (the first thing you see); "Donate" flips to slide 2, the donation form
 * with the full running total. The total is present on both, condensed on the
 * first.
 */
function PartnerCarousel({
  country,
  partner,
  rank,
  loading,
}: {
  country: Country;
  partner: Partner;
  rank: CountryRank | undefined;
  loading: boolean;
}) {
  const [slide, setSlide] = useState<0 | 1>(0);
  const { viewportRef, storyRef, donateRef, height } = useCarouselHeight(slide);

  return (
    <div>
      {/* Slides */}
      <div className="carousel-viewport" ref={viewportRef} style={{ height }}>
        <div
          className="carousel-track"
          style={{ transform: `translateX(-${slide * 100}%)` }}
        >
          {/* ── Slide 1: who they are ─────────────────────────────────────── */}
          <div className="carousel-slide" ref={storyRef} inert={slide !== 0}>
            <div
              style={{
                color: C.gold,
                letterSpacing: "0.2em",
                fontSize: "0.68rem",
                fontWeight: 600,
                textTransform: "uppercase",
                marginBottom: "0.6rem",
              }}
            >
              {partner.eyebrow}
            </div>
            <h2
              style={{
                fontFamily: SERIF,
                color: C.white,
                fontSize: "clamp(1.5rem, 4vw, 2.1rem)",
                lineHeight: 1.15,
                margin: "0 0 0.75rem",
              }}
            >
              {partner.tagline}
            </h2>

            <PartnerMedia partner={partner} paused={slide !== 0} />

            <p style={{ color: C.white, fontSize: "0.95rem", lineHeight: 1.6, margin: 0 }}>
              {partner.blurb}
            </p>

            {partner.stats && (
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  margin: "0.9rem 0 0",
                }}
              >
                {partner.stats.map((s) => (
                  <div
                    key={s.label}
                    style={{
                      flex: 1,
                      textAlign: "center",
                      padding: "0.5rem 0.25rem",
                      borderRadius: 8,
                      border: "1px solid rgba(201,168,76,0.35)",
                      background: "rgba(20,15,8,0.6)",
                    }}
                  >
                    <div
                      style={{
                        color: C.gold,
                        fontFamily: SERIF,
                        fontSize: "clamp(1rem, 3vw, 1.3rem)",
                        lineHeight: 1.1,
                      }}
                    >
                      {s.value}
                    </div>
                    <div
                      style={{
                        color: C.muted,
                        fontSize: "0.66rem",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        marginTop: "0.2rem",
                      }}
                    >
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: "0.9rem 0 0",
                display: "grid",
                gap: "0.5rem",
              }}
            >
              {partner.pillars.map((p, i) => (
                <li key={p.title} style={{ display: "flex", gap: "0.6rem" }}>
                  <span
                    style={{
                      color: C.gold,
                      fontFamily: SERIF,
                      fontSize: "0.8rem",
                      flexShrink: 0,
                      paddingTop: "0.1rem",
                    }}
                  >
                    0{i + 1}
                  </span>
                  <span style={{ color: C.white, fontSize: "0.85rem", lineHeight: 1.5 }}>
                    <strong style={{ color: C.gold, fontWeight: 600 }}>{p.title}</strong>
                    {" — "}
                    {p.text}
                  </span>
                </li>
              ))}
            </ul>

            {/* Partner identity + link out */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                margin: "1rem 0",
                paddingTop: "0.9rem",
                borderTop: "1px solid rgba(201,168,76,0.25)",
              }}
            >
              {partner.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={asset(partner.logo)}
                  alt=""
                  loading="lazy"
                  style={{
                    width: 44,
                    height: 44,
                    objectFit: "contain",
                    background: C.white,
                    borderRadius: 8,
                    padding: 3,
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <a
                  href={partner.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: C.gold,
                    fontWeight: 600,
                    fontSize: "0.9rem",
                    textDecoration: "none",
                  }}
                >
                  {partner.name} ↗
                </a>
                {partner.nativeName && (
                  <div style={{ color: C.muted, fontSize: "0.78rem", fontStyle: "italic" }}>
                    {partner.nativeName}
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <DonatedTo country={country} rank={rank} loading={loading} condensed />
            </div>

            <button type="button" className="carousel-cta" onClick={() => setSlide(1)}>
              💳 DONATE TO {country.tab.toUpperCase()} →
            </button>
          </div>

          {/* ── Slide 2: donate ───────────────────────────────────────────── */}
          <div className="carousel-slide" ref={donateRef} inert={slide !== 1}>
            <button type="button" className="carousel-back" onClick={() => setSlide(0)}>
              ← Back to {partner.name}
            </button>

            <Heading size="clamp(1.6rem, 4vw, 2.4rem)">{country.heading}</Heading>
            <p
              style={{
                color: C.white,
                fontSize: "0.95rem",
                lineHeight: 1.6,
                margin: "0 0 1.25rem",
              }}
            >
              100% of your USDC goes to the $RICE charity wallet, then straight on to{" "}
              {partner.name}. Every hop is on-chain and public. $1 buys 10 meals.
            </p>

            <div style={{ marginBottom: "1.25rem" }}>
              <DonatedTo country={country} rank={rank} loading={loading} />
            </div>

            <div
              style={{
                padding: "1.25rem",
                borderRadius: 12,
                border: `1px solid ${C.gold}`,
                background: "rgba(20,15,8,0.7)",
              }}
            >
              <div
                style={{
                  color: C.gold,
                  fontFamily: SERIF,
                  fontSize: "1.05rem",
                  marginBottom: "0.75rem",
                }}
              >
                💳 Donate USDC
              </div>
              <DonateButton
                defaultAmount={5}
                label={`💳 DONATE TO ${country.tab.toUpperCase()}`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Dots */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "0.5rem",
          marginTop: "1rem",
        }}
      >
        {[0, 1].map((i) => (
          <button
            key={i}
            type="button"
            aria-label={i === 0 ? "Partner story" : "Donate"}
            aria-current={slide === i ? "true" : undefined}
            onClick={() => setSlide(i as 0 | 1)}
            style={{
              width: slide === i ? 22 : 8,
              height: 8,
              borderRadius: 999,
              border: "none",
              padding: 0,
              cursor: "pointer",
              background: slide === i ? C.gold : "rgba(201,168,76,0.35)",
              transition: "width 0.25s ease, background 0.25s ease",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CopyWalletButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* clipboard may be unavailable; ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      type="button"
      onClick={copy}
      style={{
        color: copied ? C.green : C.gold,
        background: "transparent",
        border: `1px solid ${copied ? C.green : C.gold}`,
        borderRadius: 6,
        padding: "6px 14px",
        cursor: "pointer",
        fontSize: "0.82rem",
        fontFamily: "system-ui, sans-serif",
        whiteSpace: "nowrap",
        transition: "color 0.15s, border-color 0.15s",
      }}
    >
      {copied ? "✓ Copied!" : "📋 Copy"}
    </button>
  );
}

function HeaderStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        flex: "1 1 130px",
        background: "rgba(26,15,10,0.7)",
        border: "1px solid rgba(201,168,76,0.4)",
        borderRadius: 10,
        padding: "0.9rem",
        textAlign: "center",
      }}
    >
      <div
        style={{
          color: C.gold,
          fontFamily: SERIF,
          fontSize: "clamp(1.3rem, 3vw, 1.8rem)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ color: C.muted, fontSize: "0.78rem", marginTop: "0.3rem" }}>{label}</div>
    </div>
  );
}

function TxRow({ tx }: { tx: WalletTx }) {
  // A SWAP is the treasury converting its own holdings (e.g. SOL→USDC via
  // Jupiter) — shown for transparency, but it is neither a gift in nor a
  // donation out, and the impact totals exclude it.
  const badge =
    tx.type === "SWAP"
      ? { text: "SWAP", bg: "rgba(201,168,76,0.15)", border: C.gold, color: C.gold }
      : tx.type === "INCOMING"
        ? { text: "RECEIVED", bg: "rgba(74,124,63,0.2)", border: C.green, color: "#7bbf6a" }
        : { text: "SENT", bg: "rgba(60,130,210,0.2)", border: "#4a90d9", color: "#7db4e8" };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        flexWrap: "wrap",
        padding: "0.5rem 0",
        borderBottom: "1px solid rgba(201,168,76,0.12)",
        fontSize: "0.82rem",
      }}
    >
      <span
        style={{
          padding: "2px 8px",
          borderRadius: 4,
          fontSize: "0.68rem",
          fontWeight: 700,
          background: badge.bg,
          border: `1px solid ${badge.border}`,
          color: badge.color,
        }}
      >
        {badge.text}
      </span>
      <span style={{ color: C.white, fontWeight: 600 }}>
        {tx.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {tx.token}
      </span>
      <span style={{ color: C.muted, fontFamily: "monospace" }}>
        {tx.type === "INCOMING" ? tx.from : tx.to}
      </span>
      <a
        href={tx.solscanUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View transaction on Solscan"
        style={{ color: C.gold, textDecoration: "none", marginLeft: "auto" }}
      >
        🔗
      </a>
    </div>
  );
}

function CharityStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
        .charity-stats {
          display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1.75rem;
        }
        .charity-tabs {
          display: flex; gap: 0.25rem; overflow-x: auto;
          scrollbar-width: none;
        }
        .charity-tabs::-webkit-scrollbar { display: none; }
        .charity-tab {
          background: transparent; border: none;
          padding: 0.7rem 0.85rem; cursor: pointer;
          font-size: clamp(0.8rem, 2vw, 0.95rem); font-weight: 600;
          white-space: nowrap;
          font-family: system-ui, sans-serif;
          transition: color 0.15s ease, opacity 0.15s ease;
        }
        .charity-tab:hover { opacity: 1; color: ${C.gold}; }

        /* Two-slide partner carousel. The viewport clips (and is sized to the
           active slide by useCarouselHeight); the track slides. */
        .carousel-viewport {
          overflow: hidden;
          transition: height 0.45s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .carousel-track {
          display: flex;
          align-items: flex-start;
          transition: transform 0.45s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .carousel-slide { flex: 0 0 100%; min-width: 0; }
        @media (prefers-reduced-motion: reduce) {
          .carousel-track, .carousel-viewport { transition: none; }
        }
        .carousel-cta {
          display: inline-flex; align-items: center; justify-content: center;
          width: 100%; gap: 0.5rem;
          padding: 0.9rem 1.6rem; border-radius: 10;
          font-size: 0.95rem; font-weight: 700; letter-spacing: 0.03em;
          font-family: system-ui, sans-serif; cursor: pointer;
          background: ${C.gold}; color: ${C.bg}; border: 1px solid ${C.gold};
          border-radius: 10px;
          transition: transform 0.15s ease, filter 0.15s ease;
        }
        .carousel-cta:hover { transform: translateY(-2px); filter: brightness(1.08); }
        .carousel-back {
          background: transparent; border: none; cursor: pointer;
          color: ${C.muted}; font-size: 0.82rem; font-family: system-ui, sans-serif;
          padding: 0 0 0.75rem; transition: color 0.15s ease;
        }
        .carousel-back:hover { color: ${C.gold}; }

        /* The wallet-adapter modal ships its own dark theme; keep it above the nav. */
        .wallet-adapter-modal { z-index: 100; }
      `,
      }}
    />
  );
}
