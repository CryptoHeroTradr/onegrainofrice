"use client";

/**
 * THE TAB STRIP, ONCE, FOR EVERY FRAME.
 *
 * There were two of these — one in `DcaWorkspace` (/dca and the Mini App) and one in
 * `TradingPortal` (/home) — and they styled the unselected state differently by accident rather
 * than by decision. This is that decision, made in one place.
 *
 * WHAT WAS WRONG. The unselected label was `text-nori/70`: dark ink at 70%, with NO surface of its
 * own, so its contrast depended entirely on whatever happened to be behind the strip. On /home that
 * is a bone card and it read fine (6.6:1). On /dca and in the Telegram webview the strip sits
 * directly on the page body, which is `bg-ink` — and dark ink on a dark body measures **1.02:1**.
 * That is not "low contrast", it is invisible; the tabs read as disabled because they read as
 * nothing at all.
 *
 * THE FIX IS TO STOP DEPENDING ON THE BACKDROP. An unselected tab now carries its own light
 * surface, so its legibility is a property of the component instead of a property of the page it
 * was dropped into:
 *
 *   unselected   bone chip, olive-deep label, hairline border   7.7:1 label · 15.9:1 chip vs body
 *   selected     olive fill, bone label                          4.8:1 label
 *
 * and the two states differ by 4.8:1 against each other, so "which one am I on" survives being
 * read at arm's length on a phone. `test/trade-tabs-contrast.test.ts` computes all of those from
 * the palette rather than trusting this comment.
 *
 * The unselected state is deliberately a filled chip with a border, not bare text: a control that
 * looks like a label reads as disabled even when it is perfectly legible, which was half of what
 * the screenshots showed.
 */

export interface TradeTabItem<T extends string> {
  readonly key: T;
  readonly label: string;
  /** Element id, where a panel points back at its tab with aria-labelledby. */
  readonly id?: string;
  /** The panel this tab controls, for aria-controls. */
  readonly controls?: string;
}

const BASE =
  "min-h-11 flex-1 border-2 px-4 font-mono text-sm font-bold tracking-widest uppercase transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep";

/** Filled, high-contrast, unmistakably the current one. */
const SELECTED = "border-olive bg-olive text-bone";

/** Its own surface, so contrast never depends on the page behind the strip. */
const UNSELECTED =
  "border-nori/25 bg-bone text-olive-deep hover:border-olive hover:bg-olive/20 hover:text-nori";

export function TradeTabs<T extends string>({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: readonly TradeTabItem<T>[];
  active: T;
  onSelect: (key: T) => void;
  /** The tablist's accessible name — what this particular strip is choosing between. */
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-2">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            {...(t.id ? { id: t.id } : {})}
            {...(t.controls ? { "aria-controls": t.controls } : {})}
            aria-selected={isActive}
            onClick={() => onSelect(t.key)}
            className={`${BASE} ${isActive ? SELECTED : UNSELECTED}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
