import type { ReactNode } from "react";

/**
 * The $RICE mascot — an ORIGINAL friendly rice grain holding chopsticks (or an
 * empty bowl). Pure inline vector, no external asset, no traced meme art.
 * Expressions via `mood`; swap the held item via `holding`.
 */
export type MascotMood = "happy" | "wink" | "sleepy" | "celebrate";

const INK = "#14110d";
const CREAM = "#fbf7ee";
const KHAKI = "#c4b370";
const TUNA = "#c1443a";
const PORC = "#2a4d8f";
const BAMBOO = "#4e7a3e";

const EYES: Record<MascotMood, ReactNode> = {
  happy: (
    <g fill={INK}>
      <circle cx="82" cy="116" r="6.5" />
      <circle cx="118" cy="116" r="6.5" />
      <circle cx="79.5" cy="113.5" r="2" fill={CREAM} />
      <circle cx="115.5" cy="113.5" r="2" fill={CREAM} />
    </g>
  ),
  wink: (
    <g fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round">
      <circle cx="82" cy="116" r="6.5" fill={INK} stroke="none" />
      <circle cx="79.5" cy="113.5" r="2" fill={CREAM} stroke="none" />
      <path d="M110 117 q8 6 16 0" />
    </g>
  ),
  sleepy: (
    <g fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round">
      <path d="M75 117 q7 5 14 0" />
      <path d="M111 117 q7 5 14 0" />
    </g>
  ),
  celebrate: (
    <g fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round">
      <path d="M75 119 q7 -8 14 0" />
      <path d="M111 119 q7 -8 14 0" />
    </g>
  ),
};

const MOUTH: Record<MascotMood, ReactNode> = {
  happy: <path d="M84 146 q16 16 32 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />,
  wink: <path d="M86 147 q15 13 30 -1" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />,
  sleepy: <path d="M94 150 q6 4 12 0" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />,
  celebrate: (
    <path
      d="M85 145 q15 24 30 0 q-15 7 -30 0 Z"
      fill={TUNA}
      stroke={INK}
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
  ),
};

export function GrainMascot({
  mood = "happy",
  holding = "chopsticks",
  size = 200,
  className = "",
  title,
}: {
  mood?: MascotMood;
  holding?: "chopsticks" | "empty-bowl";
  size?: number;
  className?: string;
  title?: string;
}) {
  const armsUp = mood === "celebrate";

  return (
    <svg
      viewBox="0 0 200 240"
      width={size}
      height={(size * 240) / 200}
      className={className}
      role="img"
      aria-label={title ?? "The $RICE rice-grain mascot"}
    >
      {/* feet */}
      <ellipse cx="84" cy="214" rx="13" ry="7" fill={INK} />
      <ellipse cx="116" cy="214" rx="13" ry="7" fill={INK} />

      {/* arms (outline then fill) */}
      {armsUp ? (
        <g strokeLinecap="round" fill="none">
          <path d="M60 150 q-16 -22 -6 -44" stroke={INK} strokeWidth="15" />
          <path d="M140 150 q16 -22 6 -44" stroke={INK} strokeWidth="15" />
          <path d="M60 150 q-16 -22 -6 -44" stroke={CREAM} strokeWidth="9" />
          <path d="M140 150 q16 -22 6 -44" stroke={CREAM} strokeWidth="9" />
        </g>
      ) : (
        <g strokeLinecap="round" fill="none">
          <path d="M58 152 q-20 6 -26 26" stroke={INK} strokeWidth="15" />
          <path d="M142 152 q20 6 26 26" stroke={INK} strokeWidth="15" />
          <path d="M58 152 q-20 6 -26 26" stroke={CREAM} strokeWidth="9" />
          <path d="M142 152 q20 6 26 26" stroke={CREAM} strokeWidth="9" />
        </g>
      )}

      {/* body — the grain */}
      <path
        d="M100 34 C132 34 146 74 146 120 C146 176 128 210 100 210 C72 210 54 176 54 120 C54 74 68 34 100 34 Z"
        fill={CREAM}
        stroke={INK}
        strokeWidth="3.5"
      />
      {/* body sheen */}
      <path d="M78 60 C70 82 70 110 76 134" fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" opacity="0.6" />

      {/* cheeks */}
      <circle cx="76" cy="136" r="7" fill={KHAKI} opacity="0.55" />
      <circle cx="124" cy="136" r="7" fill={KHAKI} opacity="0.55" />

      {/* face */}
      {EYES[mood]}
      {MOUTH[mood]}

      {/* held item */}
      {holding === "chopsticks" ? (
        <g stroke={KHAKI} strokeWidth="5" strokeLinecap="round">
          <line x1="150" y1="182" x2="196" y2="120" />
          <line x1="140" y1="184" x2="182" y2="118" />
          <g stroke="#8a7c3a">
            <line x1="192" y1="126" x2="196" y2="120" />
            <line x1="178" y1="124" x2="182" y2="118" />
          </g>
        </g>
      ) : (
        <g>
          {/* empty porcelain bowl held low */}
          <ellipse cx="100" cy="176" rx="46" ry="10" fill="#e7edf6" stroke={PORC} strokeWidth="2.5" />
          <path d="M56 178 Q68 210 100 214 Q132 210 144 178" fill="#eef2f8" stroke={PORC} strokeWidth="4" strokeLinecap="round" />
          <circle cx="100" cy="196" r="2.5" fill={PORC} opacity="0.7" />
        </g>
      )}

      {/* celebrate confetti grains */}
      {mood === "celebrate" && (
        <g fill={BAMBOO}>
          <ellipse cx="40" cy="60" rx="4" ry="2" transform="rotate(30 40 60)" />
          <ellipse cx="164" cy="52" rx="4" ry="2" fill={TUNA} transform="rotate(-20 164 52)" />
          <ellipse cx="150" cy="30" rx="4" ry="2" fill={KHAKI} transform="rotate(45 150 30)" />
        </g>
      )}
    </svg>
  );
}
