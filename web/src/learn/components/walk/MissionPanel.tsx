import { useEffect } from "react";
import { useLearn } from "../../store";
import { MISSIONS, MISSION_SPOTS, missionById, type MissionId, type MissionSpot } from "../../walk/missions";
import { CheckIcon, CloseIcon } from "../icons";

const NEAR_M = 4;

export function missionTarget(id: MissionId | null, step: number): MissionSpot | null {
  const m = missionById(id);
  return m && step < m.tasks.length ? (MISSION_SPOTS[step] ?? null) : null;
}

function start(id: MissionId) {
  useLearn.setState({ mission: id, missionStep: 0, missionFound: null, missionM: null, missionPicker: false });
  useLearn.getState().setWalkBody("rover");
}

function stop() {
  useLearn.setState({ mission: null, missionStep: 0, missionFound: null, missionM: null });
}

function Picker() {
  return (
    <section className="l-mission" aria-label="Rover missions">
      <header className="l-mission-head">
        <h2>Real rover missions</h2>
        <button type="button" className="l-note-close" aria-label="Close" onClick={() => useLearn.setState({ missionPicker: false })}>
          <CloseIcon size={16} />
        </button>
      </header>
      <p className="l-mission-lead">Do what a real rover did. Drive to each glowing marker.</p>
      <ul className="l-mission-list">
        {MISSIONS.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => start(m.id)}>
              <strong>{m.rover}</strong>
              <span>
                {m.mission}, {m.year}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MissionPanel() {
  const picker = useLearn((s) => s.missionPicker);
  const id = useLearn((s) => s.mission);
  const step = useLearn((s) => s.missionStep);
  const found = useLearn((s) => s.missionFound);
  const metres = useLearn((s) => s.missionM);
  const side = useLearn((s) => s.missionSide);
  const body = useLearn((s) => s.walkControl.body);
  const m = missionById(id);
  const task = m?.tasks[step] ?? null;
  const near = metres !== null && metres <= NEAR_M && body === "rover";
  const complete = () => {
    if (!task) return;
    useLearn.setState({ missionStep: step + 1, missionFound: task.found });
  };
  useEffect(() => {
    if (task && task.action === null && near) useLearn.setState({ missionStep: step + 1, missionFound: task.found });
  }, [task, near, step]);
  if (!m) return picker ? <Picker /> : null;
  const done = step >= m.tasks.length;
  return (
    <section className="l-mission" aria-label={`${m.rover} mission`} aria-live="polite">
      <header className="l-mission-head">
        <h2>
          {m.rover} <span>
            {m.mission}, {m.year}
          </span>
        </h2>
        <button type="button" className="l-note-close" aria-label="End the mission" onClick={stop}>
          <CloseIcon size={16} />
        </button>
      </header>
      {step === 0 && !found && <p className="l-mission-lead">{m.brief}</p>}
      <ol className="l-mission-steps">
        {m.tasks.map((t, i) => (
          <li key={t.goal} className={i < step ? "is-done" : i === step ? "is-now" : ""}>
            <span className="l-mission-n" aria-hidden>
              {i < step ? <CheckIcon size={12} /> : i + 1}
            </span>
            {t.goal}
          </li>
        ))}
      </ol>
      {found && <p className="l-mission-found">{found}</p>}
      {!done && task && (
        <div className="l-mission-now">
          {body !== "rover" ? (
            <button type="button" className="l-btn" onClick={() => useLearn.getState().setWalkBody("rover")}>
              Drive the rover
            </button>
          ) : near && task.action ? (
            <button type="button" className="l-btn l-btn-primary" onClick={complete}>
              {task.action}
            </button>
          ) : (
            <p>{metres === null ? "Find the glowing marker" : `Marker ${metres} m ${side}`}</p>
          )}
        </div>
      )}
      {done && (
        <div className="l-mission-end">
          <p>{m.ending}</p>
          <p className="l-mission-where">
            The real {m.rover} {m.where}.{" "}
            <a href={m.source} target="_blank" rel="noreferrer">
              Source
            </a>
          </p>
          <button type="button" className="l-btn" onClick={() => useLearn.setState({ mission: null, missionPicker: true })}>
            Try another rover
          </button>
        </div>
      )}
    </section>
  );
}
