import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  indiaAqiFromReadings,
  usAqiFromReadings,
  aqiBand,
  mergeStations,
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
