// Tuning numbers, kept here so they can be changed without touching the game code.

// Stars: 1 is always "finish the level". Levels not listed use DEFAULT_STARS (one star per bonus job).
export const DEFAULT_STARS = ["Finish the job", "Do one bonus job", "Do both bonus jobs"];
export const LEVELS = {
  farm: {
    stars: ["Help Grandma Dinston", "Finish in under 10:00", "Never get stuck in the mud"],
    targetTime: 600,               // seconds, for the second star
  },
  flood: {
    stars: ["Get through the storm", "Keep 90% of the town dry", "Keep it all dry and rescue all three cars"],
    dryStar: 0.9,
    overflow: 60,                  // m³ a second pouring into the town for each metre the river is over the lowest point
    pastureFill: 300,              // seconds of spilling to fill the empty pasture
    spillSlow: 0.4,                // while the spillway runs, the river rises this much as fast
    current: 0.7,                  // m/s the river carries a floating car
    wheelPull: 8000,               // rope tension (N) needed to turn the floodgate wheel
    gateTime: 45,                  // seconds of reeling to wind the gate shut
  },
  haul: {
    stars: ["Open the campground", "Open it with fewer than 5 campers waiting", "Make every tent pad perfectly flat"],
    queueEvery: 75,                // seconds between campers joining the queue (it never stops the level)
    queueStar: 5,                  // fewer than this many waiting when the gate opens earns the second star
    flatPerfect: 0.04, flatGood: 0.1,   // spread of heights across a pad (m) for "perfect" and "good"
  },
  river: {
    stars: ["Get the cake to the wedding", "Pack 90% of the causeway", "Deliver the cake with all three tiers"],
    erosion: 3,                    // how much harder the river's current wears dirt than the base rates below
    packNeed: 0.6,                 // share of the causeway's top that must be packed (job)
    packStar: 0.9,                 // ... for the star
    cakeBump: 2.5,                 // m/s change in the cake's up-down speed over 5 physics steps that knocks a tier off
                                   // (gentle towing on the road: ~0.7; full speed: ~1.6; a 2 m drop: ~6)
  },
  ridge: {
    stars: ["Get the cabin to the summit", "Finish in under 15:00", "Never tip the cabin over 15°"],
    targetTime: 900,               // seconds, for the second star
    cutFillTolerance: 0.10,        // how far apart dug and placed dirt may be for the cut/fill star (fraction)
    gradeTolerance: 0.3,           // metres either side of the road level that count as "on grade"
  },
};

// Packing (firmness): 0 = freshly dumped, 1 = packed or undisturbed ground.
export const PACK = {
  perSecond: 0.7,                 // how fast a road roller drum packs level ground at full speed (about 3 passes)
  dumpFalloff: 0.08,               // dumping this many metres of dirt on a cell leaves about a third of its packing
};

// Character pop-ups
export const POPUP = { charsPerSecond: 70, minHold: 3.2, holdPerChar: 0.05 };

// Moving water wearing away loose dirt (Rapid River, Flood Season). Rates are metres per second of depth.
export const EROSION = {
  tick: 12,                        // physics steps between erosion passes (5 a second)
  face: 0.0015,                    // on the slope the current hits
  top: 0.0004,                     // on wet dirt that faces nothing in particular
  wetAbove: 0.45,                  // dirt up to this far above the water counts as wet
  shelter: 0.12,                   // how much of the wear is left behind a boulder (riprap)
  reach: 12, halfWidth: 1.4,       // how far downstream a boulder shelters, and how wide a strip
};
