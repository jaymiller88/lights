// Aurora-chasing zones around Tromsø, Norway
// Each zone has locations with coordinates for weather lookups,
// light pollution ratings, drive times, and metadata.

export const TROMSO_CENTER = { lat: 69.6496, lon: 18.9560 };

export const ZONES = {
  '0': {
    name: 'In Town / Quick Fallback',
    code: '0',
    driveMinutes: [0, 15],
    lightPollution: 'high',
    lightPollutionScore: 0,    // 0-15, higher = darker/better
    description: 'Tromsø city area. Higher light pollution but minimal driving.',
    locations: [
      {
        id: 'prestvannet',
        name: 'Prestvannet',
        anchor: 'Prestvannet, Tromsø',
        lat: 69.6553,
        lon: 19.0066,
        parking: 'Park at the lake car park. Avoid blocking residential streets.',
        notes: 'Small lake with some darkness on the north side. Light dome from city is significant.',
      },
      {
        id: 'telegrafbukta',
        name: 'Telegrafbukta',
        anchor: 'Telegrafbukta',
        lat: 69.6367,
        lon: 19.0214,
        parking: 'Beach car park. Usually plowed in winter.',
        notes: 'Southern tip of Tromsø island. Open view south and west. City lights behind you.',
      },
      {
        id: 'tromsdalen',
        name: 'Tromsdalen Viewpoints',
        anchor: 'Tromsdalen, Tromsø',
        lat: 69.6450,
        lon: 19.0700,
        parking: 'Side streets away from main road. Avoid blocking driveways.',
        notes: 'Dark side streets and park edges away from streetlights. Look for spots facing away from city.',
      },
    ],
  },
  W: {
    name: 'Kvaløya / West',
    code: 'W',
    driveMinutes: [15, 75],
    lightPollution: 'low-medium',
    lightPollutionScore: 8,
    description: 'West of Tromsø. Darker skies, fjord scenery, mountain passes.',
    locations: [
      {
        id: 'finnvikdalen',
        name: 'Finnvikdalen Plateau',
        anchor: 'Finnvikdalen',
        lat: 69.7089,
        lon: 18.5333,
        parking: 'Wide shoulders along the road. Stay off the road surface.',
        notes: 'Elevated plateau area with open views. Good for panoramic aurora shots.',
      },
      {
        id: 'skulsfjord',
        name: 'Skulsfjord',
        anchor: 'Skulsfjord, Tromsø',
        lat: 69.7167,
        lon: 18.5833,
        parking: 'Pull-offs along fjord road. Use reflective vest when outside car.',
        notes: 'Fjord reflections possible. Nice foreground elements.',
      },
      {
        id: 'ersfjordbotn',
        name: 'Ersfjordbotn / Ersfjord',
        anchor: 'Ersfjordbotn',
        lat: 69.6500,
        lon: 18.5333,
        parking: 'Car park at the beach end. Well-known photography spot.',
        notes: 'Classic aurora photo location. Beach with mountains. Can be crowded on good nights.',
      },
      {
        id: 'kattfjordvatnet',
        name: 'Kattfjordvatnet',
        anchor: 'Kattfjordvatnet',
        lat: 69.6333,
        lon: 18.4167,
        parking: 'Pull-offs near the lake. Limited space.',
        notes: 'Lake reflections. More sheltered from wind. Less crowded.',
      },
      {
        id: 'grotfjord',
        name: 'Grøtfjord',
        anchor: 'Grøtfjord',
        lat: 69.7333,
        lon: 18.3833,
        parking: 'Beach car park at road end.',
        notes: 'End-of-road location. Very dark. Beach foreground. Exposed to weather.',
      },
      {
        id: 'sommaroy',
        name: 'Sommarøy / Bridge Area',
        anchor: 'Sommarøy',
        lat: 69.6333,
        lon: 18.0167,
        parking: 'Near the bridge or beach areas. Respect private property.',
        notes: 'Beautiful island setting. Only recommend if weather is good - exposed location. ~75 min drive.',
      },
    ],
  },
  'E/NE': {
    name: 'Lyngen / Breivikeidet / Oldervik',
    code: 'E/NE',
    driveMinutes: [45, 90],
    lightPollution: 'low',
    lightPollutionScore: 10,
    description: 'East/northeast of Tromsø. Often good cloud escape route.',
    locations: [
      {
        id: 'oldervik',
        name: 'Oldervik',
        anchor: 'Oldervik, Tromsø',
        lat: 69.8333,
        lon: 19.4167,
        parking: 'Village pull-offs. Small harbor area.',
        notes: 'Coastal village northeast. Good for escaping Kvaløya weather. Open northern view.',
      },
      {
        id: 'breivikeidet',
        name: 'Breivikeidet',
        anchor: 'Breivikeidet',
        lat: 69.7167,
        lon: 19.5500,
        parking: 'Ferry terminal area or pull-offs along E6.',
        notes: 'Good intermediate stop. Can assess conditions before committing further east.',
      },
      {
        id: 'laksvatnet',
        name: 'Laksvatnet / Lakselvbukt',
        anchor: 'Lakselvbukt',
        lat: 69.5167,
        lon: 19.5667,
        parking: 'Pull-offs along the valley road. Lake parking areas.',
        notes: 'Valley corridor with potential clear patches. Lake foreground.',
      },
      {
        id: 'oteren',
        name: 'Oteren / Storfjord',
        anchor: 'Oteren',
        lat: 69.2000,
        lon: 19.6000,
        parking: 'E6 pull-offs. Gas station area.',
        notes: 'Storfjord corridor. Gateway to Skibotn microclimate zone.',
      },
    ],
  },
  SE: {
    name: 'Skibotn / Storfjord Inland',
    code: 'SE',
    driveMinutes: [90, 110],
    lightPollution: 'very-low',
    lightPollutionScore: 12,
    description: 'Classic clearer microclimate. Inland fjord area often avoids coastal clouds.',
    locations: [
      {
        id: 'skibotn',
        name: 'Skibotn',
        anchor: 'Skibotn',
        lat: 69.3833,
        lon: 20.2333,
        parking: 'Multiple pull-offs along E6. Old military camp area has wide spaces.',
        notes: 'Famous for clearer skies due to rain shadow effect. Well-known aurora destination.',
      },
      {
        id: 'hatteng',
        name: 'Hatteng / Storfjord Inland',
        anchor: 'Hatteng',
        lat: 69.3167,
        lon: 19.7833,
        parking: 'Road pull-offs. Wide shoulders available.',
        notes: 'Inland pull-offs with dark skies. Good intermediate position.',
      },
    ],
  },
  S: {
    name: 'Målselv / Bardufoss',
    code: 'S',
    driveMinutes: [105, 135],
    lightPollution: 'very-low',
    lightPollutionScore: 13,
    description: 'Inland valley. Often more stable conditions, very dark.',
    locations: [
      {
        id: 'bardufoss',
        name: 'Bardufoss',
        anchor: 'Bardufoss',
        lat: 69.0667,
        lon: 18.5333,
        parking: 'E6 pull-offs. Avoid military base area.',
        notes: 'Inland valley, often avoids coastal weather systems. Very dark skies.',
      },
      {
        id: 'malselv',
        name: 'Målselv Valley',
        anchor: 'Målselv',
        lat: 69.0000,
        lon: 18.3333,
        parking: 'Valley road pull-offs. Wide open areas.',
        notes: 'Long valley with multiple stopping points. Consistent darkness.',
      },
    ],
  },
  F: {
    name: 'Finland "Nuclear Option"',
    code: 'F',
    driveMinutes: [150, 180],
    lightPollution: 'minimal',
    lightPollutionScore: 15,
    description: 'Kilpisjärvi, Finland. Only if substantially clearer than Norway options.',
    requiresBorderCrossing: true,
    timeZoneNote: 'Finland is UTC+2 (EET), one hour ahead of Norway (CET)',
    locations: [
      {
        id: 'kilpisjarvi',
        name: 'Kilpisjärvi',
        anchor: 'Kilpisjärvi',
        lat: 69.0500,
        lon: 20.8000,
        parking: 'Village parking. Hotel area. Lake viewpoints.',
        notes: 'Often the clearest skies in the region due to continental climate. REQUIRES: passport/ID, rental car border permission, awareness of time zone (+1h) and extreme cold.',
      },
    ],
  },
  SW: {
    name: 'Senja',
    code: 'SW',
    driveMinutes: [120, 180],
    lightPollution: 'low',
    lightPollutionScore: 11,
    description: 'Scenic but exposed. Ferry may be needed depending on route.',
    mayRequireFerry: true,
    locations: [
      {
        id: 'mefjordvaer',
        name: 'Mefjordvær / Northern Senja',
        anchor: 'Mefjordvær',
        lat: 69.4167,
        lon: 17.1833,
        parking: 'Small harbor parking. Limited space.',
        notes: 'Dramatic Senja coastline. Very scenic but exposed to wind and weather. Check ferry schedule if using the Botnhamn-Brensholmen route.',
      },
    ],
  },
};

// Representative weather check points for quick comparison
export const WEATHER_CHECKPOINTS = [
  { id: 'tromso', name: 'Tromsø', lat: 69.6496, lon: 18.9560, zone: '0' },
  { id: 'ersfjordbotn', name: 'Ersfjordbotn (Kvaløya)', lat: 69.6500, lon: 18.5333, zone: 'W' },
  { id: 'oldervik', name: 'Oldervik', lat: 69.8333, lon: 19.4167, zone: 'E/NE' },
  { id: 'skibotn', name: 'Skibotn', lat: 69.3833, lon: 20.2333, zone: 'SE' },
  { id: 'bardufoss', name: 'Bardufoss', lat: 69.0667, lon: 18.5333, zone: 'S' },
  { id: 'kilpisjarvi', name: 'Kilpisjärvi', lat: 69.0500, lon: 20.8000, zone: 'F' },
  { id: 'mefjordvaer', name: 'Mefjordvær (Senja)', lat: 69.4167, lon: 17.1833, zone: 'SW' },
];

// Cloud regime groupings for backup diversity
export const CLOUD_REGIMES = {
  coastal: ['0', 'W', 'SW'],
  inland_east: ['E/NE', 'SE', 'F'],
  inland_south: ['S'],
};

// Get all unique locations for weather fetching
export function getAllLocations() {
  const locations = [];
  for (const zone of Object.values(ZONES)) {
    for (const loc of zone.locations) {
      locations.push({
        ...loc,
        zoneCode: zone.code,
        zoneName: zone.name,
        lightPollutionScore: zone.lightPollutionScore,
        driveMinutes: zone.driveMinutes,
      });
    }
  }
  return locations;
}

// Get the cloud regime for a zone code
export function getCloudRegime(zoneCode) {
  for (const [regime, zones] of Object.entries(CLOUD_REGIMES)) {
    if (zones.includes(zoneCode)) return regime;
  }
  return 'unknown';
}
