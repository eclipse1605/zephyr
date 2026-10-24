import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pollutantsFromOpenAqLatestRows,
  pollutantsFromOpenAqSensors,
  openAqPollutantsUsable,
  parseWaqiStations,
  parseCpcbRecords,
  parseCpcbLastUpdate,
  verifyTwilioSignature,
  twilioSignature,
  rankUpwind,
  exposureGaps,
  indiaAqiFromReadings,
  usAqiFromReadings,
  aqiBand,
  mergeStations,
  enrichStation,
  stationOverLimit,
  isStationOnline,
  decidePromotion,
  incidentDedupeKey,
  utcDayKey,
  joinWardToStation,
  summarizeWardBurden,
  shouldNotifyAlert,
  persistenceForecast,
  openClosureWindow,
  applyClosureAnswer,
  computeFusionConfidence,
  latLngToH3,
  getCity,
  CITIES,
} from "../src/index.js";

describe("india AQI", () => {
  it("computes sub-index max across pollutants", () => {
    const r = indiaAqiFromReadings({ pm25: 45, pm10: 80 });
    assert.ok(r);
    assert.equal(r!.band, "Satisfactory");
    assert.ok(r!.pollutants.includes("PM2.5"));
    assert.equal(r!.estimate, true);
  });

  it("works for PM10-only stations", () => {
    const r = indiaAqiFromReadings({ pm10: 120 });
    assert.ok(r);
    assert.equal(r!.dominant, "PM10");
    assert.ok(r!.aqi >= 100);
  });

  it("maps Poor threshold", () => {
    assert.equal(aqiBand(201), "Poor");
    assert.equal(aqiBand(200), "Moderate");
  });
});

describe("US AQI", () => {
  it("computes from PM2.5", () => {
    const r = usAqiFromReadings({ pm25: 35.5 });
    assert.ok(r);
    assert.ok(r!.aqi >= 100);
  });

  it("works for PM10-only", () => {
    const r = usAqiFromReadings({ pm10: 160 });
    assert.ok(r);
    assert.equal(r!.dominant, "PM10");
  });
});

describe("stations", () => {
  const now = new Date("2026-10-11T12:00:00Z");

  it("marks readings older than 24h offline", () => {
    assert.equal(isStationOnline("2026-10-09T12:00:00Z", now), false);
    assert.equal(isStationOnline("2026-10-11T10:00:00Z", now), true);
  });

  it("dedupes within 250m preferring newer live OpenAQ", () => {
    const merged = mergeStations(
      [
        {
          id: "a",
          name: "A",
          cityId: "delhi",
          lat: 28.61,
          lng: 77.21,
          sourceFeed: "waqi",
          lastSeen: "2026-10-11T10:00:00Z",
          pollutants: { pm25: 50 },
        },
        {
          id: "b",
          name: "B",
          cityId: "delhi",
          lat: 28.6101,
          lng: 77.2101,
          sourceFeed: "openaq",
          lastSeen: "2026-10-11T11:00:00Z",
          pollutants: { pm25: 55 },
        },
      ],
      "india",
      now,
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.sourceFeed, "openaq");
  });

  it("uses CPCB sourceAqi when concentrations are missing", () => {
    const enriched = enrichStation(
      {
        id: "cpcb-RKP-28.5600-77.1800",
        name: "RKP",
        cityId: "delhi",
        lat: 28.56,
        lng: 77.18,
        sourceFeed: "cpcb",
        lastSeen: "2026-10-11T10:00:00Z",
        pollutants: {},
        sourceAqi: 120,
        sourceDominant: "PM10",
      },
      "india",
      now,
    );
    assert.equal(enriched.online, true);
    assert.equal(enriched.aqi, 120);
    assert.equal(enriched.dominantPollutant, "PM10");
    assert.equal(enriched.band, "Moderate");
  });

  it("treats CPCB AQI as over-limit when concentrations are empty", () => {
    const standards = { pm25: 60, pm10: 100, no2: 80, so2: 80 };
    assert.equal(stationOverLimit({}, standards), false);
    assert.equal(stationOverLimit({}, standards, 120, "india"), false);
    assert.equal(stationOverLimit({}, standards, 210, "india"), true);
  });

  it("prefers a station with a parseable lastSeen over an empty stamp", () => {
    const merged = mergeStations(
      [
        {
          id: "a",
          name: "A",
          cityId: "delhi",
          lat: 28.61,
          lng: 77.21,
          sourceFeed: "cpcb",
          lastSeen: "",
          pollutants: {},
          sourceAqi: 90,
        },
        {
          id: "b",
          name: "B",
          cityId: "delhi",
          lat: 28.6101,
          lng: 77.2101,
          sourceFeed: "openaq",
          lastSeen: "2026-10-11T11:00:00Z",
          pollutants: { pm25: 55 },
        },
      ],
      "india",
      now,
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.sourceFeed, "openaq");
  });
});

describe("promotion", () => {
  const standards = { source: "x", pm25: 60, pm10: 100, no2: 80, so2: 80 };

  it("promotes on 3 distinct counting reports", () => {
    const d = decidePromotion({
      reports: [
        { countsTowardPromotion: true, reporterKey: "1" },
        { countsTowardPromotion: true, reporterKey: "2" },
        { countsTowardPromotion: true, reporterKey: "3" },
      ],
      sensorOverLimit: null,
      satelliteAnomaly: null,
      consecutiveSensorOverLimit: 0,
      sensorAqi: null,
      aqiScale: "india",
      standards,
    });
    assert.deepEqual(d, { promote: true, reason: "citizens" });
  });

  it("ignores flagged photos for citizen count", () => {
    const d = decidePromotion({
      reports: [
        { countsTowardPromotion: false, reporterKey: "1" },
        { countsTowardPromotion: false, reporterKey: "2" },
        { countsTowardPromotion: false, reporterKey: "3" },
      ],
      sensorOverLimit: null,
      satelliteAnomaly: null,
      consecutiveSensorOverLimit: 0,
      sensorAqi: null,
      aqiScale: "india",
      standards,
    });
    assert.equal(d.promote, false);
  });

  it("treats null satellite as absent", () => {
    const d = decidePromotion({
      reports: [{ countsTowardPromotion: true, reporterKey: "1" }],
      sensorOverLimit: false,
      satelliteAnomaly: null,
      consecutiveSensorOverLimit: 0,
      sensorAqi: 100,
      aqiScale: "india",
      standards,
    });
    assert.equal(d.promote, false);
  });

  it("promotes citizen+sensor", () => {
    const d = decidePromotion({
      reports: [{ countsTowardPromotion: true, reporterKey: "1" }],
      sensorOverLimit: true,
      satelliteAnomaly: null,
      consecutiveSensorOverLimit: 0,
      sensorAqi: 220,
      aqiScale: "india",
      standards,
    });
    assert.equal(d.reason, "citizen_sensor");
  });

  it("does not promote sensor-only on a single over-limit reading", () => {
    const d = decidePromotion({
      reports: [],
      sensorOverLimit: true,
      satelliteAnomaly: null,
      consecutiveSensorOverLimit: 1,
      sensorAqi: 120,
      aqiScale: "india",
      standards,
    });
    assert.equal(d.promote, false);
  });

  it("promotes sensor-only after two consecutive over-limit readings", () => {
    const d = decidePromotion({
      reports: [],
      sensorOverLimit: true,
      satelliteAnomaly: null,
      consecutiveSensorOverLimit: 2,
      sensorAqi: 120,
      aqiScale: "india",
      standards,
    });
    assert.equal(d.reason, "sensor_only");
  });

  it("uses the US unhealthy threshold for non-India immediate alerts", () => {
    const below = decidePromotion({
      reports: [],
      sensorOverLimit: true,
      satelliteAnomaly: null,
      consecutiveSensorOverLimit: 1,
      sensorAqi: 140,
      aqiScale: "us",
      standards,
    });
    const above = decidePromotion({
      reports: [],
      sensorOverLimit: true,
      satelliteAnomaly: null,
      consecutiveSensorOverLimit: 1,
      sensorAqi: 160,
      aqiScale: "us",
      standards,
    });
    assert.equal(below.promote, false);
    assert.equal(above.reason, "sensor_only");
  });

  it("idempotent dedupe key", () => {
    const day = utcDayKey(new Date("2026-10-11T15:00:00Z"));
    assert.equal(incidentDedupeKey("abc", "citizens", day), incidentDedupeKey("abc", "citizens", day));
  });
});

describe("fusion", () => {
  it("renormalizes when satellite is null", () => {
    const r = computeFusionConfidence({
      visualScore: 80,
      sensorScore: 60,
      satelliteScore: null,
      corroborationScore: null,
    });
    assert.ok(r.finalConfidence > 0);
    assert.equal(r.satelliteWeight, 0);
    assert.ok(Math.abs(r.visualWeight + r.sensorWeight - 1) < 1e-9);
  });
});

describe("ward burden", () => {
  it("marks uncovered beyond 15km and excludes from share", () => {
    const near = joinWardToStation(
      { id: "w1", name: "Near", population: 1000, centroid: { lat: 28.61, lng: 77.21 } },
      [{ id: "s1", lat: 28.612, lng: 77.212, aqi: 250, online: true }],
    );
    const far = joinWardToStation(
      { id: "w2", name: "Far", population: 5000, centroid: { lat: 29.5, lng: 78.5 } },
      [{ id: "s1", lat: 28.612, lng: 77.212, aqi: 250, online: true }],
    );
    assert.equal(near.covered, true);
    assert.equal(near.unhealthy, true);
    assert.equal(far.covered, false);

    const summary = summarizeWardBurden([near, far]);
    assert.equal(summary.peopleInPoor, 1000);
    assert.equal(summary.coveredPopulation, 1000);
    assert.equal(summary.uncoveredPopulation, 5000);
    assert.equal(summary.shareInPoor, 1);
  });
});

describe("alerts", () => {
  it("notifies on upward cross only", () => {
    assert.equal(
      shouldNotifyAlert({ previousAqi: 150, currentAqi: 210, lastNotifiedAt: null }).notify,
      true,
    );
    assert.equal(
      shouldNotifyAlert({ previousAqi: 210, currentAqi: 220, lastNotifiedAt: null }).reason,
      "flat_poor",
    );
  });

  it("debounces 6h", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    const d = shouldNotifyAlert({
      previousAqi: 100,
      currentAqi: 220,
      lastNotifiedAt: "2026-10-11T10:00:00Z",
      now,
    });
    assert.equal(d.reason, "debounced");
  });
});

describe("forecast", () => {
  it("refuses under 12 hours", () => {
    const f = persistenceForecast("s1", Array.from({ length: 5 }, (_, i) => ({
      observedAt: new Date(Date.UTC(2026, 9, 10, i)).toISOString(),
      pm25: 40,
    })));
    assert.equal("error" in f && f.error, "insufficient_history");
  });

  it("returns persistence hours", () => {
    const history = Array.from({ length: 24 }, (_, i) => ({
      observedAt: new Date(Date.UTC(2026, 9, 10, i)).toISOString(),
      pm25: 30 + i,
    }));
    const f = persistenceForecast("s1", history, new Date(Date.UTC(2026, 9, 11, 0)));
    assert.equal(f.method, "persistence");
    assert.equal(f.hours.length, 24);
  });
});

describe("closure", () => {
  it("opens window and accepts FIXED", () => {
    const c = openClosureWindow(new Date("2026-10-11T00:00:00Z"));
    const r = applyClosureAnswer({
      closure: c,
      answer: "FIXED",
      tokenValid: true,
      now: new Date("2026-10-11T01:00:00Z"),
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.event, "fix_confirmed");
  });

  it("STILL reopens as disputed", () => {
    const c = openClosureWindow(new Date("2026-10-11T00:00:00Z"));
    const r = applyClosureAnswer({
      closure: c,
      answer: "STILL",
      tokenValid: true,
      now: new Date("2026-10-11T01:00:00Z"),
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.incidentStatus, "disputed");
      assert.equal(r.event, "disputed");
    }
  });

  it("rejects token mismatch", () => {
    const c = openClosureWindow();
    const r = applyClosureAnswer({ closure: c, answer: "FIXED", tokenValid: false });
    assert.deepEqual(r, { ok: false, error: "token_mismatch" });
  });
});

describe("feeds", () => {
  it("parses WAQI bounds stations into PM estimates", () => {
    const rows = parseWaqiStations(
      { data: [{ uid: 1, aqi: "150", lat: 28.6, lon: 77.2, station: { name: "ITO" } }] },
      "delhi",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.sourceFeed, "waqi");
    assert.equal(rows[0]!.name, "ITO");
    assert.ok(rows[0]!.pollutants.pm25 != null);
  });

  it("parses OpenAQ sensors with embedded latest", () => {
    const { pollutants, lastSeen } = pollutantsFromOpenAqSensors([
      {
        id: 1,
        parameter: { name: "pm25" },
        latest: { value: 42, datetime: { utc: "2026-10-11T10:00:00Z" } },
      },
      {
        id: 2,
        parameter: { name: "pm10" },
        latest: { value: 80, datetime: { utc: "2026-10-11T09:00:00Z" } },
      },
    ]);
    assert.equal(pollutants.pm25, 42);
    assert.equal(pollutants.pm10, 80);
    assert.equal(lastSeen, "2026-10-11T10:00:00Z");
    assert.equal(openAqPollutantsUsable(pollutants), true);
  });

  it("parses OpenAQ latest rows with sensor parameter map", () => {
    const map = new Map<number, string>([[99, "pm25"]]);
    const { pollutants } = pollutantsFromOpenAqLatestRows(
      [{ sensorsId: 99, value: 55, datetime: { utc: "2026-10-11T11:00:00Z" } }],
      map,
    );
    assert.equal(pollutants.pm25, 55);
  });

  it("parses CPCB records", () => {
    const rows = parseCpcbRecords(
      {
        records: [
          {
            station: "RKP",
            latitude: "28.56",
            longitude: "77.18",
            pollutant_id: "PM2.5",
            pollutant_avg: "90",
            last_update: "11-10-2026 10:00:00",
          },
          {
            station: "RKP",
            latitude: "28.56",
            longitude: "77.18",
            pollutant_id: "PM10",
            pollutant_avg: "120",
            last_update: "11-10-2026 10:00:00",
          },
        ],
      },
      "delhi",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.sourceFeed, "cpcb");
    assert.equal(rows[0]!.sourceAqi, 120);
    assert.equal(rows[0]!.sourceDominant, "PM10");
    assert.equal(rows[0]!.lastSeen, "2026-10-11T04:30:00.000Z");
    assert.equal(rows[0]!.id, "cpcb-RKP-28.5600-77.1800");
  });

  it("keeps CPCB stations with the same name at different coordinates", () => {
    const rows = parseCpcbRecords(
      {
        records: [
          { station: "Secretariat", latitude: "28.61", longitude: "77.20", pollutant_avg: "80", last_update: "11-10-2026 10:00:00" },
          { station: "Secretariat", latitude: "28.70", longitude: "77.30", pollutant_avg: "90", last_update: "11-10-2026 10:00:00" },
        ],
      },
      "delhi",
    );
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0]!.id, rows[1]!.id);
  });

  it("parses CPCB last_update and rejects empty stamps", () => {
    assert.equal(parseCpcbLastUpdate("11-10-2026 10:00:00"), "2026-10-11T04:30:00.000Z");
    assert.equal(parseCpcbLastUpdate(""), null);
    assert.equal(parseCpcbLastUpdate("NA"), null);
  });

  it("parses CPCB records with data.gov avg_value fields", () => {
    const rows = parseCpcbRecords(
      {
        records: [
          {
            station: "Kompally",
            latitude: "17.54",
            longitude: "78.48",
            pollutant_id: "PM2.5",
            avg_value: "34",
            last_update: "24-10-2026 15:00:00",
          },
          {
            station: "Kompally",
            latitude: "17.54",
            longitude: "78.48",
            pollutant_id: "NO2",
            avg_value: "12",
            last_update: "24-10-2026 15:00:00",
          },
        ],
      },
      "hyderabad",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.sourceAqi, 34);
    assert.equal(rows[0]!.sourceDominant, "PM2.5");
    assert.equal(rows[0]!.lastSeen, "2026-10-24T09:30:00.000Z");
  });
});

describe("twilio", () => {
  it("rejects a bad signature", () => {
    const params = { Body: "FIXED", From: "whatsapp:+100" };
    const good = twilioSignature("https://example.com/api/v1/whatsapp/inbound", params, "token");
    assert.equal(verifyTwilioSignature("https://example.com/api/v1/whatsapp/inbound", params, "token", good), true);
    assert.equal(verifyTwilioSignature("https://example.com/api/v1/whatsapp/inbound", params, "token", "nope"), false);
    assert.equal(verifyTwilioSignature("https://example.com/api/v1/whatsapp/inbound", params, "token", undefined), false);
  });
});

describe("upwind and gaps", () => {
  it("ranks a source upwind above one downwind", () => {
    const ranked = rankUpwind(
      { lat: 28.6, lng: 77.2 },
      180,
      [
        { id: "n", name: "north", kind: "industrial", lat: 28.7, lng: 77.2 },
        { id: "s", name: "south", kind: "landfill", lat: 28.5, lng: 77.2 },
      ],
    );
    assert.ok(ranked.length >= 1);
    assert.equal(ranked[0]!.id, "s");
  });

  it("marks a missed diary tick as a gap", () => {
    const gaps = exposureGaps([
      { observedAt: "2026-10-11T00:00:00Z", aqi: 100, band: "Satisfactory" },
      { observedAt: "2026-10-11T03:00:00Z", aqi: 210, band: "Poor" },
    ]);
    assert.equal(gaps.length, 1);
  });
});

describe("h3 and cities", () => {
  it("maps lat/lng to res 8", () => {
    const h = latLngToH3({ lat: 28.6139, lng: 77.209 });
    assert.equal(h.length, 15);
  });

  it("includes the twelve-city set", () => {
    assert.ok(getCity("delhi"));
    assert.ok(getCity("beijing"));
    assert.equal(CITIES.length, 12);
  });
});

describe("citizen and satellite promotion", () => {
  const standards = { source: "x", pm25: 60, pm10: 100, no2: 80, so2: 80 };
  const reports = [{ countsTowardPromotion: true, reporterKey: "citizen-1" }];

  it("promotes citizen+satellite only when satelliteAnomaly is true", () => {
    const input = {
      reports,
      sensorOverLimit: false as boolean | null,
      consecutiveSensorOverLimit: 0,
      sensorAqi: 100,
      aqiScale: "india" as const,
      standards,
    };
    assert.deepEqual(decidePromotion({ ...input, satelliteAnomaly: true }), {
      promote: true,
      reason: "citizen_satellite",
    });
    assert.deepEqual(decidePromotion({ ...input, satelliteAnomaly: false }), { promote: false, reason: null });
    assert.deepEqual(decidePromotion({ ...input, satelliteAnomaly: null }), { promote: false, reason: null });
  });
});
