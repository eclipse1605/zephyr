export type AqiScale = "india" | "us";
export type CityGroup = "india" | "brics";
export type StationSource = "openaq" | "waqi" | "cpcb";
export type DataMode = "live" | "demo";

export type AqiBand =
  | "Good"
  | "Satisfactory"
  | "Moderate"
  | "Poor"
  | "Very Poor"
  | "Severe";

export type HazardType =
  | "smoke"
  | "dust"
  | "haze"
  | "fire"
  | "trash_fire"
  | "construction"
  | "other";

export type PromotionReason =
  | "citizens"
  | "citizen_sensor"
  | "citizen_satellite"
  | "sensor_satellite"
  | "sensor_only";

export type IncidentStatus =
  | "open"
  | "dispatched"
  | "resolved"
  | "false_positive"
  | "disputed";

export type ClosureAnswer = "FIXED" | "STILL";

export type LatLng = { lat: number; lng: number };

export type PollutantReadings = {
  pm25?: number | null;
  pm10?: number | null;
  no2?: number | null;
  so2?: number | null;
  co?: number | null;
  ozone?: number | null;
  nh3?: number | null;
};

export type StationReading = {
  id: string;
  name: string;
  cityId: string;
  lat: number;
  lng: number;
  owner?: string;
  sourceFeed: StationSource;
  lastSeen: string; // ISO
  pollutants: PollutantReadings;
};

export type CityStandards = {
  source: string;
  pm25: number;
  pm10: number;
  no2: number | null;
  so2: number | null;
};

export type CityConfig = {
  id: string;
  name: string;
  region: string;
  group: CityGroup;
  aqiScale: AqiScale;
  country: string;
  countryCode: string;
  center: LatLng;
  zoom: number;
  timeZone: string;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  stations: { sources: StationSource[]; network: string };
  standards: CityStandards;
  fireRegion: { bounds: readonly [number, number, number, number]; label: string };
  localLanguage: { code: string; name: string } | null;
};
