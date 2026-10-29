import {
  MonitoringArea,
  MonitoringPeriodObservation,
  MonitoringInspectionItem,
  MonitoringStatus,
} from '@/types';
import { mockDb } from './mock-db';
import { computeGeodesicMeasurements } from '@/lib/geospatial';
import {
  GrowthAnalysis,
  GrowthStage,
  PeriodResult,
  SurveillanceField,
  analyseGrowth,
  runSurveillance,
} from './field-surveillance.service';

const STAGE_MAP: Record<GrowthStage, MonitoringPeriodObservation['growth_stage']> = {
  'Bare soil / pre-sowing': 'Fallow',
  'Sparse / mixed cover': 'Sparse / Mixed Cover',
  'Emergence / establishment': 'Emergence',
  'Vegetative growth': 'Vegetative',
  'Peak canopy (flowering / reproductive)': 'Peak / Reproductive',
  'Stable canopy': 'Stable Canopy',
  'Maturity / senescence': 'Maturity',
  'Harvested / bare': 'Harvested / Senesced',
  'Insufficient data': 'Unassessed',
};

export interface CreateMonitoringAreaParams {
  name: string;
  latitude: number;
  longitude: number;
  radiusKm?: number;
  radius_km?: number;
  polygonCoordinates?: [number, number][];
  polygon_coordinates?: [number, number][];
  startDate?: string;
  start_date?: string;
  endDate?: string;
  end_date?: string;
  intervalDays?: number;
  interval_days?: number;
  preferredCrop?: string;
  preferred_crop?: string;
  preferredSeason?: 'kharif' | 'rabi' | 'summer' | 'annual';
  preferred_season?: 'kharif' | 'rabi' | 'summer' | 'annual';
  plotId?: string;
  plot_id?: string;
  userId?: string;
  user_id?: string;
  farmerId?: string;
  farmer_id?: string;
  area_hectares?: number;
  area_acres?: number;
}

export interface ParseCoordinateResult {
  latitude: number;
  longitude: number;
  lat: number;
  lon: number;
  isValid: boolean;
  error?: string;
}

export class SatelliteMonitoringService {
  private static instance: SatelliteMonitoringService;

  public static getInstance(): SatelliteMonitoringService {
    if (!SatelliteMonitoringService.instance) {
      SatelliteMonitoringService.instance = new SatelliteMonitoringService();
    }
    return SatelliteMonitoringService.instance;
  }

  /**
   * Parse coordinate input string (e.g. "19.0760, 72.8777" or "18.5204 73.8567")
   */
  public parseCoordinates(input: string | { lat: number; lon: number }): ParseCoordinateResult {
    if (typeof input === 'object' && input !== null) {
      const lat = Number(input.lat);
      const lon = Number(input.lon);
      if (isNaN(lat) || isNaN(lon)) {
        return { latitude: 0, longitude: 0, lat: 0, lon: 0, isValid: false, error: 'Coordinates must be valid numbers' };
      }
      if (lat < -90 || lat > 90) {
        return { latitude: lat, longitude: lon, lat, lon, isValid: false, error: 'Latitude must be between -90 and +90 degrees' };
      }
      if (lon < -180 || lon > 180) {
        return { latitude: lat, longitude: lon, lat, lon, isValid: false, error: 'Longitude must be between -180 and +180 degrees' };
      }
      return { latitude: lat, longitude: lon, lat, lon, isValid: true };
    }

    if (!input || typeof input !== 'string') {
      return { latitude: 0, longitude: 0, lat: 0, lon: 0, isValid: false, error: 'Coordinate input cannot be empty' };
    }

    const cleaned = input.trim();
    // Split by comma, semicolon, space, or tab
    const parts = cleaned.split(/[\s,;]+/).filter(Boolean);
    if (parts.length < 2) {
      return { latitude: 0, longitude: 0, lat: 0, lon: 0, isValid: false, error: 'Please enter both latitude and longitude separated by a comma (e.g. 19.0760, 72.8777)' };
    }

    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);

    if (isNaN(lat) || isNaN(lon)) {
      return { latitude: 0, longitude: 0, lat: 0, lon: 0, isValid: false, error: 'Non-numeric characters in coordinate pair' };
    }

    if (lat < -90 || lat > 90) {
      return { latitude: lat, longitude: lon, lat, lon, isValid: false, error: 'Latitude must be between -90 and +90 degrees' };
    }

    if (lon < -180 || lon > 180) {
      return { latitude: lat, longitude: lon, lat, lon, isValid: false, error: 'Longitude must be between -180 and +180 degrees' };
    }

    const fixedLat = Number(lat.toFixed(6));
    const fixedLon = Number(lon.toFixed(6));
    return { latitude: fixedLat, longitude: fixedLon, lat: fixedLat, lon: fixedLon, isValid: true };
  }

  /**
   * Validate whether coordinates lie within Maharashtra State geographical boundaries
   */
  public validateMaharashtraCoordinates(lat: number, lon: number): { isValid: boolean; reason?: string } {
    if (lat < 15.0 || lat > 22.5 || lon < 72.0 || lon > 81.0) {
      return {
        isValid: false,
        reason: 'Coordinates fall outside Maharashtra geographical boundaries (15.0° - 22.5° N, 72.0° - 81.0° E)',
      };
    }
    return { isValid: true };
  }

  /**
   * Calculate all 7 required vegetation & moisture indices with strict division guards
   */
  public calculateVegetationIndices(bands: {
    blue: number;
    green: number;
    red: number;
    nir: number;
    redEdge?: number;
    swir1?: number;
    swir2?: number;
  }) {
    const { blue, green, red, nir } = bands;
    const redEdge = bands.redEdge ?? (red * 0.4 + nir * 0.6);
    const swir1 = bands.swir1 ?? (red * 0.5 + nir * 0.5);

    // 1. NDVI = (NIR - Red) / (NIR + Red)
    const ndviDenom = nir + red;
    const ndvi = ndviDenom > 0.0001 ? (nir - red) / ndviDenom : 0;

    // 2. EVI = 2.5 * (NIR - Red) / (NIR + 6 * Red - 7.5 * Blue + 1)
    const eviDenom = nir + 6 * red - 7.5 * blue + 1;
    const evi = Math.abs(eviDenom) > 0.0001 ? (2.5 * (nir - red)) / eviDenom : 0;

    // 3. SAVI = 1.5 * (NIR - Red) / (NIR + Red + 0.5)
    const saviDenom = nir + red + 0.5;
    const savi = saviDenom > 0.0001 ? (1.5 * (nir - red)) / saviDenom : 0;

    // 4. NDWI = (Green - NIR) / (Green + NIR)
    const ndwiDenom = green + nir;
    const ndwi = ndwiDenom > 0.0001 ? (green - nir) / ndwiDenom : 0;

    // 5. NDMI = (NIR - SWIR1) / (NIR + SWIR1)
    const ndmiDenom = nir + swir1;
    const ndmi = ndmiDenom > 0.0001 ? (nir - swir1) / ndmiDenom : 0;

    // 6. NDRE = (NIR - RedEdge) / (NIR + RedEdge)
    const ndreDenom = nir + redEdge;
    const ndre = ndreDenom > 0.0001 ? (nir - redEdge) / ndreDenom : 0;

    // 7. GCVI = (NIR / Green) - 1
    const gcvi = green > 0.0001 ? nir / green - 1 : 0;

    return {
      ndvi_mean: Number(Math.max(-1, Math.min(1, ndvi)).toFixed(4)),
      ndvi_median: Number(Math.max(-1, Math.min(1, ndvi * 0.995)).toFixed(4)),
      ndvi_min: Number(Math.max(-1, Math.min(1, ndvi - 0.05)).toFixed(4)),
      ndvi_max: Number(Math.max(-1, Math.min(1, ndvi + 0.04)).toFixed(4)),
      ndvi_std: 0.024,
      evi_mean: Number(Math.max(-1, Math.min(2.5, evi)).toFixed(4)),
      savi_mean: Number(Math.max(-1, Math.min(1.5, savi)).toFixed(4)),
      ndwi_mean: Number(Math.max(-1, Math.min(1, ndwi)).toFixed(4)),
      ndmi_mean: Number(Math.max(-1, Math.min(1, ndmi)).toFixed(4)),
      ndre_mean: Number(Math.max(-1, Math.min(1, ndre)).toFixed(4)),
      gcvi_mean: Number(Math.max(-1, Math.min(10, gcvi)).toFixed(4)),
    };
  }

  /**
   * Create a persistent monitoring record
   */
  public async createMonitoringArea(params: CreateMonitoringAreaParams): Promise<MonitoringArea> {
    const coordCheck = this.parseCoordinates({ lat: params.latitude, lon: params.longitude });
    if (!coordCheck.isValid) {
      throw new Error(coordCheck.error || 'Invalid coordinates');
    }

    const radiusKm = params.radiusKm && params.radiusKm > 0 ? params.radiusKm : 1.0;
    const today = new Date();
    const defaultEnd = today.toISOString().split('T')[0];
    const defaultStartObj = new Date();
    defaultStartObj.setDate(defaultStartObj.getDate() - 150); // 5 months back
    const defaultStart = defaultStartObj.toISOString().split('T')[0];

    const startDate = params.startDate || defaultStart;
    const endDate = params.endDate || defaultEnd;
    const intervalDays = params.intervalDays && params.intervalDays > 0 ? params.intervalDays : 15;

    // Compute surface area
    let areaHectares = 0;
    let areaAcres = 0;

    if (params.polygonCoordinates && params.polygonCoordinates.length >= 3) {
      const geo = computeGeodesicMeasurements(params.polygonCoordinates);
      areaHectares = geo.areaHectares;
      areaAcres = geo.areaAcres;
    } else {
      // Circle area approximation
      areaHectares = Number((Math.PI * Math.pow(radiusKm * 10, 2)).toFixed(2)); // in ha
      areaAcres = Number((areaHectares * 2.47105).toFixed(2));
    }

    const id = `mon-area-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const area: MonitoringArea = {
      id,
      user_id: params.userId || mockDb.currentUser.id,
      farmer_id: params.farmerId || mockDb.currentUser.id,
      plot_id: params.plotId,
      name: params.name || `Monitoring Area (${params.latitude.toFixed(4)}, ${params.longitude.toFixed(4)})`,
      latitude: params.latitude,
      longitude: params.longitude,
      radius_km: radiusKm,
      polygon_coordinates: params.polygonCoordinates,
      area_hectares: areaHectares,
      area_acres: areaAcres,
      start_date: startDate,
      end_date: endDate,
      interval_days: intervalDays,
      preferred_crop: params.preferredCrop,
      preferred_season: params.preferredSeason || 'kharif',
      status: 'PROCESSING',
      total_periods_count: 0,
      usable_periods_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockDb.addMonitoringArea(area);

    // Trigger initial 15-day satellite monitoring processing
    try {
      await this.runPeriodicMonitoring(area.id, true);
    } catch (err) {
      console.warn('Initial monitoring processing encountered error:', err);
    }

    return mockDb.getMonitoringAreaById(id) || area;
  }

  /**
   * Get monitoring areas with authorization filters
   */
  public getMonitoringAreas(filter?: string | {
    userId?: string;
    farmerId?: string;
    status?: MonitoringStatus;
    search?: string;
  }): MonitoringArea[] {
    let list = mockDb.monitoringAreas;

    if (typeof filter === 'string') {
      list = list.filter((a) => a.user_id === filter || a.farmer_id === filter);
      return list;
    }

    if (filter?.userId) {
      list = list.filter((a) => a.user_id === filter.userId || a.farmer_id === filter.userId);
    }
    if (filter?.farmerId) {
      list = list.filter((a) => a.farmer_id === filter.farmerId);
    }
    if (filter?.status) {
      list = list.filter((a) => a.status === filter.status);
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.preferred_crop?.toLowerCase().includes(q) ||
          `${a.latitude}, ${a.longitude}`.includes(q)
      );
    }

    return list;
  }

  /**
   * Get single monitoring area
   */
  public getMonitoringAreaById(id: string): MonitoringArea | null {
    return mockDb.getMonitoringAreaById(id) || null;
  }

  /**
   * Get period observations for a monitoring area in chronological order
   */
  public getObservationsForArea(areaId: string): MonitoringPeriodObservation[] {
    return mockDb.periodObservations
      .filter((o) => o.monitoring_area_id === areaId)
      .sort((a, b) => a.period_index - b.period_index);
  }

  /**
   * 15-Day Monitoring Execution Engine
   *
   * Reads the clearest Sentinel-2 pass over the area in every 15-day period (see
   * field-surveillance.service) and stores the measured indices, growth stage and
   * change per period. Periods without a clear view are stored as such; nothing is
   * simulated. When imagery cannot be reached, the previous observations are kept and
   * the area is marked FAILED with the reason.
   */
  public async runPeriodicMonitoring(
    areaId: string,
    _options?: boolean | { force?: boolean; usePythonBackend?: boolean }
  ): Promise<MonitoringPeriodObservation[]> {
    const area = mockDb.getMonitoringAreaById(areaId);
    if (!area) throw new Error('Monitoring area not found');

    area.status = 'PROCESSING';
    area.updated_at = new Date().toISOString();
    mockDb.updateMonitoringArea(area);

    const field: SurveillanceField = {
      id: area.id,
      name: area.name,
      area:
        area.polygon_coordinates && area.polygon_coordinates.length >= 3
          ? { kind: 'polygon', coordinates: area.polygon_coordinates }
          : { kind: 'circle', center: { lat: area.latitude, lon: area.longitude }, radiusKm: area.radius_km },
      startDate: area.start_date,
      endDate: area.end_date,
      intervalDays: area.interval_days || 15,
      declaredCrop: area.preferred_crop,
      plotId: area.plot_id,
      createdAt: area.created_at,
    };

    let results: PeriodResult[];
    try {
      results = await runSurveillance(field);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      area.status = 'FAILED';
      area.last_run_error = `Satellite imagery could not be retrieved (${message}). Previous observations were kept.`;
      area.updated_at = new Date().toISOString();
      mockDb.updateMonitoringArea(area);
      throw new Error(area.last_run_error);
    }

    const analysis = analyseGrowth(results, field);
    const observations = results.map((r, i) => this.toPeriodObservation(area, r, analysis, i));

    // Keep the scenes used so their imagery can be re-read later (e.g. in the timeline)
    for (const r of results) {
      if (r.scene && !mockDb.satelliteScenes.some((s) => s.scene_id === r.scene!.scene_id)) {
        mockDb.satelliteScenes.unshift(r.scene);
      }
    }

    mockDb.setPeriodObservationsForArea(area.id, observations);

    const usableCount = observations.filter((o) => o.has_data).length;
    area.status = usableCount > 0 ? 'OBSERVATION_AVAILABLE' : 'INSUFFICIENT_IMAGERY';
    area.total_periods_count = observations.length;
    area.usable_periods_count = usableCount;
    area.last_observation_at = analysis.latest?.acquired.slice(0, 10);
    area.growth_summary = analysis.summary;
    area.crop_pattern = {
      pattern: analysis.cropPattern.pattern,
      typical_crops: analysis.cropPattern.typicalCrops,
      explanation: analysis.cropPattern.explanation,
      declared_crop_agreement: analysis.cropPattern.declaredCropAgreement,
    };
    area.alerts = analysis.alerts.map(({ severity, title, detail }) => ({ severity, title, detail }));
    area.last_run_error = undefined;
    area.updated_at = new Date().toISOString();

    const nextRun = new Date();
    nextRun.setDate(nextRun.getDate() + (area.interval_days || 15));
    area.next_scheduled_run_at = nextRun.toISOString().split('T')[0];

    mockDb.updateMonitoringArea(area);

    // Route measured warnings to the Tahsildar inspection queue
    this.evaluateInspectionRules(area, analysis);

    return observations;
  }

  private toPeriodObservation(
    area: MonitoringArea,
    r: PeriodResult,
    analysis: GrowthAnalysis,
    i: number
  ): MonitoringPeriodObservation {
    const g = analysis.perPeriod[i];
    const s = r.clip?.stats;
    const hasData = g?.ndvi !== null && g?.ndvi !== undefined && !!s;
    const prev = [...analysis.perPeriod.slice(0, i)].reverse().find((p) => p.ndvi !== null);
    const deltaNdvi = hasData && g.deltaNdvi !== null ? Number(g.deltaNdvi.toFixed(4)) : null;
    const deltaNdmi =
      hasData && prev && g.ndmi !== null && prev.ndmi !== null ? Number((g.ndmi - prev.ndmi).toFixed(4)) : null;
    const periodAlerts = analysis.alerts.filter((a) => a.periodIndex === i);
    const num = (v: number | null | undefined) => (v === null || v === undefined ? NaN : Number(v.toFixed(4)));

    const missingReason = hasData
      ? undefined
      : r.status === 'no_pass'
      ? 'No Sentinel-2 pass over this field in the period.'
      : r.status === 'error'
      ? `Imagery could not be read${r.error ? `: ${r.error}` : ''}.`
      : `Cloud or shadow covered ${s ? (100 - s.validCoveragePct).toFixed(0) : '—'}% of the field on the clearest of ${r.passesInPeriod} pass(es).`;

    return {
      id: `obs-${area.id}-p${i + 1}`,
      monitoring_area_id: area.id,
      plot_id: area.plot_id,
      period_label: `P${i + 1} (${r.period.start.slice(5)} - ${r.period.end.slice(5)})`,
      period_index: i + 1,
      period_start: r.period.start,
      period_end: r.period.end,
      actual_acquisition_dates: r.scene ? [r.scene.acquisition_datetime.slice(0, 10)] : [],
      satellite_provider: 'Copernicus Sentinel-2 L2A (Earth Search / AWS Open Data)',
      scenes_found: r.passesInPeriod,
      scenes_used: hasData ? 1 : 0,
      scene_ids: r.scene ? [r.scene.scene_id] : [],
      cloud_cover_pct: s ? Number(s.cloudOrShadowPct.toFixed(1)) : NaN,
      valid_pixel_fraction: s ? Number((s.validCoveragePct / 100).toFixed(3)) : 0,
      boa_offset_applied: r.clip ? Math.round(r.clip.reflectance.offset * 10000) : 0,
      scale_factor: r.clip ? Math.round(1 / r.clip.reflectance.scale) : 10000,
      has_data: hasData,
      missing_reason: missingReason,
      indices: {
        ndvi_mean: hasData ? num(s.ndviMean) : NaN,
        ndvi_median: hasData ? num(s.ndviMedian) : NaN,
        ndvi_min: hasData ? num(s.ndviMin) : NaN,
        ndvi_max: hasData ? num(s.ndviMax) : NaN,
        ndvi_std: hasData ? num(s.ndviStd) : NaN,
        evi_mean: hasData ? num(s.eviMean) : NaN,
        savi_mean: hasData ? num(s.saviMean) : NaN,
        ndwi_mean: hasData ? num(s.ndwiMean) : NaN,
        ndmi_mean: hasData ? num(s.ndmiMean) : NaN,
        ndre_mean: hasData ? num(s.ndreMean) : NaN,
        gcvi_mean: hasData ? num(s.gcviMean) : NaN,
      },
      growth_stage: hasData ? STAGE_MAP[g.stage] : 'Unassessed',
      health_status: !hasData
        ? r.status === 'cloudy' || r.status === 'partly_cloudy'
          ? 'Cloud Obscured'
          : 'Insufficient Data'
        : periodAlerts.some((a) => a.severity === 'critical')
        ? 'High Stress'
        : periodAlerts.length
        ? 'Mild Stress'
        : 'Optimal',
      delta_ndvi_previous: deltaNdvi,
      delta_ndmi_previous: deltaNdmi,
      delta_direction: !hasData
        ? 'NO_DATA'
        : deltaNdvi === null
        ? 'FIRST_PERIOD'
        : deltaNdvi >= 0.05
        ? 'INCREASED'
        : deltaNdvi <= -0.05
        ? 'DECREASED'
        : 'STABLE',
      change_summary: !hasData
        ? missingReason!
        : `${g.stage}. Mean NDVI ${g.ndvi!.toFixed(2)}` +
          (deltaNdvi !== null ? ` (${deltaNdvi >= 0 ? '+' : ''}${deltaNdvi.toFixed(2)} vs previous clear period).` : ' (first clear period).') +
          (periodAlerts.length ? ` ${periodAlerts.map((a) => a.title).join('; ')}.` : ''),
      data_origin: 'SENTINEL2_MEASURED',
      processed_at: new Date().toISOString(),
    };
  }

  /**
   * Route measured warnings from the latest run to the Tahsildar inspection queue
   */
  private evaluateInspectionRules(area: MonitoringArea, analysis: GrowthAnalysis) {
    const actionable = analysis.alerts.filter((a) => a.severity !== 'info');
    if (actionable.length === 0) return;

    const plot = area.plot_id ? mockDb.farmPlots.find((p) => p.id === area.plot_id) : undefined;
    const farmer = mockDb.profiles.find((p) => p.id === (plot?.farmer_id || area.farmer_id));
    const item: MonitoringInspectionItem = {
      id: `insp-queue-${area.id}`,
      monitoring_area_id: area.id,
      plot_id: area.plot_id,
      farmer_name: plot?.farmer_name || farmer?.full_name || 'Unknown landholder',
      district: plot?.district || 'Unknown',
      taluk: plot?.taluk || 'Unknown',
      village: plot?.village || 'Unknown',
      crop_type: area.preferred_crop || plot?.crop_type || 'Not declared',
      priority: actionable.some((a) => a.severity === 'critical')
        ? 'CRITICAL'
        : actionable.length > 1
        ? 'HIGH'
        : 'MEDIUM',
      reasons: actionable.map((a) => a.title),
      confidence_score: null,
      latest_ndvi_delta: analysis.latest?.deltaNdvi ?? 0,
      latest_moisture_level: analysis.latest?.ndmi ?? NaN,
      status: 'PENDING_OFFICER_REVIEW',
      created_at: new Date().toISOString(),
    };

    mockDb.addOrUpdateInspectionItem(item);
  }

  /**
   * Retrieve the Tahsildar Inspection Queue with jurisdiction enforcement
   */
  public async getInspectionQueue(jurisdiction?: {
    district?: string;
    taluk?: string;
  }): Promise<MonitoringInspectionItem[]> {
    let queue = mockDb.inspectionQueue;

    if (jurisdiction?.district && jurisdiction.district !== 'ALL') {
      queue = queue.filter((i) => i.district.toLowerCase() === jurisdiction.district?.toLowerCase());
    }
    if (jurisdiction?.taluk && jurisdiction.taluk !== 'ALL') {
      queue = queue.filter((i) => i.taluk.toLowerCase() === jurisdiction.taluk?.toLowerCase());
    }

    // Sort by priority: CRITICAL -> HIGH -> MEDIUM -> ROUTINE
    const priorityWeight: Record<MonitoringInspectionItem['priority'], number> = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      ROUTINE: 1,
    };

    return queue.sort((a, b) => priorityWeight[b.priority] - priorityWeight[a.priority]);
  }

  /**
   * Alias for calculateVegetationIndices supporting both band names and band codes (b02, b03, etc.)
   */
  public calculateIndices(bands: any) {
    const blue = bands.b02 ?? bands.blue ?? 0;
    const green = bands.b03 ?? bands.green ?? 0;
    const red = bands.b04 ?? bands.red ?? 0;
    const nir = bands.b08 ?? bands.nir ?? 0;
    const redEdge = bands.b05 ?? bands.redEdge;
    const swir1 = bands.b11 ?? bands.swir1;
    const swir2 = bands.b12 ?? bands.swir2;
    return this.calculateVegetationIndices({ blue, green, red, nir, redEdge, swir1, swir2 });
  }

  /**
   * Generate sequential 15-day periodic intervals across a season
   */
  public generate15DayPeriods(startDate: string, endDate: string) {
    const periods: Array<{ start: string; end: string; index: number; label: string }> = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    let currentStart = new Date(start);
    let idx = 1;

    while (currentStart < end) {
      const currentEnd = new Date(currentStart);
      currentEnd.setDate(currentEnd.getDate() + 14); // 15 days window
      if (currentEnd > end) {
        currentEnd.setTime(end.getTime());
      }

      const startStr = currentStart.toISOString().split('T')[0];
      const endStr = currentEnd.toISOString().split('T')[0];
      periods.push({
        index: idx,
        start: startStr,
        end: endStr,
        label: `Period ${idx} (${startStr} to ${endStr})`,
      });

      currentStart.setDate(currentStart.getDate() + 15);
      idx++;
    }
    return periods;
  }

  /**
   * Determine phenological crop growth stage from NDVI and seasonal progression
   */
  public determineGrowthStage(
    ndvi: number,
    periodIndex: number,
    totalPeriods: number
  ): MonitoringPeriodObservation['growth_stage'] {
    const ratio = periodIndex / Math.max(1, totalPeriods);
    if (ratio <= 0.25) {
      return ndvi < 0.25 ? 'Emergence' : 'Vegetative';
    } else if (ratio <= 0.65) {
      return ndvi >= 0.60 ? 'Peak / Reproductive' : 'Vegetative';
    } else if (ratio <= 0.85) {
      return ndvi >= 0.50 ? 'Maturity' : 'Harvested / Senesced';
    } else {
      return ndvi >= 0.40 ? 'Maturity' : 'Harvested / Senesced';
    }
  }

  /**
   * Evaluate whether a period observation triggers an item in the Tahsildar inspection queue
   */
  public evaluateInspectionTriggers(
    area: MonitoringArea,
    obs: MonitoringPeriodObservation,
    farmer?: any
  ): MonitoringInspectionItem | null {
    const reasons: string[] = [];
    let priority: MonitoringInspectionItem['priority'] = 'ROUTINE';

    if (obs.delta_ndvi_previous !== null && obs.delta_ndvi_previous < -0.15) {
      reasons.push(`Sharp 15-day NDVI decline of ${obs.delta_ndvi_previous.toFixed(2)}`);
      priority = 'HIGH';
    }

    if (obs.crop_prediction && obs.crop_prediction.confidence < 90) {
      reasons.push(
        `Selective prediction confidence threshold not met: ${obs.crop_prediction.crop_name} (${obs.crop_prediction.confidence.toFixed(1)}% < 90%)`
      );
      priority = priority === 'HIGH' ? 'CRITICAL' : 'HIGH';
    }

    if (obs.has_data && Number.isFinite(obs.indices?.ndmi_mean) && obs.indices.ndmi_mean < 0.15) {
      reasons.push(`Canopy moisture index (NDMI: ${obs.indices.ndmi_mean.toFixed(2)}) is critically dry`);
      priority = priority === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
    }

    if (reasons.length === 0) return null;

    const plot = area.plot_id ? mockDb.farmPlots.find((p) => p.id === area.plot_id) : undefined;
    return {
      id: `insp-${area.id}-${obs.period_index}`,
      monitoring_area_id: area.id,
      plot_id: area.plot_id,
      farmer_name: farmer?.full_name || plot?.farmer_name || 'Unknown landholder',
      district: plot?.district || 'Unknown',
      taluk: plot?.taluk || 'Unknown',
      village: plot?.village || 'Unknown',
      crop_type: area.preferred_crop || obs.crop_prediction?.crop_name || 'Not declared',
      priority,
      reasons,
      confidence_score: obs.crop_prediction?.confidence ?? null,
      latest_ndvi_delta: obs.delta_ndvi_previous || 0,
      latest_moisture_level: obs.indices?.ndmi_mean ?? NaN,
      status: 'PENDING_OFFICER_REVIEW',
      created_at: new Date().toISOString(),
    };
  }

  public registerMonitoringArea = this.createMonitoringArea.bind(this);
  public processAreaObservations = this.runPeriodicMonitoring.bind(this);
}

export const satelliteMonitoringService = SatelliteMonitoringService.getInstance();
