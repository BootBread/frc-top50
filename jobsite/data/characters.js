// Everyone you meet is Winston, in a costume to match the job.
// The face is always the same (WINSTON); each character adds a costume on top of it.
// face options (drawn by sys/popups.js drawFace): hair short | long | bun | slick | grey-sides | none, hairColor,
// hat cap | hardhat | ranger | cowboy (+ hatColor), glasses round | shades, moustache, beard, mouth flat,
// veil, flower, bowtie, shawl, vest (hi-vis), shirt, bg (the backdrop colour)
const WINSTON = { skin: "#e6b48f", hair: "short", hairColor: "#5a3c26" };
const dress = (costume) => ({ ...WINSTON, ...costume });
export const CHARACTERS = {
  bea:    { name: "Foreman Binston", color: "#ffc928", blip: 520, face: dress({ hat: "hardhat", hatColor: "#ffc928", shirt: "#ef7d2d", vest: "#d8ff3a", bg: "#3c4a57" }) },
  dot:    { name: "Grandma Dinston", color: "#f2a7c3", blip: 680, face: dress({ hair: "bun", hairColor: "#d9d9d9", glasses: "round", shirt: "#9b5fa8", shawl: "#c98fc0", bg: "#5a4b63" }) },
  mia:    { name: "Minston", color: "#ffffff", blip: 610, face: dress({ veil: true, flower: "#ff9cc4", shirt: "#f4f1ea", bg: "#6f8fa6" }) },
  theo:   { name: "Tinston", color: "#9fd0e8", blip: 330, face: dress({ hair: "slick", shirt: "#2b2f36", bowtie: "#d8333a", bg: "#6f8fa6" }) },
  june:   { name: "Jinston Hollis", color: "#b9e07d", blip: 560, face: dress({ hairColor: "#c8c8c8", glasses: "round", shirt: "#6b8f4a", shawl: "#a8c27d", bg: "#4d5f45" }) },
  walt:   { name: "Winston Hollis", color: "#b9e07d", blip: 260, face: dress({ hair: "grey-sides", hairColor: "#cfcfcf", moustache: true, hat: "cap", hatColor: "#5a7d3a", shirt: "#8a5a3a", bg: "#4d5f45" }) },
  ranger: { name: "Ranger Sinston", color: "#e0c27d", blip: 430, face: dress({ hat: "ranger", hatColor: "#8b6b3e", shirt: "#5f6e3a", bg: "#3f5240" }) },
  pajaro: { name: "Señor Pinstón", color: "#7de0c9", blip: 380, face: dress({ hair: "slick", hairColor: "#141414", glasses: "shades", moustache: true, mouth: "flat", shirt: "#e8e1d0", bg: "#2f5a52" }) },
  gus:    { name: "Old Ginston", color: "#e8b06a", blip: 240, face: dress({ hair: "none", hairColor: "#eeeeee", beard: true, hat: "cowboy", hatColor: "#9a6a3a", shirt: "#7a4b2a", bg: "#6b5537" }) },
  ada:    { name: "Station Master Kinston", color: "#c9a6ff", blip: 500, face: dress({ hat: "cap", hatColor: "#2e3a7a", shirt: "#2e3a7a", bowtie: "#ffc928", bg: "#3c3f5c" }) },
  hinston: { name: "Captain Hinston", color: "#e8c87a", blip: 360, face: dress({ hat: "pirate", hatColor: "#1d232b", eyepatch: true, beard: true, shirt: "#d8333a", bg: "#2b4a6b" }) },
  lou:    { name: "Rancher Linston", color: "#ff9c6a", blip: 300, face: dress({ hat: "cowboy", hatColor: "#5a3d26", shirt: "#b8462e", shawl: "#d9c27a", bg: "#5c3b2e" }) },
};
