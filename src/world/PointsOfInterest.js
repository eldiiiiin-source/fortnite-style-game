/**
 * PointsOfInterest.js — the POI table from MAP_SPEC §5.3, as data.
 *
 * centre: [x, z] metres. footprint: [width, depth] metres. base: flattened elevation.
 */

export const POI_TIERS = Object.freeze({
  major: { chests: [12, 18], floorLoot: [22, 30], materials: 4000 },
  minor: { chests: [5, 8], floorLoot: [10, 15], materials: 2000 },
  landmark: { chests: [1, 3], floorLoot: [3, 6], materials: 800 }
});

export const POIS = Object.freeze([
  { id: 1, name: 'Cinder Town', tier: 'major', centre: [-320, -280], base: 22, footprint: [300, 260], biome: 'grassland' },
  { id: 2, name: 'Ember Peak', tier: 'major', centre: [40, 60], base: 150, footprint: [260, 240], biome: 'emberMassif' },
  { id: 3, name: 'Pinehollow', tier: 'major', centre: [-520, 340], base: 48, footprint: [280, 220], biome: 'pineForest' },
  { id: 4, name: 'Greyshale Quarry', tier: 'major', centre: [310, 470], base: 62, footprint: [320, 280], biome: 'quarryBadlands' },
  { id: 5, name: 'Harbour Point', tier: 'major', centre: [620, -180], base: 5, footprint: [260, 200], biome: 'coastal' },
  { id: 6, name: 'Copper Mill', tier: 'minor', centre: [-80, 560], base: 30, footprint: [160, 140], biome: 'grassland' },
  { id: 7, name: 'Lakeside Cabins', tier: 'minor', centre: [-640, -80], base: 14, footprint: [150, 120], biome: 'coastal' },
  { id: 8, name: 'Ridge Station', tier: 'minor', centre: [240, 140], base: 96, footprint: [140, 110], biome: 'emberMassif' },
  { id: 9, name: 'Windmill Fields', tier: 'minor', centre: [-280, 700], base: 26, footprint: [170, 150], biome: 'grassland' },
  { id: 10, name: 'Saltflat Docks', tier: 'minor', centre: [760, 420], base: 3, footprint: [150, 130], biome: 'coastal' },
  { id: 11, name: 'The Overlook', tier: 'landmark', centre: [120, -520], base: 74, footprint: [70, 70], biome: 'grassland' },
  { id: 12, name: 'Stone Circle', tier: 'landmark', centre: [-760, 620], base: 52, footprint: [60, 60], biome: 'pineForest' },
  { id: 13, name: 'Crashed Freighter', tier: 'landmark', centre: [880, -540], base: 2, footprint: [90, 60], biome: 'coastal' },
  { id: 14, name: 'Radio Mast', tier: 'landmark', centre: [520, 780], base: 58, footprint: [50, 50], biome: 'quarryBadlands' },
  { id: 15, name: 'Old Bridge', tier: 'landmark', centre: [-120, -760], base: 12, footprint: [180, 40], biome: 'coastal' }
]);

/** Harvestable density per 100x100 m cell, by biome. MAP_SPEC §6.1 */
export const BIOME_DENSITY = Object.freeze({
  coastal: { trees: 6, rocks: 4, metalObjects: 5 },
  grassland: { trees: 10, rocks: 3, metalObjects: 2 },
  pineForest: { trees: 34, rocks: 2, metalObjects: 1 },
  quarryBadlands: { trees: 3, rocks: 26, metalObjects: 4 },
  emberMassif: { trees: 2, rocks: 18, metalObjects: 1 }
});

/** Which POI contains a world point, or null. */
export function poiAt(x, z) {
  for (const poi of POIS) {
    const halfX = poi.footprint[0] / 2;
    const halfZ = poi.footprint[1] / 2;
    if (Math.abs(x - poi.centre[0]) <= halfX && Math.abs(z - poi.centre[1]) <= halfZ) {
      return poi;
    }
  }
  return null;
}

/** The loot tier to use at a world point — a POI's tier, or 'outside'. MAP_SPEC §6.3 */
export function lootTierAt(x, z) {
  return poiAt(x, z)?.tier ?? 'outside';
}

/** Distance between two POIs, centre to centre. */
export function poiDistance(a, b) {
  return Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1]);
}

/**
 * Biome at a world point. Inside a POI the POI's biome wins; otherwise it is derived
 * from position and elevation bands (MAP_SPEC §3.3, §5.1).
 */
export function biomeAt(x, z, height) {
  const poi = poiAt(x, z);
  if (poi) return poi.biome;

  if (height <= 6) return 'coastal';
  if (height >= 90) return 'emberMassif';
  if (Math.hypot(x, z) < 520 && height >= 35) return 'emberMassif';
  if (x < 0 && z > 0) return 'pineForest';
  if (x > 0 && z > 0 && height >= 35) return 'quarryBadlands';
  return 'grassland';
}
