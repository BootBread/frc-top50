// What people say, per level and event. Each entry is a list of [character id, line].
// Events: start (the level begins), done (the level is finished), and one per objective id.
export const LINES = {
  farm: {
    start: [
      ["dot", "Oh, thank goodness you're here. That storm made a mess of the whole farm last night."],
      ["dot", "First things first: Clementine's got out again. Follow her muddy hoofprints from the pen and find her, would you?"],
    ],
    pig: [["dot", "There's my girl! I'll walk her home. Now, my tractor's been stuck up the lane since the storm."]],
    tractor: [["dot", "Ooh, she's out! That winch is a marvel. A boulder came down into the paddock gate, too."]],
    gate: [["dot", "Lovely. The sinkhole by the well is next. Use the spoil heap in the paddock, that's what it's for."]],
    sink: [["dot", "Good as new! Last thing: three trees fell across the barn lane. Pop them on the woodpile?"]],
    logs: [["dot", "That'll keep me warm all winter. I've opened the barn. There's something up there for you."]],
    done: [
      ["dot", "That's Grandpa's old road roller. Take it. I don't drive anymore."],
      ["bea", "Road roller unlocked! Switch to it in the quarry garage or at any purple vehicle yard."],
    ],
  },
  river: {
    start: [
      ["mia", "Hi! I'm Mia, and this is our wedding day. The storm took the bridge, and our cake is on the wrong side."],
      ["theo", "Dirt washes straight away in that current. Rocks upstream would calm it. Probably. I'm an accountant."],
    ],
    riprap: [["theo", "Look, the water's slower behind the boulders. Told you. Probably."]],
    causeway: [["mia", "A road across the river! Can you firm it up? I'd hate for it to wash away mid-ceremony."]],
    pack: [["theo", "Packed solid. That'll hold a car. Ours, ideally."]],
    gravel: [["mia", "The mud's done! Now the important bit: the cake. Gently, please!"]],
    cake: [["mia", "It made it! Everyone, the cake is here!"]],
    done: [
      ["theo", "Thank you. Really. We'll drive home over your causeway tonight."],
      ["mia", "And you're invited to the anniversary. Bring the loader."],
    ],
  },
  flood: {
    start: [
      ["bea", "It's the storm again. The river is rising behind the levee, and the whole town is down here."],
      ["bea", "Shut the floodgate with the big wheel, and plug the breaks. Everyone we helped is counting on us."],
    ],
    late: [["bea", "The levee just gave way at the east end! There's a new break."]],
    gate: [["bea", "Gate's shut. Now those breaks."]],
    breaks: [["bea", "That's every break. Hold steady until it peaks."]],
    done: [
      ["bea", "It's peaked. The rain's stopping. The water's going down."],
      ["dot", "My barn's still standing! Clementine sends her love. Mostly mud."],
      ["mia", "You saved our car, and the town. That's two favours we owe you."],
      ["walt", "June says you'd better come up for tea. That's an order."],
      ["ranger", "Campground's dry too. Not a single tent floated off."],
    ],
  },
  haul: {
    start: [
      ["ranger", "Morning! Campground opens at dawn, and folks are already queueing at the gate."],
      ["ranger", "The tent pads need gravel. The pit's up the switchbacks, past the stream. The ford's pure bog since the storm."],
    ],
    ford: [["ranger", "Nice work on the ford. The pit road's next: a tree and a couple of boulders came down on it."]],
    pit: [["ranger", "Pit's yours, truck's yours. Don't hit the sign."]],
    haul: [["ranger", "First load down the switchbacks! Spread it thin on the tent pads. Campers can feel every bump."]],
    pads: [["ranger", "That's the lot! Opening the gate."]],
    done: [
      ["ranger", "Look at them all. Best opening day this park's had."],
      ["bea", "Dump truck unlocked for good. It's in the quarry garage."],
    ],
  },
  ridge: {
    start: [
      ["june", "That's our cabin by the road. Forty years in the valley, and now we're moving up the ridge."],
      ["walt", "The storm dumped half the hill on the road. Take your time. Nobody's in a hurry but June."],
    ],
    slide: [["walt", "Ha! A road again. Don't waste that dirt, the gully further up will want every scoop."]],
    gully: [["june", "Smooth as a pancake. The cabin's ready when you are."]],
    stage: [["walt", "That last climb's too steep for anyone. There's a winch post at the top."]],
    wood: [["june", "Firewood! You think of everything."]],
    rocks: [["walt", "Every rock crushed. You'd have made a fine quarryman."]],
    done: [
      ["june", "Home. Oh, look at the view."],
      ["walt", "I'll put the kettle on. Come back any time."],
    ],
  },
};
