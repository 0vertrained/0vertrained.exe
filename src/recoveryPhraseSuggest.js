// src/recoveryPhraseSuggest.js
// V13.6 · Suggests a high-entropy recovery phrase so users don't default to a
// weak, guessable one. A user-chosen phrase is only as strong as its entropy;
// paired with the PBKDF2 upgrade (recoveryKdf.js), a generated 4-word phrase
// from this 256-word list gives 32 bits of entropy before the KDF stretch,
// which is far past what dictionary attacks chew through cheaply. Custom
// phrases remain allowed — this is a nudge, not a mandate.
//
// The list is intentionally short, concrete, and easy to hand-write on paper
// (the intended storage): common nouns/adjectives, no homophones split across
// entries, no profanity. 256 words = a clean full byte of selection each.

const WORDS = [
  "anchor", "amber", "arrow", "atlas", "aspen", "azure", "acorn", "apex",
  "basin", "birch", "boulder", "brass", "breeze", "bridge", "bronze", "brook",
  "cable", "canyon", "cedar", "chalk", "cinder", "clover", "cobalt", "copper",
  "coral", "cove", "crane", "crater", "crest", "cyan", "cypress", "dawn",
  "delta", "diesel", "dial", "dock", "dune", "dusk", "eagle", "east",
  "ember", "ledger", "engine", "falcon", "fathom", "fern", "field", "flint",
  "forge", "fossil", "frost", "gable", "garnet", "gorge", "granite", "gravel",
  "grove", "gulf", "harbor", "hazel", "helm", "hollow", "ivory", "jade",
  "jasper", "jetty", "kernel", "kettle", "keel", "lantern", "larch", "ledge",
  "linen", "lodge", "lumen", "maple", "marble", "marsh", "meadow", "mesa",
  "mica", "moss", "north", "oak", "ochre", "onyx", "opal", "orbit",
  "otter", "paddle", "pebble", "pier", "pine", "piston", "plateau", "plume",
  "prairie", "quarry", "quartz", "quill", "raven", "reef", "resin", "ridge",
  "river", "rope", "rowan", "rudder", "rust", "saddle", "sage", "sail",
  "sandbar", "sequoia", "shale", "shore", "signal", "silo", "sitka", "slate",
  "sleet", "sloop", "smith", "south", "spruce", "steel", "stone", "storm",
  "strand", "summit", "sundial", "surf", "talon", "tarn", "teak", "thicket",
  "thorn", "tidal", "timber", "tin", "topaz", "torch", "tower", "trail",
  "trench", "tundra", "vale", "valley", "vane", "vault", "verge", "vessel",
  "vista", "walnut", "west", "wharf", "willow", "wind", "wren", "yarrow",
  "zenith", "zephyr", "almond", "antler", "badger", "beacon", "beam", "bison",
  "bloom", "bluff", "bramble", "brine", "burrow", "cabin", "cairn", "camber",
  "cask", "chime", "cliff", "cog", "compass", "cotton", "creek", "current",
  "cutter", "dahlia", "damson", "drift", "elm", "estuary", "fjord", "flume",
  "gale", "glade", "glen", "gorse", "hearth", "heather", "hemlock", "hickory",
  "inlet", "iron", "juniper", "kelp", "knoll", "lagoon", "lark", "laurel",
  "lichen", "loam", "mallow", "mangrove", "meridian", "millet", "mint", "moor",
  "nectar", "oats", "orchard", "osprey", "paddock", "pampas", "pasture", "peat",
  "pewter", "pippin", "poplar", "quay", "quince", "reed", "rill", "rookery",
  "rushes", "russet", "saffron", "sander", "sedge", "sorrel", "spindle", "sprig",
  "starling", "sterling", "stipple", "swale", "sycamore", "tamarisk", "tansy", "terrace",
  "thistle", "tideway", "turret", "vetch", "viaduct", "warren", "weld", "yeoman",
];

// Cryptographically uniform index into WORDS (rejection-sampled to avoid modulo
// bias, though 256 divides 256 evenly so bias is nil here — kept correct in case
// the list length ever changes).
function randomIndex(max) {
  const limit = Math.floor(256 / max) * max;
  const buf = new Uint8Array(1);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % max;
}

// Generate a space-separated phrase. Four words (~32 bits) by default.
export function suggestRecoveryPhrase(wordCount = 4) {
  const count = Math.max(3, Math.min(6, wordCount | 0));
  const picks = [];
  for (let i = 0; i < count; i++) picks.push(WORDS[randomIndex(WORDS.length)]);
  return picks.join(" ");
}

export const RECOVERY_PHRASE_WORDLIST_SIZE = WORDS.length;
