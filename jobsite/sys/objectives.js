// Objectives as data. Each objective has:
//   id        a short name, also what gets synced between players
//   text      the job-panel text (a string, or a function for live numbers)
//   done()    true once it is achieved; after that it stays done
//   progress  optional function giving 0..1, shown as a percentage while unfinished
//   after     optional list of ids that must be done first (otherwise objectives run in parallel)
//   bonus     true for bonus jobs (not needed to finish the level)
//   hint      optional function giving the hint to show while this is the current objective
// onDone(id, quiet) is called once per objective; quiet is true when it came from a saved game.
export function createObjectives(defs, onDone) {
  const done = new Set(), ids = new Set(defs.map((d) => d.id));
  const ready = (d) => !d.after || d.after.every((a) => done.has(a));
  const val = (v) => (typeof v === "function" ? v() : v);
  const pct = (d) => (d.progress ? ` <span class="pct">${Math.floor(Math.min(1, Math.max(0, d.progress())) * 100)}%</span>` : "");
  function complete(id, quiet = false) {
    if (!ids.has(id) || done.has(id)) return;
    done.add(id);
    onDone(id, quiet);
  }
  const row = (d) => {
    const ok = done.has(d.id), cls = ok ? "done" : !ready(d) || d.bonus ? "sub" : "";
    return `<div class="${cls}">${ok ? "&#10003;" : "&#9675;"} ${val(d.text)}${ok ? "" : pct(d)}</div>`;
  };
  return {
    defs,
    has: (id) => done.has(id),
    list: () => [...done],
    complete,
    ready: (id) => ready(defs.find((d) => d.id === id)),
    update() { for (const d of defs) if (!done.has(d.id) && ready(d) && d.done()) complete(d.id); },
    mainDone: () => defs.every((d) => d.bonus || done.has(d.id)),
    bonusTotal: () => defs.filter((d) => d.bonus).length,
    bonusDone: () => defs.filter((d) => d.bonus && done.has(d.id)).length,
    // the first unfinished main objective that can be worked on now
    current: () => defs.find((d) => !d.bonus && !done.has(d.id) && ready(d)) || null,
    render() {
      const main = defs.filter((d) => !d.bonus), bonus = defs.filter((d) => d.bonus);
      return main.map(row).join("") + (bonus.length ? `<div class="sub" style="margin-top:6px">Bonus</div>${bonus.map(row).join("")}` : "");
    },
  };
}

// Ready-made tests for the usual kinds of objective.
export const when = {
  // a body (or anything with translation()) is inside a circle {x, z, r}, optionally above a height
  inZone: (getBody, zone, minY = -Infinity) => () => {
    const b = getBody(); if (!b) return false;
    const t = (b.body || b).translation();
    return Math.hypot(t.x - zone.x, t.z - zone.z) < zone.r && t.y > minY;
  },
  // a number has reached a target
  atLeast: (get, n) => () => get() >= n,
  // all of several tests are true at once
  all: (...tests) => () => tests.every((f) => f()),
};
