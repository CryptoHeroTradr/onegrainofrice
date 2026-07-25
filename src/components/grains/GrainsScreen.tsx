"use client";

import { useEffect, useRef, useState } from "react";
import { asset } from "@/lib/asset";
import { site } from "@/config/site";
import { playClack, playMilestone, playPour, preloadMilestones } from "@/lib/sound";
import { SoundToggle } from "@/components/eggs/SoundToggle";
import { SocialLinks } from "@/components/primitives/SocialLinks";
import { useGrainsSocket } from "@/hooks/useGrainsSocket";
import { useRice } from "@/components/rice/RiceParticles";
import { ContractChip } from "./ContractChip";
import { GrainsCounter } from "./GrainsCounter";
import { RiceBowlCanvas, type RiceBowlHandle } from "./RiceBowlCanvas";
import { RiceFarmer, type RiceFarmerHandle } from "./RiceFarmer";
import { GRAIN_SIZE, GRAIN_WIDTH } from "./riceBowlEngine";
import { CountryLeaderboard } from "./CountryLeaderboard";
import { PlayersLeaderboard } from "./PlayersLeaderboard";
import { AnimatedNumber } from "./AnimatedNumber";
import { FloatingText, type FloatingTextHandle } from "./FloatingText";
import { ShareButton } from "./ShareButton";
import { LiveAnnouncer } from "./LiveAnnouncer";

// Light-surface restyle of the shared social pills (the default targets the dark
// footer). 44px min touch target for mobile. On-brand for the pastel background.
const SOCIAL_LINK_CLASS =
  "flex min-h-11 min-w-11 items-center justify-center rounded-full border border-olive-deep/30 bg-bone/70 text-olive-deep shadow-sm backdrop-blur transition-colors hover:border-olive hover:text-olive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive";

/**
 * Small twin of the lower-right landing gate, for the top button row.
 *
 * Same destination and wording as the big "Enter the Rice Paddy →" pill, but
 * always visible: that one only appears once three grains are dropped, so a
 * visitor who just wants the site has nothing to click until they play. Only
 * rendered when this screen IS the landing gate (enterWebsiteHref set).
 */
function EnterPaddyButton({ href, className = "" }: { href: string; className?: string }) {
  return (
    <a
      href={asset(href)}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border border-olive-deep/30 bg-bone/80 px-3 py-1.5 font-mono text-xs font-semibold whitespace-nowrap text-olive-deep shadow-sm backdrop-blur transition-colors hover:bg-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive ${className}`}
    >
      🌾 Enter the Rice Paddy →
    </a>
  );
}

// Compact variant for the tight mobile action row (socials · Copy CA · Share).
const SOCIAL_LINK_CLASS_SM =
  "flex h-9 w-9 items-center justify-center rounded-full border border-olive-deep/30 bg-steamed/70 text-olive-deep transition-colors hover:border-olive hover:text-olive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive";

// Rapid-fire firehose: this many drops inside this window sprays FIREWORK_GRAINS
// grains out of the pointer in an arcing jet that grows and flies off screen,
// alternating side each time. ~10 clicks in 1.6s is a deliberate mash, not
// casual tapping.
const FIREWORK_CLICKS = 10;
const FIREWORK_WINDOW_MS = 1600;
const FIREWORK_GRAINS = 50;

// Full-bleed sunset rice-terrace backdrop — just the photo, no overlay/tint.
// A plain cream shows only while the image is missing. Drop the file at
// public/grains/bg-terraces.jpg (served statically, no rebuild needed).
const BG_STYLE: React.CSSProperties = {
  backgroundImage: `url(${asset("/grains/bg-terraces.jpg")})`,
  backgroundSize: "cover",
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
  backgroundColor: "var(--color-steamed)",
};

/**
 * The two personal-stat pills (your total + country, and the tap hint), styled
 * like the leaderboard cards. Rendered above the mascot's head on desktop and in
 * the top stack on mobile. `w-full` so the parent controls the width.
 */
function StatBoxes({
  you,
  countryLabel,
  showHint = true,
}: {
  you: number;
  countryLabel: string;
  showHint?: boolean;
}) {
  return (
    <>
      {/* Title + country on the left, count on the far right. */}
      <div className="flex w-full items-center justify-between gap-3 rounded-2xl border border-olive-deep/15 bg-bone/70 px-5 py-2 shadow-lg backdrop-blur">
        <div className="min-w-0 text-left">
          <p className="font-mono text-[0.6rem] font-semibold uppercase tracking-widest text-olive-deep/70">
            Your rice
          </p>
          {countryLabel && (
            <p className="truncate font-mono text-[0.6rem] font-semibold uppercase tracking-widest text-olive-deep/50">
              {countryLabel}
            </p>
          )}
        </div>
        <AnimatedNumber
          value={you}
          className="shrink-0 font-mono text-3xl font-black tabular-nums text-ink sm:text-4xl"
        />
      </div>
      {showHint && (
        <div className="w-full rounded-2xl border border-olive-deep/15 bg-bone/70 px-4 py-1.5 text-center shadow-lg backdrop-blur">
          <p className="font-sans text-xs leading-snug text-olive-deep/80">
            tap anywhere to drop a grain
          </p>
        </div>
      )}
    </>
  );
}

/**
 * "welcome back" banner for a returning visitor. Sits directly beneath the total
 * grains tally (it used to be crammed into the tap hint further down the stack).
 * Renders nothing for a first-time visitor.
 */
function WelcomeBack({ you }: { you: number }) {
  if (you <= 0) return null;
  return (
    <p className="text-center font-sans text-xs font-semibold leading-snug text-bamboo drop-shadow-sm">
      welcome back — grains saved 🌾
    </p>
  );
}

export function GrainsScreen({ enterWebsiteHref }: { enterWebsiteHref?: string } = {}) {
  const {
    global,
    you,
    yourCountry,
    topCountries,
    topPlayers,
    youHandle,
    setName,
    connected,
    sendGrain,
  } = useGrainsSocket();
  const { hose } = useRice();
  const bowlRef = useRef<RiceBowlHandle>(null);
  const farmerRef = useRef<RiceFarmerHandle>(null);
  const floaterRef = useRef<FloatingTextHandle>(null);
  const mascotRef = useRef<HTMLDivElement>(null);

  // Hide the tap hint once the visitor has dropped a few grains this session
  // (they clearly know how to play). Ref counts; state flips the UI once.
  const dropCountRef = useRef(0);
  const [hintDismissed, setHintDismissed] = useState(false);
  // When used as the landing gate, the "Enter Website" button appears only after
  // the visitor has dropped 3 grains (see registerDrop).
  const [enterReady, setEnterReady] = useState(false);

  // Leaderboard open state is lifted here so the PARENT controls the layout: on
  // mobile the two boards share one row as narrow columns, but the moment either
  // dropdown opens the grid collapses to a single column so the expanded rows get
  // the full width instead of wrapping in a cramped half.
  const [countryOpen, setCountryOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const registerDrop = () => {
    if (dropCountRef.current >= 3) return;
    dropCountRef.current += 1;
    if (dropCountRef.current >= 3) {
      setHintDismissed(true);
      setEnterReady(true); // reveal the landing "Enter Website" button
    }
  };

  // The bowl deliberately starts EMPTY on every load. It used to prefill with the
  // returning visitor's saved grains, which meant a long-time player opened the
  // page to an already-overflowing bowl and nowhere left to pile. The COUNTS are
  // untouched and still restore from the server (and the local mirror) — only the
  // pile GRAPHICS reset, so every session starts with a clean bowl to fill.

  // Document-space top of the mascot's offsetParent, used to rebase the feet
  // position the canvas reports. Cached rather than measured per frame — the feet
  // update on almost every frame while rice is falling, and a getBoundingClientRect
  // in that path would force a layout each time. It only changes on layout, so
  // resize is enough (the value is scroll-invariant by construction).
  const parentTopRef = useRef(0);
  useEffect(() => {
    const sync = () => {
      const parent = mascotRef.current?.offsetParent as HTMLElement | null;
      parentTopRef.current = parent
        ? parent.getBoundingClientRect().top + window.scrollY
        : 0;
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // Pop a floating "$RICE" at viewport (x, y). Fired on EVERY click; the pool
  // hard-caps concurrent nodes so this can't grow the DOM.
  const burstRice = (x: number, y: number) => floaterRef.current?.burst(x, y);

  // The chopstick cursor only exists on (pointer: fine) — i.e. desktop — and it
  // fires a clack on every pointerdown, so a desktop grain drop sounds like
  // pour + clack. Touch devices have no cursor and were getting the pour alone.
  // Track whether the cursor is live and, when it isn't, add the clack here so
  // mobile taps sound exactly like desktop clicks.
  // Decode the milestone clips now — only this page ever plays them, and each
  // one gets exactly one tap to land on.
  useEffect(() => {
    preloadMilestones();
  }, []);

  const cursorClacksRef = useRef(false);
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const sync = () => {
      cursorClacksRef.current = fine.matches;
    };
    sync();
    fine.addEventListener("change", sync);
    return () => fine.removeEventListener("change", sync);
  }, []);

  /**
   * The grain-drop sound, identical on desktop and touch.
   *
   * `yourTotal` is the visitor's personal total AFTER this grain. When it lands
   * on a milestone the milestone sound plays instead of the pour — one sound per
   * tap. (The global ChopstickCursor's own clack is suppressed inside the sound
   * module, which is the only place that can see it.)
   */
  const playDropSound = (yourTotal: number) => {
    if (playMilestone(yourTotal)) return;
    playPour();
    if (!cursorClacksRef.current) playClack();
  };

  // Firework easter egg: land FIREWORK_CLICKS grains inside FIREWORK_WINDOW_MS
  // and 10 grains explode radially out of the pointer. Timestamps of recent
  // drops, trimmed to the window on each drop — so it only fires on a genuinely
  // fast streak, not on 10 leisurely clicks.
  const clickTimesRef = useRef<number[]>([]);
  const hoseDirRef = useRef<1 | -1>(1);
  const registerRapidClick = (x: number, y: number) => {
    const now = performance.now();
    const times = clickTimesRef.current;
    times.push(now);
    while (times.length && now - times[0] > FIREWORK_WINDOW_MS) times.shift();
    if (times.length < FIREWORK_CLICKS) return;
    times.length = 0; // reset, so the streak must be re-earned for the next one
    // Alternate the jet's side on every firehose, so back-to-back streaks spray
    // opposite ways instead of repeating.
    hoseDirRef.current = hoseDirRef.current === 1 ? -1 : 1;
    // Erupt from the SICKLE BLADE, not the pointer — the farmer is slinging the
    // rice. Falls back to the click point if the blade can't be measured (e.g.
    // keyboard activation before the mascot has laid out).
    const origin = farmerRef.current?.sicklePoint() ?? { x, y };
    // Same ellipse radii the bowl engine draws its falling grains with, so the
    // jet is visibly made of the very rice you've been dropping (it grows from
    // there as it flies).
    hose({
      x: origin.x,
      y: origin.y,
      count: FIREWORK_GRAINS,
      dir: hoseDirRef.current,
      rx: GRAIN_SIZE / 2,
      ry: GRAIN_WIDTH / 2,
    });
    farmerRef.current?.celebrate(); // very happy face for the big moment
    playClack(); // a pop to punctuate it
  };

  /** Everything a single grain-drop triggers: sound + the rapid-fire streak. */
  const onGrainDropped = (x: number, y: number, yourTotal: number) => {
    playDropSound(yourTotal);
    farmerRef.current?.react(); // swing the sickle, flash the wow face
    registerRapidClick(x, y);
  };

  // Character/keyboard grain: count it, drop a bowl grain, pop "$RICE". The
  // canvas handles its own clicks (spawns internally) via onGrain below. Works
  // for keyboard too: it's a <button>, so Space/Enter fire this onClick.
  const addGrainFromCharacter = (clientX?: number, clientY?: number) => {
    const yourTotal = sendGrain(1);
    registerDrop();
    // Keyboard activation has no coords → fall back to the viewport centre.
    const x = clientX ?? window.innerWidth / 2;
    const y = clientY ?? window.innerHeight / 2;
    onGrainDropped(x, y, yourTotal);
    // Pass the mascot's click point so grains pour down FROM the character.
    bowlRef.current?.spawn(clientX, clientY);
    burstRice(x, y);
  };

  // Your country's global rank (1-based) if it's in the visible top list.
  const myRank =
    yourCountry ? (topCountries.findIndex((c) => c.code === yourCountry.code) + 1) || null : null;

  // Friendly country label for the stat box (empty until known).
  const yourCountryLabel = yourCountry
    ? yourCountry.name === "Unknown" || yourCountry.code === "XX"
      ? "Unknown region"
      : yourCountry.name
    : "";

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden" style={BG_STYLE}>
      {/* ---------- Desktop header (sm+): socials · contract · share · paddy on
           the left; mute + counter grouped at the top-right (mute sits to the
           LEFT of the tally).
           `items-start`, NOT items-center: the tally is much taller than the
           buttons, and centering would float them down the middle of the row.
           The header itself must NOT wrap: it used to, and once the left group
           grew past the leftover space the whole tally dropped to a second line
           and stopped being a top-right corner tally at all. Instead the left
           group wraps WITHIN itself (min-w-0 lets it shrink below its content
           width) while the tally holds its corner (shrink-0). ------------- */}
      <header className="relative z-50 hidden flex-nowrap items-start justify-between gap-3 px-3 py-2 sm:flex sm:px-4">
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          <SocialLinks className="flex items-center gap-2" linkClassName={SOCIAL_LINK_CLASS} />
          <ContractChip address={site.tokenAddress} label={site.ticker} chain={site.token.chain} />
          <ShareButton you={you} yourCountry={yourCountry} rank={myRank} />
          {enterWebsiteHref && <EnterPaddyButton href={enterWebsiteHref} />}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-start gap-3">
            <SoundToggle className={SOCIAL_LINK_CLASS} />
            <GrainsCounter total={global} connected={connected} size="xl" />
          </div>
          <WelcomeBack you={you} />
        </div>
      </header>

      {/* ---------- Mobile header (below sm): the global tally leads the screen —
           big and bold at the very top — with the returning-visitor note directly
           under it, then the $RICE-on-Solana card (socials · Copy CA · Share on
           one action row). All in normal flow — nothing overlaps. */}
      <div className="relative z-50 flex flex-col gap-1.5 px-4 pb-1.5 pt-2 sm:hidden">
        <div className="flex justify-center">
          <GrainsCounter total={global} connected={connected} size="lg" />
        </div>
        <WelcomeBack you={you} />
        <ContractChip
          address={site.tokenAddress}
          label={site.ticker}
          chain={site.token.chain}
          variant="stacked"
          before={
            <SocialLinks className="flex items-center gap-1.5" linkClassName={SOCIAL_LINK_CLASS_SM} />
          }
          after={
            <>
              <ShareButton you={you} yourCountry={yourCountry} rank={myRank} />
              {enterWebsiteHref && <EnterPaddyButton href={enterWebsiteHref} />}
              <SoundToggle className={SOCIAL_LINK_CLASS_SM} />
            </>
          }
        />
      </div>

      {/* ---------- Country leaderboard: each country's summed player total, as a
           top 3 + "show all" dropdown. Full width in normal flow on mobile (below
           the header); a fixed side panel on desktop. Fed by the WS init/tick. */}
      <div
        className={`relative z-20 grid items-start gap-2 px-4 pb-2 sm:absolute sm:left-4 sm:top-32 sm:flex sm:w-72 sm:flex-col sm:gap-3 sm:px-0 sm:pb-0 ${
          countryOpen || playersOpen ? "grid-cols-1" : "grid-cols-2"
        }`}
      >
        <CountryLeaderboard
          topCountries={topCountries}
          yourCountry={yourCountry}
          open={countryOpen}
          onToggle={() => setCountryOpen((v) => !v)}
          className="sm:max-h-[40vh] sm:overflow-y-auto"
        />
        <PlayersLeaderboard
          topPlayers={topPlayers}
          youHandle={youHandle}
          onRename={setName}
          open={playersOpen}
          onToggle={() => setPlayersOpen((v) => !v)}
          className="sm:max-h-[40vh] sm:overflow-y-auto"
        />
      </div>

      {/* Mobile-only: personal stats as full-width boxes in the stack, matching
          the leaderboard pills. (Desktop shows these above the mascot's head.) */}
      <div className="relative z-20 flex flex-col gap-2 px-4 pb-2 sm:hidden">
        <StatBoxes you={you} countryLabel={yourCountryLabel} showHint={!hintDismissed} />
      </div>

      {/* ---------- Mascot: stands above the bowl and RIDES the rice pile — its
           feet track the crest (reported by the canvas), so it rests on the bowl
           rim while the bowl is filling and rises with the pile once rice mounds
           above the rim. Absolutely positioned; its bottom edge is pinned to the
           reported y via `-translate-y-full`. Falls back to 58dvh before the
           first report.

           Stacking, and why it's conditional:
           - CLOSED → z-[60], on top of everything (header z-50, boards/stats
             z-20). As the pile grows he climbs into the header band, and at any
             lower z the socials/contract card would slice through him.
           - OPEN (mobile) → z-10, BEHIND the boards (z-20). An expanded board is
             full-width and tall, and the farmer would otherwise sit across it.
           Desktop keeps z-[60] unconditionally (`sm:z-[60]`): there the boards
           are a fixed side panel that never overlaps the centred character.
           The wrapper stays pointer-events-none — only the character itself is
           clickable — so controls underneath still take their own clicks. ---- */}
      <div
        ref={mascotRef}
        className={`pointer-events-none absolute left-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center will-change-transform ${
          countryOpen || playersOpen ? "z-10 sm:z-[60]" : "z-[60]"
        }`}
        style={{ top: "58dvh" }}
      >
        {/* Desktop: the two stat boxes ride above the mascot's head. On mobile
            they render in the top stack instead (see below), so they can't be
            covered by the character. */}
        <div className="mb-2 hidden w-60 flex-col items-center gap-1.5 sm:flex">
          <StatBoxes you={you} countryLabel={yourCountryLabel} />
        </div>
        <button
          type="button"
          onClick={(e) =>
            e.detail === 0 ? addGrainFromCharacter() : addGrainFromCharacter(e.clientX, e.clientY)
          }
          aria-label="Add a grain of rice"
          className="group pointer-events-auto block rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-olive/60"
        >
          {/* WIDTH ONLY — no h-*. The farmer's viewBox is cropped to end at his
              soles, so the element's bottom edge IS his feet and the pile-pinning
              lands them on the rice. Pinning a square height back on would
              letterbox the art and float him again. */}
          <RiceFarmer
            ref={farmerRef}
            className="block h-auto w-40 select-none drop-shadow-[0_18px_30px_rgba(71,77,46,0.25)] transition-transform duration-150 group-active:scale-95 sm:w-[28rem]"
          />
        </button>
      </div>

      {/* ---------- PHASE 4: rice-bowl canvas (bottom third, interactive) ----------
           `grains-play-area` applies the chopsticks cursor; `data-grab` makes the
           animated chopstick sticks pinch over it. Sits behind the character (z-0)
           and receives clicks that pass through the click-through center stage. */}
      <div
        data-grab
        className="grains-play-area absolute inset-x-0 bottom-0 z-0 h-[62dvh] min-h-[360px]"
      >
        <RiceBowlCanvas
          ref={bowlRef}
          onGrain={(x, y) => {
            const yourTotal = sendGrain(1);
            registerDrop();
            onGrainDropped(x, y, yourTotal);
            burstRice(x, y);
          }}
          onMascotFeet={(docY) => {
            const el = mascotRef.current;
            // docY is document-space; `top` on an absolute element resolves
            // against its offsetParent, so rebase it. (Both are equal only when
            // the parent sits at the very top of an unscrolled page.)
            if (el) el.style.top = `${docY - parentTopRef.current}px`;
          }}
          className="h-full w-full"
        />
      </div>

      {/* Floating "RICE" bursts overlay (pooled/recycled nodes, viewport-fixed). */}
      <FloatingText ref={floaterRef} />

      {/* Throttled screen-reader announcements (the visible counters tween too
          fast to announce every frame). */}
      <LiveAnnouncer global={global} you={you} yourCountry={yourCountry} rank={myRank} />

      {/* Landing gate: after 3 grains are dropped, reveal the "Enter the Rice
          Paddy" button in the lower-right corner (only when this screen is the /
          landing — enterWebsiteHref is set). Doubled on DESKTOP only (sm+): 2×
          the text in a 5.5rem-tall pill. It stays compact on phones, where a
          button that size would swallow the screen. */}
      {enterWebsiteHref && enterReady && (
        <a
          href={asset(enterWebsiteHref)}
          className="fixed bottom-5 right-5 z-50 inline-flex min-h-11 items-center gap-2 rounded-full border border-bone/30 bg-olive px-6 font-mono text-sm font-bold tracking-widest text-bone shadow-2xl ring-2 ring-bone/20 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bone sm:min-h-[5.5rem] sm:gap-4 sm:border-2 sm:px-12 sm:text-[1.75rem] sm:ring-4"
        >
          Enter the Rice Paddy →
        </a>
      )}
    </main>
  );
}
