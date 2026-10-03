// The recovery phrase: six words drawn from 256 plain English words (one
// byte each, no modulo bias). Only the Create account form needs this list,
// so it lives apart from the validators the app always loads.

export function generateRecoveryPhrase(words = 6): string {
  const bytes = new Uint8Array(Math.max(1, words));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => {
    const word = RECOVERY_WORDS[b];
    if (!word) throw new Error("The word list must hold 256 words.");
    return word;
  }).join(" ");
}

/**
 * Exactly 256 short, common, unambiguous English words, so one random byte
 * picks one word without bias. Plain things, colours, weather, places,
 * tools; nothing from a franchise and nothing that reads as a command.
 */
export const RECOVERY_WORDS: readonly string[] = Object.freeze([
  "acorn", "amber", "anchor", "apple", "arch", "arrow", "ash", "aspen",
  "atlas", "autumn", "badge", "bamboo", "barley", "basin", "basket", "beach",
  "beacon", "bean", "bear", "beech", "bell", "berry", "birch", "bison",
  "blanket", "bloom", "boat", "bolt", "bone", "book", "boot", "bottle",
  "branch", "brass", "bread", "breeze", "brick", "bridge", "brook", "broom",
  "bucket", "butter", "button", "cabin", "cactus", "camel", "candle", "canoe",
  "canvas", "canyon", "carbon", "carrot", "castle", "cedar", "chalk", "cherry",
  "chess", "cider", "cinder", "clay", "cliff", "clock", "cloud", "clover",
  "coal", "cobalt", "coast", "coffee", "comet", "copper", "coral", "cotton",
  "crane", "creek", "cricket", "crow", "crystal", "cumin", "cup", "daisy",
  "dawn", "deer", "delta", "desert", "dew", "dolphin", "donkey", "dove",
  "dragon", "drum", "dune", "dusk", "eagle", "earth", "ember", "falcon",
  "feather", "fennel", "fern", "field", "fig", "finch", "fir", "flame",
  "flint", "flute", "fog", "forest", "fossil", "fox", "frost", "garden",
  "garlic", "ginger", "glacier", "glass", "goat", "goose", "grain", "granite",
  "grape", "gravel", "grove", "gull", "harbor", "harp", "hawk", "hazel",
  "heron", "hill", "honey", "horse", "iris", "iron", "island", "ivory",
  "ivy", "jade", "jasper", "juniper", "kelp", "kettle", "lagoon", "lake",
  "lantern", "lark", "lava", "leaf", "lemon", "lily", "linen", "lion",
  "lotus", "lumber", "lunar", "magnet", "mango", "maple", "marble", "meadow",
  "melon", "mesa", "mint", "mist", "moose", "moss", "moth", "nectar",
  "nickel", "oak", "oasis", "ocean", "olive", "onyx", "orbit", "orchid",
  "otter", "owl", "oyster", "paddle", "palm", "paper", "parrot", "pearl",
  "pebble", "pepper", "pine", "planet", "plum", "pond", "poppy", "prairie",
  "quail", "quartz", "rabbit", "raven", "reed", "ridge", "river", "robin",
  "rose", "ruby", "saddle", "sage", "salmon", "sand", "sapphire", "seal",
  "shell", "silk", "silver", "slate", "snow", "spruce", "squash", "stone",
  "storm", "summit", "sunset", "swan", "thistle", "thunder", "tiger", "timber",
  "topaz", "trout", "tulip", "tundra", "turtle", "valley", "velvet", "violet",
  "walnut", "walrus", "water", "wheat", "willow", "wind", "wolf", "wren",
  "yarn", "yew", "zebra", "zinc", "ladder", "mirror", "needle", "pillow",
  "anvil", "bagel", "cello", "domino", "engine", "fabric", "gallon", "hammer",
]);
