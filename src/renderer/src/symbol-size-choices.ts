// Names/codes from the installed milsymbol renderer's getmetadata.js and
// lettersidc/metadata.js. This is renderer metadata, not the legacy crosswalk.
export const echelonChoices = [
  ["00", "Unspecified"],
  ["11", "Team / crew"],
  ["12", "Squad"],
  ["13", "Section"],
  ["14", "Platoon / detachment"],
  ["15", "Company / battery / troop"],
  ["16", "Battalion / squadron"],
  ["17", "Regiment / group"],
  ["18", "Brigade"],
  ["21", "Division"],
  ["22", "Corps / MEF"],
  ["23", "Army"],
  ["24", "Army group / front"],
  ["25", "Region / theater"],
  ["26", "Command"],
].map(([id, name]) => ({ id, name }));
export const mobilityChoices = [
  ["31", "Wheeled — limited cross-country"],
  ["32", "Wheeled — cross-country"],
  ["33", "Tracked"],
  ["34", "Wheeled and tracked"],
  ["35", "Towed"],
  ["36", "Rail"],
  ["37", "Pack animals"],
  ["41", "Over snow"],
  ["42", "Sled"],
  ["51", "Barge"],
  ["52", "Amphibious"],
  ["61", "Short towed array"],
  ["62", "Long towed array"],
  ["71", "Leader individual"],
  ["72", "Deputy individual"],
].map(([id, name]) => ({ id, name }));
export const legacyEchelonChoices = echelonChoices.map((choice, index) => ({
  ...choice,
  id: index === 0 ? "-" : String.fromCharCode(64 + index),
}));
