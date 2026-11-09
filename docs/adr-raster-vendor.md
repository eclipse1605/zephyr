# ADR: model air-quality raster

## Decision

The map stays MapLibre on OpenFreeMap. Zephyr does not draw a Google Air Quality heatmap on that map.

For the twelve-city dashboard, the model is a point lookup only. `fetchModelledPm25` may call the Google Air Quality history API when `GOOGLE_AIR_QUALITY_API_KEY` is set. Those values are context for a station or hex. They are not the published Zephyr number, and they are not tiles.

A later worldwide raster, if built, uses the Open-Meteo air-quality API (CAMS) on this same MapLibre map. IQAir's public map is the visual reference for that layer. IQAir is not the data vendor.

## Why

Google's Air Quality policies say map results must be shown on a Google map, and current or hourly values may be cached for one hour and then deleted. Serving those tiles from Zephyr's cache or drawing them on OpenFreeMap breaks that rule.

Open-Meteo's hosted air-quality API is non-commercial unless self-hosted or paid. It exposes PM2.5, PM10, NO2, ozone, SO2, and CO. A click reads a point. A raster is a grid Zephyr interpolates. No API key is required for the hosted non-commercial path.

## Cache and attribution

Google point lookups are not stored as a CDN. A repeat call inside one hour may be cached in memory, then dropped.

Open-Meteo responses used for a future raster may be cached. The map credits Open-Meteo and CAMS on that layer.

The UI does not say "Source: Includes air quality data from Google" unless a Google point value is actually shown. Public terms and a privacy page are still required before that value is shown to residents.

## Keys

`.env.example` keeps `GOOGLE_AIR_QUALITY_API_KEY` for the point lookup. It does not add a Google Maps heatmap key or an IQAir key. Open-Meteo wind and the future air-quality raster do not use a key.
