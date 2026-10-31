/**
 * AgriSurvey AI — Farm Plot & Geospatial Boundary Service
 * 
 * Manages agricultural farm plot entities with stable unique identifiers,
 * high-precision WGS84 geodesic area calculations (m², ha, acres), GeoJSON import/export,
 * and seamless connection to all satellite, drone, weather, crop, and disaster records.
 */

import { mockDb } from './mock-db';
import { FarmPlot, Property, AcreageAggregation } from '@/types';
import {
  computeGeodesicMeasurements,
  coordinatesToGeoJsonFeature,
  geoJsonPolygonToCoordinates,
  GeodesicMeasurement,
  computeNetNonOverlappingArea,
  checkPolygonsOverlap,
  validatePolygonGeometry,
} from '@/lib/geospatial';

export interface CreatePlotParams {
  propertyId?: string;
  farmerId: string;
  plotName: string;
  surveyNumber: string;
  subdivisionNumber?: string;
  village: string;
  taluk: string;
  district: string;
  state?: string;
  coordinates: [number, number][]; // [lat, lon][]
  cropType?: string;
  sowingDate?: string;
  isCadastralVerified?: boolean;
}

export class PlotService {
  /**
   * List all registered farm plots
   */
  async getPlots(filters?: {
    district?: string;
    taluk?: string;
    farmerId?: string;
    cropType?: string;
  }): Promise<FarmPlot[]> {
    return this.listPlots(filters);
  }

  async listPlots(filters?: {
    district?: string;
    taluk?: string;
    farmerId?: string;
    cropType?: string;
  }): Promise<FarmPlot[]> {
    let plots = [...mockDb.farmPlots];

    if (filters?.district) {
      plots = plots.filter((p) => p.district.toLowerCase() === filters.district!.toLowerCase());
    }
    if (filters?.taluk) {
      plots = plots.filter((p) => p.taluk.toLowerCase() === filters.taluk!.toLowerCase());
    }
    if (filters?.farmerId) {
      plots = plots.filter((p) => p.farmer_id === filters.farmerId);
    }
    if (filters?.cropType) {
      plots = plots.filter((p) => p.crop_type?.toLowerCase() === filters.cropType!.toLowerCase());
    }

    // Attach farmer and monitoring summary
    return plots.map((plot) => {
      const farmer = mockDb.profiles.find((p) => p.id === plot.farmer_id);
      const latestVeg = mockDb.vegetationObservations
        .filter((v) => v.plot_id === plot.id)
        .sort((a, b) => new Date(b.calculation_date).getTime() - new Date(a.calculation_date).getTime())[0];

      return {
        ...plot,
        farmer_name: farmer?.full_name || 'Registered Landholder',
        farmer_phone: farmer?.phone_number || undefined,
        latest_ndvi: latestVeg ? latestVeg.ndvi_mean : undefined,
        verification_status: plot.is_cadastral_verified ? 'CADASTRAL_VERIFIED' : 'SELF_DELINEATED',
      };
    });
  }

  /**
   * Get a single farm plot by unique ID or reference
   */
  async getPlotById(idOrRef: string): Promise<FarmPlot | null> {
    const plot = mockDb.farmPlots.find((p) => p.id === idOrRef || p.plot_reference === idOrRef);
    if (!plot) return null;

    const farmer = mockDb.profiles.find((p) => p.id === plot.farmer_id);
    const latestVeg = mockDb.vegetationObservations
      .filter((v) => v.plot_id === plot.id)
      .sort((a, b) => new Date(b.calculation_date).getTime() - new Date(a.calculation_date).getTime())[0];

    return {
      ...plot,
      farmer_name: farmer?.full_name || 'Registered Landholder',
      farmer_phone: farmer?.phone_number || undefined,
      latest_ndvi: latestVeg ? latestVeg.ndvi_mean : undefined,
    };
  }

  /**
   * Create a new farm plot with geodesic area calculation
   */
  async createPlot(params: CreatePlotParams): Promise<FarmPlot> {
    if (!params.coordinates || params.coordinates.length < 3) {
      throw new Error('A valid farm plot polygon must contain at least 3 boundary vertices.');
    }

    const measurements: GeodesicMeasurement = computeGeodesicMeasurements(params.coordinates);
    const talukCode = params.taluk.slice(0, 3).toUpperCase();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const plotRef = `MH-PUN-${talukCode}-PLOT-2026-${randomSuffix}`;

    const newPlot: FarmPlot = {
      id: `plot-${Date.now()}-${randomSuffix}`,
      plot_reference: plotRef,
      property_id: params.propertyId || mockDb.properties[0]?.id || 'prop-default',
      farmer_id: params.farmerId,
      survey_number: params.surveyNumber,
      subdivision_number: params.subdivisionNumber || null,
      plot_name: params.plotName,
      boundary_coordinates: params.coordinates,
      boundary_geojson: coordinatesToGeoJsonFeature(params.coordinates, {
        plot_reference: plotRef,
        survey_number: params.surveyNumber,
        village: params.village,
        area_hectares: measurements.areaHectares,
        area_acres: measurements.areaAcres,
      }),
      area_sqm: measurements.areaSquareMeters,
      area_hectares: measurements.areaHectares,
      area_acres: measurements.areaAcres,
      perimeter_meters: measurements.perimeterMeters,
      village: params.village,
      taluk: params.taluk,
      district: params.district,
      state: params.state || 'Maharashtra',
      is_cadastral_verified: Boolean(params.isCadastralVerified),
      crop_type: params.cropType,
      sowing_date: params.sowingDate,
      farmer_declared_area_ha: measurements.areaHectares,
      ml_predicted_area_ha: undefined,
      field_observed_area_ha: undefined,
      tahsildar_verified_area_ha: params.isCadastralVerified ? measurements.areaHectares : undefined,
      land_classification: params.cropType ? 'cultivated' : 'unclassified',
      version: 1,
      boundary_history: [
        {
          version: 1,
          coordinates: params.coordinates,
          area_sqm: measurements.areaSquareMeters,
          updated_at: new Date().toISOString(),
          reason: 'Initial Plot Boundary Delineation',
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockDb.farmPlots.unshift(newPlot);

    // Audit log
    mockDb.addAuditLog(
      'GEOSPATIAL_PLOT_CREATED',
      'farm_plots',
      newPlot.id,
      null,
      {
        plot_reference: newPlot.plot_reference,
        survey_number: newPlot.survey_number,
        area_hectares: newPlot.area_hectares,
        area_acres: newPlot.area_acres,
      }
    );

    mockDb.persistAll();
    return newPlot;
  }

  /**
   * Update plot boundary coordinates and recalculate geodesic measurements
   */
  async updatePlotBoundary(plotId: string, coordinates: [number, number][]): Promise<FarmPlot> {
    const plot = mockDb.farmPlots.find((p) => p.id === plotId);
    if (!plot) throw new Error('Plot not found');

    if (!coordinates || coordinates.length < 3) {
      throw new Error('Updated polygon must contain at least 3 vertices.');
    }

    const prevMeasurements = {
      area_sqm: plot.area_sqm,
      area_hectares: plot.area_hectares,
    };

    const measurements = computeGeodesicMeasurements(coordinates);

    plot.boundary_coordinates = coordinates;
    plot.area_sqm = measurements.areaSquareMeters;
    plot.area_hectares = measurements.areaHectares;
    plot.area_acres = measurements.areaAcres;
    plot.perimeter_meters = measurements.perimeterMeters;
    plot.farmer_declared_area_ha = measurements.areaHectares;
    if (plot.is_cadastral_verified) {
      plot.tahsildar_verified_area_ha = measurements.areaHectares;
    }
    plot.boundary_geojson = coordinatesToGeoJsonFeature(coordinates, {
      plot_reference: plot.plot_reference,
      survey_number: plot.survey_number,
      village: plot.village,
      area_hectares: measurements.areaHectares,
    });
    const currentVersion = plot.version || 1;
    const newVersion = currentVersion + 1;
    if (!plot.boundary_history) {
      plot.boundary_history = [];
    }
    plot.boundary_history.push({
      version: newVersion,
      coordinates,
      area_sqm: measurements.areaSquareMeters,
      updated_at: new Date().toISOString(),
      reason: 'Boundary Resurvey & Geodesic Update',
    });
    plot.version = newVersion;
    plot.updated_at = new Date().toISOString();

    mockDb.addAuditLog(
      'GEOSPATIAL_PLOT_BOUNDARY_UPDATED',
      'farm_plots',
      plot.id,
      prevMeasurements,
      {
        area_sqm: plot.area_sqm,
        area_hectares: plot.area_hectares,
        area_acres: plot.area_acres,
      }
    );

    mockDb.persistAll();
    return plot;
  }

  /**
   * Import GeoJSON file content into a Farm Plot
   */
  async importGeoJsonPlot(
    geoJsonContent: string,
    metadata: {
      propertyId: string;
      farmerId: string;
      plotName: string;
      surveyNumber: string;
      village: string;
      taluk: string;
      district: string;
    }
  ): Promise<FarmPlot> {
    let parsed: any;
    try {
      parsed = typeof geoJsonContent === 'string' ? JSON.parse(geoJsonContent) : geoJsonContent;
    } catch {
      throw new Error('Invalid GeoJSON format: Failed to parse JSON string.');
    }

    const coordinates = geoJsonPolygonToCoordinates(parsed);
    if (coordinates.length < 3) {
      throw new Error('Imported GeoJSON does not contain a valid Polygon geometry with >= 3 coordinates.');
    }

    return this.createPlot({
      ...metadata,
      coordinates,
      isCadastralVerified: false,
    });
  }

  /**
   * Export Farm Plot as standardized GeoJSON FeatureCollection
   */
  exportPlotGeoJson(plot: FarmPlot): string {
    const feature = coordinatesToGeoJsonFeature(plot.boundary_coordinates, {
      id: plot.id,
      plot_reference: plot.plot_reference,
      survey_number: plot.survey_number,
      subdivision_number: plot.subdivision_number,
      plot_name: plot.plot_name,
      farmer_id: plot.farmer_id,
      village: plot.village,
      taluk: plot.taluk,
      district: plot.district,
      state: plot.state,
      area_sqm: plot.area_sqm,
      area_hectares: plot.area_hectares,
      area_acres: plot.area_acres,
      perimeter_meters: plot.perimeter_meters,
      is_cadastral_verified: plot.is_cadastral_verified,
      crop_type: plot.crop_type,
      sowing_date: plot.sowing_date,
      exported_at: new Date().toISOString(),
      crs: 'EPSG:4326 - WGS 84',
    });

    return JSON.stringify(
      {
        type: 'FeatureCollection',
        name: `AgriSurvey_Plot_${plot.plot_reference}`,
        crs: {
          type: 'name',
          properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' },
        },
        features: [feature],
      },
      null,
      2
    );
  }

  /**
   * Multi-level Crop Area Estimation and 4-way separation with overlap deduplication
   */
  async getAcreageAggregation(params: {
    level: 'district' | 'taluk' | 'village' | 'plot';
    regionName: string;
    cropFilter?: string;
  }): Promise<AcreageAggregation> {
    let plots = [...mockDb.farmPlots];

    if (params.regionName && params.regionName.toLowerCase() !== 'all' && params.regionName.toLowerCase() !== 'maharashtra') {
      const q = params.regionName.toLowerCase();
      if (params.level === 'district') {
        plots = plots.filter((p) => p.district.toLowerCase() === q);
      } else if (params.level === 'taluk') {
        plots = plots.filter((p) => p.taluk.toLowerCase() === q);
      } else if (params.level === 'village') {
        plots = plots.filter((p) => p.village.toLowerCase() === q);
      } else if (params.level === 'plot') {
        plots = plots.filter((p) => p.id === params.regionName || p.plot_reference === params.regionName);
      }
    }

    if (params.cropFilter && params.cropFilter !== 'all') {
      plots = plots.filter((p) => p.crop_type?.toLowerCase() === params.cropFilter!.toLowerCase());
    }

    let totalRegisteredSqm = 0;
    let farmerDeclaredHa = 0;
    let mlPredictedHa = 0;
    let fieldObservedHa = 0;
    let tahsildarVerifiedHa = 0;

    let cultivatedHa = 0;
    let fallowHa = 0;
    let mixedHa = 0;
    let unclassifiedHa = 0;

    const cropAcreage: AcreageAggregation['crop_acreage'] = {};

    for (const plot of plots) {
      const plotHa = plot.area_hectares || (plot.area_sqm / 10000);
      totalRegisteredSqm += plot.area_sqm;

      // 4-Way Area
      const declHa = plot.farmer_declared_area_ha ?? plotHa;
      farmerDeclaredHa += declHa;

      const prediction = mockDb.cropPredictions.find((pred) => pred.plot_id === plot.id);
      const isPredicted = Boolean(plot.ml_predicted_area_ha || (prediction && prediction.predicted_crop));
      const predHa = plot.ml_predicted_area_ha ?? (isPredicted ? plotHa : 0);
      mlPredictedHa += predHa;

      const survey = mockDb.mobileSurveys.find((s) => s.plot_id === plot.id);
      const isObserved = Boolean(plot.field_observed_area_ha || (survey && survey.crop_type));
      const obsHa = plot.field_observed_area_ha ?? (isObserved ? plotHa : 0);
      fieldObservedHa += obsHa;

      const report = mockDb.reports.find((r) => r.property_id === plot.property_id && r.final_status === 'VERIFIED');
      const isVerified = Boolean(plot.is_cadastral_verified || plot.tahsildar_verified_area_ha || report);
      const verHa = plot.tahsildar_verified_area_ha ?? (isVerified ? plotHa : 0);
      tahsildarVerifiedHa += verHa;

      // Land Classification
      const cropKey = (plot.crop_type || 'unclassified').toLowerCase();
      if (cropKey.includes('fallow') || cropKey.includes('bare')) {
        fallowHa += plotHa;
      } else if (cropKey.includes('mixed') || cropKey.includes('intercrop')) {
        mixedHa += plotHa;
      } else if (cropKey === 'unclassified' || !plot.crop_type) {
        unclassifiedHa += plotHa;
      } else {
        cultivatedHa += plotHa;
      }

      // Crop-specific breakdown
      const displayCrop = plot.crop_type || 'Unclassified';
      if (!cropAcreage[displayCrop]) {
        cropAcreage[displayCrop] = {
          declared_ha: 0,
          predicted_ha: 0,
          observed_ha: 0,
          verified_ha: 0,
          plots_count: 0,
        };
      }
      cropAcreage[displayCrop].declared_ha += declHa;
      cropAcreage[displayCrop].predicted_ha += predHa;
      cropAcreage[displayCrop].observed_ha += obsHa;
      cropAcreage[displayCrop].verified_ha += verHa;
      cropAcreage[displayCrop].plots_count += 1;
    }

    // Overlap deduplication
    const polygons = plots
      .filter((p) => p.boundary_coordinates && p.boundary_coordinates.length >= 3)
      .map((p) => p.boundary_coordinates);

    const overlapResult = computeNetNonOverlappingArea(polygons);

    const totalRegHa = Math.round((totalRegisteredSqm / 10000) * 1000) / 1000;
    const totalRegAcres = Math.round(totalRegHa * 2.4710538 * 1000) / 1000;

    let dataQualityStatus: AcreageAggregation['data_quality_status'] = 'PRELIMINARY_DELINEATION';
    const verifiedShare = totalRegHa > 0 ? tahsildarVerifiedHa / totalRegHa : 0;
    if (verifiedShare >= 0.75) {
      dataQualityStatus = 'VERIFIED_GROUND_TRUTH';
    } else if (verifiedShare > 0.1 || fieldObservedHa > 0) {
      dataQualityStatus = 'PARTIALLY_VERIFIED';
    }

    const dataCoveragePct = totalRegHa > 0 ? Math.round(((fieldObservedHa + tahsildarVerifiedHa) / (2 * totalRegHa)) * 100) : 0;

    return {
      aggregation_level: params.level,
      region_name: params.regionName || 'All Maharashtra Pilot Zones',
      total_plots_count: plots.length,
      total_registered_area_sqm: Math.round(totalRegisteredSqm * 100) / 100,
      total_registered_area_ha: totalRegHa,
      total_registered_area_acres: totalRegAcres,
      farmer_declared_area_ha: Math.round(farmerDeclaredHa * 1000) / 1000,
      ml_predicted_area_ha: Math.round(mlPredictedHa * 1000) / 1000,
      field_observed_area_ha: Math.round(fieldObservedHa * 1000) / 1000,
      tahsildar_verified_area_ha: Math.round(tahsildarVerifiedHa * 1000) / 1000,
      raw_polygon_sum_ha: overlapResult.rawSumHectares,
      net_mapped_deduplicated_ha: overlapResult.netMappedHectares,
      overlapping_area_ha: Math.round((overlapResult.totalOverlapAreaSqm / 10000) * 1000) / 1000,
      overlapping_polygons_count: overlapResult.overlappingPairsCount,
      cultivated_area_ha: Math.round(cultivatedHa * 1000) / 1000,
      fallow_area_ha: Math.round(fallowHa * 1000) / 1000,
      mixed_crop_area_ha: Math.round(mixedHa * 1000) / 1000,
      unclassified_area_ha: Math.round(unclassifiedHa * 1000) / 1000,
      crop_acreage: cropAcreage,
      methodology: 'WGS84 ellipsoidal geodesic calculation (Karney / spherical excess); duplicate overlap deduplicated via grid intersection; strictly separates declared, predicted, observed, and verified layers',
      data_quality_status: dataQualityStatus,
      data_coverage_pct: Math.min(100, Math.max(0, dataCoveragePct)),
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Export Acreage Aggregation as downloadable CSV string
   */
  exportAcreageCsv(agg: AcreageAggregation): string {
    const lines: string[] = [];
    lines.push('AGRISURVEY AI — MAHARASHTRA CROP AREA ESTIMATION REPORT');
    lines.push(`Aggregation Level,${agg.aggregation_level}`);
    lines.push(`Region,${agg.region_name}`);
    lines.push(`Total Registered Plots,${agg.total_plots_count}`);
    lines.push(`Total Registered Area (Ha),${agg.total_registered_area_ha}`);
    lines.push(`Total Registered Area (Acres),${agg.total_registered_area_acres}`);
    lines.push(`Raw Polygon Sum (Ha),${agg.raw_polygon_sum_ha}`);
    lines.push(`Net Deduplicated Area (Ha),${agg.net_mapped_deduplicated_ha}`);
    lines.push(`Overlapping Area (Ha),${agg.overlapping_area_ha}`);
    lines.push(`Data Quality Status,${agg.data_quality_status}`);
    lines.push(`Methodology,"${agg.methodology}"`);
    lines.push('');
    lines.push('Crop Name,Declared (Ha),Predicted (Ha),Observed (Ha),Verified (Ha),Plots Count');
    for (const [crop, data] of Object.entries(agg.crop_acreage)) {
      lines.push(`"${crop}",${data.declared_ha.toFixed(2)},${data.predicted_ha.toFixed(2)},${data.observed_ha.toFixed(2)},${data.verified_ha.toFixed(2)},${data.plots_count}`);
    }
    return lines.join('\n');
  }

  /**
   * Export multiple plots as a unified GeoJSON FeatureCollection
   */
  exportPlotsGeoJson(plots: FarmPlot[], collectionName = 'AgriSurvey_Parcels'): string {
    const features = plots.map((plot) =>
      coordinatesToGeoJsonFeature(plot.boundary_coordinates, {
        id: plot.id,
        plot_reference: plot.plot_reference,
        survey_number: plot.survey_number,
        village: plot.village,
        taluk: plot.taluk,
        district: plot.district,
        area_hectares: plot.area_hectares,
        area_acres: plot.area_acres,
        crop_type: plot.crop_type,
        verification_status: plot.verification_status,
      })
    );

    return JSON.stringify(
      {
        type: 'FeatureCollection',
        name: collectionName,
        crs: {
          type: 'name',
          properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' },
        },
        features,
      },
      null,
      2
    );
  }
}

export const plotService = new PlotService();
