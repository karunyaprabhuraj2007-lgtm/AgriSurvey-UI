/**
 * AgriSurvey AI — Earth Search STAC Satellite API Service
 * 
 * Interacts with AWS Earth Search STAC API v1 (https://earth-search.aws.element84.com/v1)
 * to search, query, and retrieve real Sentinel-2 Level-2A scenes over Maharashtra farm plots.
 * 
 * Supports:
 * - Real STAC /search POST queries with collections, bbox, datetime, and cloud_cover filters.
 * - Intersection validation between Sentinel-2 footprint and plot geometry.
 * - Discovery of spectral assets: B02 (10m Blue), B03 (10m Green), B04 (10m Red),
 *   B08 (10m NIR), B11 (20m SWIR-1), B12 (20m SWIR-2), SCL (Scene Classification Layer),
 *   TCI (Visual), and thumbnail previews.
 */

import { mockDb } from './mock-db';
import { SatelliteScene, SatelliteSceneAsset, FarmPlot } from '@/types';
import { BoundingBox, computeGeodesicMeasurements, doBBoxesIntersect, isPointInPolygon } from '@/lib/geospatial';
import { aoiAroundPoint } from '@/lib/sentinel-cog';

function pointBbox(lat: number, lon: number, radiusKm: number): BoundingBox {
  const aoi = aoiAroundPoint(lat, lon, radiusKm);
  return {
    minLon: Number(aoi.minLon.toFixed(5)),
    minLat: Number(aoi.minLat.toFixed(5)),
    maxLon: Number(aoi.maxLon.toFixed(5)),
    maxLat: Number(aoi.maxLat.toFixed(5)),
  };
}

const STAC_API_ENDPOINT = 'https://earth-search.aws.element84.com/v1/search';
// Order = preference when the same acquisition is listed in both collections
const STAC_COLLECTIONS = ['sentinel-2-l2a', 'sentinel-2-c1-l2a'];

export interface StacSearchParams {
  plotId?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  point?: { lat: number; lon: number; radiusKm?: number };
  bbox?: BoundingBox;
  coordinates?: [number, number][]; // [lat, lon][]
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  maxCloudCover?: number; // 0 - 100
  limit?: number;
}

export interface StacSearchResult {
  scenes: SatelliteScene[];
  totalFound: number;
  collection: string;
  queryBbox: BoundingBox;
  searchedAt: string;
  dataSource: 'LIVE_STAC_API' | 'LOCAL_INDEX';
}

export class StacSatelliteService {
  /**
   * Search for genuine Sentinel-2 Level-2A scenes intersecting a plot or bounding box
   */
  async searchScenes(params: StacSearchParams): Promise<StacSearchResult> {
    let bbox: BoundingBox;
    let targetPlot: FarmPlot | undefined;
    // For coordinate searches, only return tiles whose footprint covers the point itself
    let searchPoint: { lat: number; lon: number } | undefined;

    if (params.plotId) {
      targetPlot = mockDb.farmPlots.find((p) => p.id === params.plotId);
      if (!targetPlot) throw new Error(`Farm plot not found for ID: ${params.plotId}`);
      const measurements = computeGeodesicMeasurements(targetPlot.boundary_coordinates);
      bbox = measurements.bbox;
    } else if (params.latitude !== undefined && params.longitude !== undefined) {
      const radius = params.radiusKm && params.radiusKm > 0 ? params.radiusKm : 1.5;
      bbox = pointBbox(params.latitude, params.longitude, radius);
      searchPoint = { lat: params.latitude, lon: params.longitude };
    } else if (params.point) {
      const radius = params.point.radiusKm && params.point.radiusKm > 0 ? params.point.radiusKm : 1.5;
      bbox = pointBbox(params.point.lat, params.point.lon, radius);
      searchPoint = { lat: params.point.lat, lon: params.point.lon };
    } else if (params.coordinates && params.coordinates.length >= 3) {
      const measurements = computeGeodesicMeasurements(params.coordinates);
      bbox = measurements.bbox;
    } else if (params.bbox) {
      bbox = params.bbox;
    } else {
      // Default to Pune Maharashtra bounding area
      bbox = { minLon: 73.8, minLat: 18.45, maxLon: 74.1, maxLat: 18.65 };
    }

    const maxCloud = params.maxCloudCover !== undefined ? params.maxCloudCover : 30;
    const limit = params.limit || 8;

    // Date range formatting (default to last 6 months)
    const now = new Date();
    const endStr = params.endDate || now.toISOString().split('T')[0];
    const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 3600 * 1000);
    const startStr = params.startDate || sixMonthsAgo.toISOString().split('T')[0];
    const datetimeStr = `${startStr}T00:00:00Z/${endStr}T23:59:59Z`;

    // Construct STAC Search Payload (newest first; over-fetch because the same
    // acquisition can appear in both collections and is de-duplicated below)
    const stacPayload: Record<string, unknown> = {
      collections: STAC_COLLECTIONS,
      datetime: datetimeStr,
      limit: limit * STAC_COLLECTIONS.length,
      sortby: [{ field: 'properties.datetime', direction: 'desc' }],
      query: {
        'eo:cloud_cover': {
          lt: maxCloud,
        },
      },
    };
    if (searchPoint) {
      stacPayload.intersects = { type: 'Point', coordinates: [searchPoint.lon, searchPoint.lat] };
    } else {
      stacPayload.bbox = [
        Number(bbox.minLon.toFixed(5)),
        Number(bbox.minLat.toFixed(5)),
        Number(bbox.maxLon.toFixed(5)),
        Number(bbox.maxLat.toFixed(5)),
      ];
    }

    try {
      const response = await fetch(STAC_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/geo+json',
        },
        body: JSON.stringify(stacPayload),
      });

      if (!response.ok) {
        throw new Error(`Earth Search STAC HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const features: any[] = data.features || [];

      const allScenes: SatelliteScene[] = features.map((feat: any) => {
        const props = feat.properties || {};
        const assets = feat.assets || {};

        // Parse footprint coordinates from GeoJSON Polygon [lon, lat] -> [lat, lon]
        let footprintCoords: [number, number][] = [];
        const ring = feat.geometry?.type === 'MultiPolygon' ? feat.geometry.coordinates?.[0]?.[0] : feat.geometry?.coordinates?.[0];
        if (Array.isArray(ring)) {
          footprintCoords = ring.map(([lon, lat]: [number, number]) => [lat, lon]);
        }

        // Extract spectral band assets. Prefer the HTTPS Cloud-Optimized GeoTIFFs: the
        // "-jp2" variants point at requester-pays s3:// JPEG2000 files browsers cannot read.
        const band = (key: string, title: string, gsd: number): SatelliteSceneAsset | undefined => {
          const cog = assets[key];
          const jp2 = assets[`${key}-jp2`];
          const chosen = cog?.href?.startsWith('http') ? cog : jp2?.href?.startsWith('http') ? jp2 : cog || jp2;
          if (!chosen?.href) return undefined;
          const rb = chosen['raster:bands']?.[0];
          return {
            href: chosen.href,
            title,
            gsd,
            type: chosen.type,
            scale: typeof rb?.scale === 'number' ? rb.scale : undefined,
            offset: typeof rb?.offset === 'number' ? rb.offset : undefined,
          };
        };
        const assetMap: SatelliteScene['assets'] = {
          thumbnail: assets.thumbnail ? { href: assets.thumbnail.href, title: 'Scene Thumbnail (full tile)' } : undefined,
          visual: band('visual', 'True Color (TCI)', 10),
          blue: band('blue', 'B02 (Blue 10m)', 10),
          green: band('green', 'B03 (Green 10m)', 10),
          red: band('red', 'B04 (Red 10m)', 10),
          nir: band('nir', 'B08 (NIR 10m)', 10),
          swir16: band('swir16', 'B11 (SWIR 1.6μm 20m)', 20),
          swir22: band('swir22', 'B12 (SWIR 2.2μm 20m)', 20),
          scl: band('scl', 'Scene Classification Layer (SCL 20m)', 20),
        };

        const projCode = props['proj:epsg'] ?? props['proj:code'];
        const projEpsg = typeof projCode === 'number' ? projCode : parseInt(String(projCode ?? '').replace(/^EPSG:/i, ''), 10);

        const sceneObj: SatelliteScene = {
          id: `sc-${feat.id || Date.now()}`,
          scene_id: feat.id,
          collection: feat.collection || 'sentinel-2-l2a',
          acquisition_datetime: props.datetime || props['s2:generation_time'] || new Date().toISOString(),
          cloud_cover_percentage: Math.round((props['eo:cloud_cover'] ?? 0) * 10) / 10,
          footprint_coordinates: footprintCoords,
          thumbnail_url: assets.thumbnail?.href || assets.preview?.href,
          visual_url: assetMap.visual?.href,
          assets: assetMap,
          intersects_plot: true,
          proj_epsg: Number.isFinite(projEpsg) ? projEpsg : undefined,
          processing_baseline: props['s2:processing_baseline'],
          boa_offset_applied: props['earthsearch:boa_offset_applied'],
          mgrs_tile: props['grid:code']?.replace(/^MGRS-/, '') || props['s2:mgrs_tile'],
          created_at: new Date().toISOString(),
        };

        return sceneObj;
      });

      // The same acquisition (tile + time) can be listed in both collections; keep the
      // first one in STAC_COLLECTIONS order, then restore newest-first ordering.
      const byAcquisition = new Map<string, SatelliteScene>();
      for (const sc of allScenes) {
        const key = `${sc.mgrs_tile || sc.scene_id}|${sc.acquisition_datetime.slice(0, 16)}`;
        const existing = byAcquisition.get(key);
        if (!existing || STAC_COLLECTIONS.indexOf(sc.collection) < STAC_COLLECTIONS.indexOf(existing.collection)) {
          byAcquisition.set(key, sc);
        }
      }
      const parsedScenes = [...byAcquisition.values()]
        .sort((a, b) => b.acquisition_datetime.localeCompare(a.acquisition_datetime))
        .slice(0, limit);

      // Cache newly discovered scenes in mockDb
      for (const sc of parsedScenes) {
        if (!mockDb.satelliteScenes.some((s) => s.scene_id === sc.scene_id)) {
          mockDb.satelliteScenes.unshift(sc);
        }
      }
      mockDb.persistAll();

      return {
        scenes: parsedScenes,
        totalFound: parsedScenes.length,
        collection: 'sentinel-2-l2a',
        queryBbox: bbox,
        searchedAt: new Date().toISOString(),
        dataSource: 'LIVE_STAC_API',
      };
    } catch (err) {
      console.warn('Live STAC API fetch error, falling back to cached catalog:', err);

      // Gracefully fall back to local cached satellite scenes for offline runtime
      // Only reuse cached scenes that actually cover the requested location and dates
      const localMatches = mockDb.satelliteScenes
        .filter((s) => {
          if (s.cloud_cover_percentage > maxCloud) return false;
          const day = s.acquisition_datetime.slice(0, 10);
          if (day < startStr || day > endStr) return false;
          if (s.footprint_coordinates.length < 3) return false;
          if (searchPoint) return isPointInPolygon([searchPoint.lat, searchPoint.lon], s.footprint_coordinates);
          return doBBoxesIntersect(bbox, computeGeodesicMeasurements(s.footprint_coordinates).bbox);
        })
        .sort((a, b) => b.acquisition_datetime.localeCompare(a.acquisition_datetime));

      return {
        scenes: localMatches.slice(0, limit),
        totalFound: localMatches.length,
        collection: 'sentinel-2-l2a (Cached)',
        queryBbox: bbox,
        searchedAt: new Date().toISOString(),
        dataSource: 'LOCAL_INDEX',
      };
    }
  }

  /**
   * Get specific satellite scene by its scene_id
   */
  async getSceneById(sceneId: string): Promise<SatelliteScene | null> {
    const scene = mockDb.satelliteScenes.find((s) => s.scene_id === sceneId || s.id === sceneId);
    return scene || null;
  }
}

export const stacSatelliteService = new StacSatelliteService();
export const stacService = stacSatelliteService;
