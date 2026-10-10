import {
  decidePromotion,
  computeFusionConfidence,
  corroborationScore,
  sensorScoreFromExceedance,
  incidentDedupeKey,
  utcDayKey,
  getCity,
  stationOverLimit,
  haversineKm,
  openClosureWindow,
} from "@zephyr/domain";
import { FileStore, newId, sha256 } from "./store.js";
import { classifyPhoto } from "./gemini.js";

export async function processReportMessage(store: FileStore, reportId: string) {
  const db = await store.read();
  const report = db.reports[reportId];
  if (!report) throw new Error(`unknown report ${reportId}`);

  const city = getCity(report.cityId);
  if (!city) throw new Error(`unknown city ${report.cityId}`);

  let classification: Awaited<ReturnType<typeof classifyPhoto>> | null = null;
  let visualScore: number | null = null;
  let authenticity = { ok: true, reasons: [] as string[] };

  if (report.photoPath && (await store.photoExists(reportId))) {
    const bytes = await store.readPhoto(reportId);
    const hash = sha256(bytes);
    report.photoSha256 = hash;
    const dup = Object.values(db.reports).find(
      (r) => r.id !== reportId && r.photoSha256 === hash && Date.parse(r.createdAt) > Date.now() - 7 * 86400_000,
    );
    if (dup) {
      authenticity = { ok: false, reasons: ["duplicate_photo"] };
    }
    classification = await classifyPhoto(bytes, report.hazardType);
    if (classification.authenticityFlags.length) {
      authenticity = {
        ok: false,
        reasons: [...authenticity.reasons, ...classification.authenticityFlags],
      };
    }
    visualScore = authenticity.ok ? Math.round(classification.confidence * 100) : null;
  }

  report.classification = classification;
  report.authenticity = authenticity;
  report.countsTowardPromotion = authenticity.ok;
  report.status = "classified";

  const nearbyReports = Object.values(db.reports).filter(
    (r) =>
      r.h3 === report.h3 &&
      r.cityId === report.cityId &&
      Date.parse(r.createdAt) > Date.now() - 24 * 3600_000,
  );

  const stations = Object.values(db.stations).filter((s) => s.cityId === report.cityId && s.online);
  let nearest = null as (typeof stations)[number] | null;
  let nearestKm = Infinity;
  for (const s of stations) {
    const km = haversineKm({ lat: report.lat, lng: report.lng }, { lat: s.lat, lng: s.lng });
    if (km < nearestKm) {
      nearestKm = km;
      nearest = s;
    }
  }

  const sensorOverLimit =
    nearest && nearestKm <= 3 ? stationOverLimit(nearest.pollutants, city.standards) : null;
  let sensorScore: number | null = null;
  if (nearest?.aqi != null && sensorOverLimit) {
    const pct = nearest.pollutants.pm25 != null ? ((nearest.pollutants.pm25 - city.standards.pm25) / city.standards.pm25) * 100 : 50;
    sensorScore = sensorScoreFromExceedance(pct);
  }

  const counting = nearbyReports.filter((r) => r.countsTowardPromotion);
  const fusion = computeFusionConfidence({
    visualScore,
    sensorScore,
    satelliteScore: null,
    corroborationScore: corroborationScore(new Set(counting.map((r) => r.reporterKey)).size),
  });

  const decision = decidePromotion({
    reports: nearbyReports.map((r) => ({
      countsTowardPromotion: r.countsTowardPromotion,
      reporterKey: r.reporterKey,
    })),
    sensorOverLimit,
    satelliteAnomaly: null,
    consecutiveSensorOverLimit: 0,
    sensorAqi: nearest?.aqi ?? null,
    aqiScale: city.aqiScale,
    standards: city.standards,
  });

  if (decision.promote && decision.reason) {
    const dedupeKey = incidentDedupeKey(report.h3, decision.reason, utcDayKey());
    let incident = Object.values(db.incidents).find((i) => i.dedupeKey === dedupeKey);
    if (!incident) {
      const id = newId();
      incident = {
        id,
        cityId: report.cityId,
        h3: report.h3,
        status: "open",
        reason: decision.reason,
        openedAt: new Date().toISOString(),
        reportIds: [report.id],
        stationId: nearest?.id ?? null,
        fusion,
        assignee: null,
        workOrder: {
          priority: "within_24h",
          summaryEn: `Investigate ${report.hazardType} hotspot in ${city.name}`,
          summaryLocal: city.localLanguage
            ? `Investigate ${report.hazardType} hotspot (${city.localLanguage.name})`
            : null,
          agency: "Municipal field team",
        },
        resolvedAt: null,
        closure: null,
        dedupeKey,
        priority: "within_24h",
      };
      db.incidents[id] = incident;
      db.incidentEvents.push({
        id: newId(),
        incidentId: id,
        type: "promoted",
        at: new Date().toISOString(),
        actor: "system",
        h3: report.h3,
      });
    } else if (!incident.reportIds.includes(report.id)) {
      incident.reportIds.push(report.id);
      incident.fusion = fusion;
    }
    report.incidentId = incident.id;
    report.status = "promoted";
  }

  await store.write(db);
  return { report, decision, fusion };
}

export async function resolveIncident(
  store: FileStore,
  incidentId: string,
  actor: string,
  action: "dispatch" | "resolve" | "false_positive",
) {
  return store.update((db) => {
    const incident = db.incidents[incidentId];
    if (!incident) throw new Error("incident not found");
    if (action === "dispatch") {
      incident.status = "dispatched";
      incident.assignee = actor;
      db.incidentEvents.push({
        id: newId(),
        incidentId,
        type: "dispatched",
        at: new Date().toISOString(),
        actor,
        h3: incident.h3,
      });
    } else if (action === "false_positive") {
      incident.status = "false_positive";
      incident.resolvedAt = new Date().toISOString();
      incident.assignee = actor;
      db.incidentEvents.push({
        id: newId(),
        incidentId,
        type: "resolved",
        at: new Date().toISOString(),
        actor,
        h3: incident.h3,
      });
    } else {
      incident.status = "resolved";
      incident.resolvedAt = new Date().toISOString();
      incident.assignee = actor;
      incident.closure = openClosureWindow();
      db.incidentEvents.push({
        id: newId(),
        incidentId,
        type: "resolved",
        at: new Date().toISOString(),
        actor,
        h3: incident.h3,
      });
      for (const rid of incident.reportIds) {
        const report = db.reports[rid];
        if (report) report.status = "resolved";
      }
    }
  });
}
