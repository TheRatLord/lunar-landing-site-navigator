import type { ReactNode, Ref } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../../components/ui/Icon";
import { formatDeg } from "../../lib/format";
import { hoursText, rankLabel, type RankBy } from "../../scenario/planSearch";
import { useMapStore } from "../map/mapStore";
import { useSearchResults } from "../search/results";
import { distanceText, sentence, type SearchAnswer, type Spot } from "./answer";
import { Failed, Figure, Wait } from "./Headline";
import { dayText } from "./survey";

interface WhereAnswerProps {
  ask: ReactNode;
  blockRef: Ref<HTMLElement>;
  answer: SearchAnswer;
  siteName: string;
  landingMs: number;
  requirements: number;
  rank: RankBy;
  onUse(spot: Spot): void;
  onJump(ms: number): void;
}

const spots = (n: number): string => (n === 1 ? "1 spot" : `${n} spots`);

function scopeText(a: SearchAnswer, siteName: string, landingMs: number): string {
  const days = a.first_ms !== null && a.last_ms !== null ? Math.round((a.last_ms - a.first_ms) / 86_400_000) : 0;
  const when = a.windowed && a.first_ms !== null ? `${days}-day window from ${dayText(a.first_ms)}` : `landing ${dayText(landingMs)}`;
  return `Within ${distanceText(a.radius_m)} of ${siteName} · ${when}`;
}

function where(s: Spot): string {
  return s.here ? "the site itself" : `${distanceText(s.dist_m)} ${s.dir} of the site`;
}

export function WhereAnswer({ ask, blockRef, answer: a, siteName, landingMs, requirements, rank, onUse, onJump }: WhereAnswerProps) {
  const navigate = useNavigate();
  const run = useSearchResults((s) => s.run);
  const best = a.spots[0] ?? null;
  const findNow = () => a.plan.body && run(a.plan.body, a.plan.guessS);
  const seeAll = () => {
    useMapStore.getState().set({ dockOpen: true });
    navigate("/map");
  };

  let head: ReactNode;
  let note: string | null = null;
  if (a.phase === "running") {
    head = <Wait text={`Searching${a.progress ? ` · ${Math.round(a.progress * 100)}%` : ""}`} />;
  } else if (a.phase === "error" && !a.fresh) {
    head = <Failed onRetry={findNow} />;
  } else if (!a.fresh || !best) {
    head = <p className="home-headline-text">Where near {siteName}?</p>;
    note = a.changed ? "The last search doesn't match the plan any more." : a.fresh ? "The search found no spot it could check in full." : null;
  } else if (requirements === 0) {
    const total = best.row.totals[rank];
    head = (
      <p className="home-headline-text">
        <strong className="verdict-word" data-tone="unknown">
          Best spot: {where(best)}.
        </strong>
      </p>
    );
    note = total != null ? `${hoursText(total)} of ${rankLabel(rank)}. No requirements are set, so every spot counts as a pass.` : "No requirements are set, so every spot counts as a pass.";
  } else {
    const tone = best.row.state === "pass" ? "pass" : best.row.state === "marginal" ? "marginal" : "fail";
    const word = tone === "pass" ? `${spots(a.counts.pass)} ${a.counts.pass === 1 ? "passes" : "pass"}.` : tone === "marginal" ? "None pass." : "Nothing passes.";
    const detail =
      tone === "pass"
        ? `The best is ${where(best)}`
        : tone === "marginal"
          ? `${spots(a.counts.marginal)} marginal; the best is ${where(best)}`
          : best.row.limitingLabel
            ? `The best spot fails on ${best.row.limitingLabel}`
            : `The best spot is ${where(best)}`;
    head = (
      <p className="home-headline-text">
        <strong className="verdict-word" data-tone={tone}>
          {word}
        </strong>
        <span className="home-verdict-detail"> {sentence(detail)}</span>
      </p>
    );
    if (a.windowed && best.row.n_epochs > 1) note = `It passes at ${best.row.n_epochs_pass} of ${best.row.n_epochs} landing times in the window.`;
  }

  const ready = a.fresh && best !== null;
  const share = ready && a.windowed && best.row.n_epochs > 1 ? `${best.row.n_epochs_pass}/${best.row.n_epochs}` : null;

  return (
    <>
      <section ref={blockRef} className="home-verdict" aria-live="polite">
        {ask}
        <p className="home-eyebrow">{scopeText(a, siteName, landingMs)}</p>
        {head}
        {note && <p className="home-headline-note">{note}</p>}
        {!ready && a.phase !== "running" && (
          <p className="home-headline-sub">
            Checks every spot {distanceText(a.radius_m)} around the site {a.windowed ? "across the landing window" : "at the plan's landing time"}, then ranks them by {rankLabel(rank)}.
          </p>
        )}
      </section>

      {ready && (
        <dl className="home-figures">
          <Figure label={requirements === 0 ? "spots checked in full" : a.counts.pass === 1 ? "spot passes" : "spots pass"} value={requirements === 0 ? a.counts.full : a.counts.pass} />
          {!best.here && <Figure label="to the best spot" value={distanceText(best.dist_m)} />}
          {share && <Figure label="landing times it passes" value={share} />}
          {a.windowed && best.landing_ms !== null && <Figure label="Best landing there" value={dayText(best.landing_ms)} onClick={() => (best.here ? onJump(best.landing_ms!) : onUse(best))} />}
          {best.row.slope_deg !== null && <Figure label="Slope there" value={formatDeg(best.row.slope_deg, 1)} extra />}
        </dl>
      )}

      <div className="home-actions">
        {ready ? (
          <>
            <button type="button" className="btn btn-default home-cta" onClick={seeAll}>
              See all in Map
            </button>
            {best.here ? (
              <Link className="btn btn-primary home-cta" to="/site">
                Open Site
                <Icon name="chevronRight" size={14} />
              </Link>
            ) : (
              <button type="button" className="btn btn-primary home-cta" onClick={() => onUse(best)}>
                Use the best spot
              </button>
            )}
          </>
        ) : a.phase !== "running" ? (
          <button type="button" className="btn btn-primary home-cta" disabled={!a.plan.body} title={a.plan.reason ?? undefined} onClick={findNow}>
            {a.changed ? "Search again" : "Find sites"}
            {a.plan.about ? ` · ${a.plan.about}` : ""}
          </button>
        ) : null}
      </div>
    </>
  );
}
