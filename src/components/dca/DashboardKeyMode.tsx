"use client";

import { useEffect, useState } from "react";
import {
  agoLabel,
  capLabel,
  capProgress,
  describeAmount,
  describeExecution,
  describeInterval,
  formatRaw,
  nextRunLabel,
  serverNow,
  shortId,
  STATE_LABEL,
  usd,
} from "@/lib/dcaFormat";
import { runAction, type DcaIntent, type SigningWallet, type WriteOutcome } from "@/lib/dcaDashboard";
import type { SiteDashboard, SiteSchedule } from "@/lib/bot-contract";

/**
 * KEY MODE — the custodial dashboard: what the bot is running with a key it holds for this user.
 *
 * Everything here is READ from the bot and, where a control exists, CHANGED through the bot's own
 * command layer — the same functions the Telegram panel calls. Nothing on this screen decides
 * anything: a refusal comes back in the panel's own sentence and is shown verbatim, because a rule
 * explained one way in Telegram and another way here is two rules as far as the reader is
 * concerned.
 *
 * CONTROLS DEGRADE, THEY DO NOT BREAK. With SITE_BRIDGE_WRITES=false — the state the bot is
 * deployed in right now — every mutation route answers 404. The first control that learns this
 * flips the whole board to a plain "controls are switched off" note and the dashboard carries on
 * showing everything it can read. That is not an error state; it is a correct rendering of a
 * correctly configured bot.
 *
 * TIME RUNS ON THE BOT'S CLOCK. Countdowns tick from `serverTime` plus elapsed browser time, never
 * from the browser's wall clock — see lib/dcaFormat.ts.
 */

const TICK_MS = 1_000;

export function DashboardKeyMode({
  data,
  wallet,
  readAt,
  ticker,
  onRefresh,
  busy,
}: {
  data: SiteDashboard;
  wallet: SigningWallet | null;
  /** Browser instant of the read that produced `data` — the anchor for both the clock and staleness. */
  readAt: number;
  ticker: string;
  onRefresh: () => Promise<void> | void;
  busy: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [writesOff, setWritesOff] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  // The countdown ticks from the read instant. Nothing is set synchronously here: on a fresh read
  // the previous elapsed value stands for at most one tick, and `serverNow` clamps it, so the worst
  // case is a countdown that is one second stale — never one that runs on the wrong clock.
  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - readAt), TICK_MS);
    return () => clearInterval(t);
  }, [readAt]);

  const now = serverNow(data.serverTime, elapsed);

  /**
   * Run one control, then RE-READ.
   *
   * The re-read is not optional and not deferred: a dashboard that kept rendering the state it had
   * before a mutation would be showing a schedule as running seconds after the user paused it. It
   * costs a second wallet prompt, because reading is itself proof-gated — that is the bridge's
   * design, and the honest thing is to say so rather than to skip the refresh.
   */
  async function act(key: string, intent: DcaIntent): Promise<void> {
    if (!wallet || writesOff) return;
    setPending(key);
    setNotice(null);
    const outcome: WriteOutcome = await runAction(wallet, intent, Date.now() - readAt);
    setPending(null);

    switch (outcome.kind) {
      case "writes-disabled":
        // Latched for the session: one 404 means the flag is off, and re-asking on every tap would
        // just be a slower way to learn the same thing.
        setWritesOff(true);
        return;
      case "ok":
        setNotice({ tone: "ok", text: `${outcome.message} Re-reading — approve once more.` });
        await onRefresh();
        return;
      case "refused":
        setNotice({ tone: "bad", text: outcome.message });
        return;
      case "stale":
        setNotice({ tone: "bad", text: "That view had gone stale, so nothing was changed. Refresh and try again." });
        return;
      case "error":
        setNotice({ tone: "bad", text: outcome.message });
    }
  }

  const disabled = writesOff || !wallet || busy || pending !== null;

  return (
    <div className="flex flex-col gap-4">
      {writesOff && (
        <p className="border-2 border-nori/30 bg-nori/5 px-3 py-2.5 font-mono text-xs leading-relaxed font-bold text-nori/80">
          🔒 Controls are turned off for the website right now — this view is read-only. Everything
          below is live; to pause, resume or edit a schedule, use <span className="text-nori">/trade</span> in
          the bot.
        </p>
      )}

      <section className="border-2 border-nori/25 bg-steamed p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-mono text-sm font-bold tracking-widest text-nori">TODAY&apos;S BUDGET</h3>
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={busy}
            className="min-h-9 border-2 border-nori/30 px-3 font-mono text-xs font-bold tracking-widest text-nori/70 transition-colors hover:border-nori disabled:opacity-50"
          >
            {busy ? "…" : "REFRESH"}
          </button>
        </div>
        <Budget data={data} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-sm font-bold tracking-widest text-nori">SCHEDULES</h3>
          <button
            type="button"
            onClick={() => void act("stop-all", { action: "stop-all" })}
            disabled={disabled || data.schedules.length === 0}
            title="Pauses every schedule immediately"
            className="min-h-11 border-2 border-tuna bg-tuna px-4 font-mono text-sm font-bold tracking-widest text-bone transition-colors hover:opacity-90 disabled:opacity-40"
          >
            {pending === "stop-all" ? "STOPPING…" : "🛑 STOP ALL"}
          </button>
        </div>

        {data.schedules.length === 0 ? (
          <p className="border-2 border-nori/20 bg-steamed px-3 py-4 font-mono text-sm text-nori/70">
            The bot isn&apos;t running any schedules for you. Start one with{" "}
            <span className="font-bold text-nori">/trade</span> in Telegram.
          </p>
        ) : (
          data.schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              s={s}
              now={now}
              ticker={ticker}
              disabled={disabled}
              pending={pending}
              onAct={act}
            />
          ))
        )}
      </section>

      {notice && (
        <p
          className={`border-2 px-3 py-2.5 font-mono text-xs leading-relaxed font-bold ${
            notice.tone === "ok" ? "border-olive/50 bg-olive/10 text-olive-deep" : "border-tuna/50 bg-tuna/10 text-tuna"
          }`}
        >
          {notice.text}
        </p>
      )}

      <Digest data={data} />
      <History data={data} ticker={ticker} now={now} />

      <p className="font-mono text-xs leading-relaxed text-nori/60">
        🔑 Your wallet, passphrase and keys are managed only in the bot — this page never asks for
        any of them and the bot never sends them here. Use{" "}
        <span className="font-bold text-nori">/wallet</span> in Telegram.
      </p>
    </div>
  );
}

function Budget({ data }: { data: SiteDashboard }) {
  const caps = data.caps;
  const spend = data.spend;
  if (!spend) return null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      <Meter label="Today" spent={spend.todayUsd} cap={caps?.perDayUsd ?? null} />
      <Meter label="Lifetime" spent={spend.lifetimeUsd} cap={caps?.lifetimeUsd ?? null} />
      <p className="font-mono text-xs text-nori/60">
        {caps
          ? `Per-trade cap ${usd(caps.perExecUsd)} · these are the bot's own limits, set with /trade caps.`
          : "⚠️ No caps set. Set them with /trade caps in the bot before it trades."}
      </p>
    </div>
  );
}

function Meter({ label, spent, cap }: { label: string; spent: number; cap: number | null }) {
  const pct = capProgress(spent, cap);
  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-xs">
        <span className="font-bold tracking-widest text-nori/70">{label}</span>
        <span className="text-nori">{capLabel(spent, cap)}</span>
      </div>
      <div className="mt-1 h-2 w-full border border-nori/25 bg-bone">
        {pct !== null && (
          <div
            className={`h-full ${pct >= 1 ? "bg-tuna" : "bg-olive"}`}
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}

function ScheduleCard({
  s,
  now,
  ticker,
  disabled,
  pending,
  onAct,
}: {
  s: SiteSchedule;
  now: number;
  ticker: string;
  disabled: boolean;
  pending: string | null;
  onAct: (key: string, intent: DcaIntent) => Promise<void>;
}) {
  const [editing, setEditing] = useState<"amount" | "interval" | "caps" | null>(null);
  const chip =
    s.state === "active"
      ? "border-olive bg-olive/15 text-olive-deep"
      : s.state === "paused"
        ? "border-nori/40 bg-nori/10 text-nori/70"
        : "border-tuna bg-tuna/15 text-tuna";

  return (
    <article className="border-2 border-nori/25 bg-steamed p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`border px-2 py-0.5 font-mono text-xs font-bold tracking-widest ${chip}`}>
          {STATE_LABEL[s.state]}
        </span>
        <span className="font-mono text-xs text-nori/50">#{s.id}</span>
      </div>

      <p className="mt-2 font-mono text-base font-bold text-nori">
        {describeAmount(s, ticker)} <span className="text-nori/60">{describeInterval(s.intervalMinutes)}</span>
      </p>

      {s.state === "halted" && s.haltReason ? (
        // Verbatim, including an UNKNOWN-outcome halt, which resume cannot clear — the bot's own
        // sentence names /resolve, and paraphrasing it here would lose the instruction.
        <p className="mt-2 border-2 border-tuna/40 bg-tuna/10 px-2 py-1.5 font-mono text-xs leading-relaxed font-bold break-words text-tuna">
          ⚠️ {s.haltReason}
        </p>
      ) : (
        <p className="mt-1 font-mono text-xs text-nori/60">
          {s.state === "active" ? nextRunLabel(s.nextRunAt, now) : "paused — not running"}
          {s.lastRunAt != null && ` · last run ${agoLabel(s.lastRunAt, now)}`}
        </p>
      )}

      {s.lastExecution && (
        <p className="mt-1 font-mono text-xs text-nori/60">
          last fill: {describeExecution(s.lastExecution, s.side, ticker)}
        </p>
      )}

      <p className="mt-2 font-mono text-xs text-nori/60">
        {capLabel(s.spentTodayUsd, s.caps?.perDayUsd ?? null)} today
        {s.caps?.lifetimeUsd != null && ` · ${capLabel(s.spentLifetimeUsd, s.caps.lifetimeUsd)} lifetime`}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {s.state === "active" ? (
          <Control
            label={pending === `pause:${s.id}` ? "PAUSING…" : "⏸ PAUSE"}
            disabled={disabled}
            onClick={() => void onAct(`pause:${s.id}`, { action: "pause", scheduleId: s.id })}
          />
        ) : (
          <Control
            label={pending === `resume:${s.id}` ? "RESUMING…" : "▶️ RESUME"}
            disabled={disabled}
            onClick={() => void onAct(`resume:${s.id}`, { action: "resume", scheduleId: s.id })}
          />
        )}
        <Control label="💰 AMOUNT" disabled={disabled} onClick={() => setEditing(editing === "amount" ? null : "amount")} />
        <Control label="⏱ INTERVAL" disabled={disabled} onClick={() => setEditing(editing === "interval" ? null : "interval")} />
        <Control label="🛡 CAPS" disabled={disabled} onClick={() => setEditing(editing === "caps" ? null : "caps")} />
      </div>

      {editing === "amount" && (
        <Editor
          hint={
            s.side === "buy"
              ? "SOL per buy, e.g. 0.05. The bot refuses anything under $1."
              : "Whole tokens (e.g. 5000) or a percent (e.g. 10%)."
          }
          initial={s.amountKind === "percent_of_balance" ? `${Number(s.amountRaw) / 100}%` : formatRaw(s.amountRaw, s.side === "buy" ? 9 : 0, 9)}
          disabled={disabled}
          onSubmit={(v) => void onAct(`amount:${s.id}`, { action: "amount", scheduleId: s.id, amount: v })}
        />
      )}
      {editing === "interval" && (
        <Editor
          hint="Whole minutes, at least 1."
          initial={String(s.intervalMinutes)}
          disabled={disabled}
          onSubmit={(v) => void onAct(`interval:${s.id}`, { action: "interval", scheduleId: s.id, interval: v })}
        />
      )}
      {editing === "caps" && (
        <CapsEditor
          caps={s.caps}
          disabled={disabled}
          onSubmit={(per, day, lifetime) =>
            void onAct(`caps:${s.id}`, { action: "caps", per, day, ...(lifetime ? { lifetime } : {}) })
          }
        />
      )}
    </article>
  );
}

function Control({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-11 border-2 border-nori/40 px-3 font-mono text-xs font-bold tracking-widest text-nori transition-colors hover:border-nori disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function Editor({
  hint,
  initial,
  disabled,
  onSubmit,
}: {
  hint: string;
  initial: string;
  disabled: boolean;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="mt-3 border-2 border-nori/20 bg-bone p-3">
      <p className="font-mono text-xs text-nori/60">{hint}</p>
      <div className="mt-2 flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
          className="min-h-11 w-full border-2 border-nori/30 bg-steamed px-3 font-mono text-sm text-nori"
        />
        <button
          type="button"
          onClick={() => onSubmit(value.trim())}
          disabled={disabled || value.trim().length === 0}
          className="min-h-11 border-2 border-olive bg-olive px-4 font-mono text-xs font-bold tracking-widest text-bone disabled:opacity-40"
        >
          SAVE
        </button>
      </div>
    </div>
  );
}

function CapsEditor({
  caps,
  disabled,
  onSubmit,
}: {
  caps: SiteSchedule["caps"];
  disabled: boolean;
  onSubmit: (per: string, day: string, lifetime: string) => void;
}) {
  const [per, setPer] = useState(caps ? String(caps.perExecUsd) : "");
  const [day, setDay] = useState(caps ? String(caps.perDayUsd) : "");
  const [life, setLife] = useState(caps?.lifetimeUsd != null ? String(caps.lifetimeUsd) : "");
  return (
    <div className="mt-3 border-2 border-nori/20 bg-bone p-3">
      <p className="font-mono text-xs text-nori/60">
        Dollar limits the bot enforces per trade, per day and over its lifetime. Leave lifetime blank
        to keep it as it is, or type <span className="font-bold">none</span> to clear it.
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(
          [
            ["per trade", per, setPer],
            ["per day", day, setDay],
            ["lifetime", life, setLife],
          ] as const
        ).map(([label, value, set]) => (
          <label key={label} className="font-mono text-xs text-nori/60">
            {label}
            <input
              value={value}
              onChange={(e) => set(e.target.value)}
              inputMode="decimal"
              className="mt-1 min-h-11 w-full border-2 border-nori/30 bg-steamed px-2 font-mono text-sm text-nori"
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onSubmit(per.trim(), day.trim(), life.trim())}
        disabled={disabled || per.trim() === "" || day.trim() === ""}
        className="mt-2 min-h-11 w-full border-2 border-olive bg-olive px-4 font-mono text-xs font-bold tracking-widest text-bone disabled:opacity-40"
      >
        SAVE CAPS
      </button>
    </div>
  );
}

function Digest({ data }: { data: SiteDashboard }) {
  const d = data.digest;
  if (!d || d.executions === 0) return null;
  return (
    <section className="border-2 border-nori/25 bg-steamed p-4">
      <h3 className="font-mono text-sm font-bold tracking-widest text-nori">LAST 24 HOURS</h3>
      <p className="mt-2 font-mono text-sm text-nori">
        {d.executions} execution{d.executions === 1 ? "" : "s"} · {d.confirmed} confirmed
        {d.unknown > 0 && <span className="font-bold text-tuna"> · {d.unknown} ⚠️ UNKNOWN</span>}
        {d.failed > 0 && ` · ${d.failed} failed`}
      </p>
      <p className="mt-1 font-mono text-xs text-nori/60">
        {usd(d.spentUsd)} spent · {usd(d.avgTradeUsd)}/trade
        {d.avgFillPriceUsd != null && ` · avg fill $${d.avgFillPriceUsd.toPrecision(4)}`}
        {d.settingChanges > 0 && ` · ${d.settingChanges} setting change${d.settingChanges === 1 ? "" : "s"}`}
      </p>
    </section>
  );
}

function History({ data, ticker, now }: { data: SiteDashboard; ticker: string; now: number }) {
  if (data.executions.length === 0) return null;
  const sideOf = (scheduleId: number): "buy" | "sell" =>
    data.schedules.find((s) => s.id === scheduleId)?.side ?? "buy";
  return (
    <section className="border-2 border-nori/25 bg-steamed p-4">
      <h3 className="font-mono text-sm font-bold tracking-widest text-nori">RECENT EXECUTIONS</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {data.executions.map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-xs">
            <span className={e.state === "UNKNOWN" ? "font-bold text-tuna" : "text-nori"}>
              {e.state === "UNKNOWN" ? "⚠️ " : ""}
              {describeExecution(e, sideOf(e.scheduleId), ticker)}
            </span>
            <span className="text-nori/50">
              {agoLabel(e.plannedAt, now)}
              {e.signature && (
                <>
                  {" · "}
                  <a
                    href={`https://solscan.io/tx/${e.signature}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-nori"
                  >
                    {shortId(e.signature)}
                  </a>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
