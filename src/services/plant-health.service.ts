import {
  PlantHealthStatus,
  SensorParameter,
  CropHealthThreshold,
  SensorReading,
  PlantObservation,
  PlantHealthAssessment,
  PlantHealthAlert,
} from '@/types';

// =============================================================================
// Default Reference Thresholds for Key Regional Crops (Pune / Maharashtra)
// =============================================================================
export const DEFAULT_CROP_THRESHOLDS: CropHealthThreshold[] = [
  // 1. Sugarcane (Saccharum officinarum)
  {
    id: 'th-sugar-moist',
    crop_name: 'Sugarcane',
    parameter: 'soil_moisture',
    min_optimal: 60,
    max_optimal: 80,
    min_tolerable: 45,
    max_tolerable: 90,
    unit: '%',
    description: 'Sugarcane requires continuous adequate root-zone moisture for elongation phase.',
  },
  {
    id: 'th-sugar-ph',
    crop_name: 'Sugarcane',
    parameter: 'soil_ph',
    min_optimal: 6.5,
    max_optimal: 7.5,
    min_tolerable: 5.8,
    max_tolerable: 8.2,
    unit: 'pH',
    description: 'Slightly acidic to neutral soil promotes optimal cane sucrose accumulation.',
  },
  {
    id: 'th-sugar-temp',
    crop_name: 'Sugarcane',
    parameter: 'soil_temperature',
    min_optimal: 20,
    max_optimal: 32,
    min_tolerable: 15,
    max_tolerable: 38,
    unit: '°C',
    description: 'Soil temperature below 15°C delays ratoon and plant shoot emergence.',
  },
  {
    id: 'th-sugar-ec',
    crop_name: 'Sugarcane',
    parameter: 'soil_ec',
    min_optimal: 0.2,
    max_optimal: 1.5,
    min_tolerable: 0.1,
    max_tolerable: 2.5,
    unit: 'dS/m',
    description: 'Sugarcane is moderately sensitive to salinity above 2.0 dS/m.',
  },

  // 2. Cotton (Gossypium hirsutum)
  {
    id: 'th-cotton-moist',
    crop_name: 'Cotton',
    parameter: 'soil_moisture',
    min_optimal: 50,
    max_optimal: 70,
    min_tolerable: 35,
    max_tolerable: 82,
    unit: '%',
    description: 'Deep taproot system; waterlogging causes square and boll shedding.',
  },
  {
    id: 'th-cotton-ph',
    crop_name: 'Cotton',
    parameter: 'soil_ph',
    min_optimal: 6.0,
    max_optimal: 7.8,
    min_tolerable: 5.5,
    max_tolerable: 8.5,
    unit: 'pH',
    description: 'Cotton tolerates mild alkalinity but suffers in acidic soils below 5.5.',
  },

  // 3. Soybean (Glycine max)
  {
    id: 'th-soy-moist',
    crop_name: 'Soybean',
    parameter: 'soil_moisture',
    min_optimal: 55,
    max_optimal: 75,
    min_tolerable: 40,
    max_tolerable: 85,
    unit: '%',
    description: 'Moisture stress during pod filling drastically lowers oil and protein yield.',
  },
  {
    id: 'th-soy-ph',
    crop_name: 'Soybean',
    parameter: 'soil_ph',
    min_optimal: 6.0,
    max_optimal: 7.0,
    min_tolerable: 5.5,
    max_tolerable: 7.8,
    unit: 'pH',
    description: 'Rhizobium nitrogen fixation nodules operate best between pH 6.2 and 6.8.',
  },

  // 4. Onion (Allium cepa)
  {
    id: 'th-onion-moist',
    crop_name: 'Onion',
    parameter: 'soil_moisture',
    min_optimal: 60,
    max_optimal: 70,
    min_tolerable: 45,
    max_tolerable: 80,
    unit: '%',
    description: 'Shallow root system requires frequent light irrigation; bulb rot occurs in wet soils.',
  },
  {
    id: 'th-onion-ph',
    crop_name: 'Onion',
    parameter: 'soil_ph',
    min_optimal: 6.0,
    max_optimal: 7.2,
    min_tolerable: 5.5,
    max_tolerable: 7.8,
    unit: 'pH',
    description: 'Onions are sensitive to high acidity and salinity.',
  },

  // 5. Wheat (Triticum aestivum)
  {
    id: 'th-wheat-moist',
    crop_name: 'Wheat',
    parameter: 'soil_moisture',
    min_optimal: 50,
    max_optimal: 65,
    min_tolerable: 35,
    max_tolerable: 78,
    unit: '%',
    description: 'Crown root initiation (CRI) and heading stages are critical moisture milestones.',
  },
  {
    id: 'th-wheat-ph',
    crop_name: 'Wheat',
    parameter: 'soil_ph',
    min_optimal: 6.2,
    max_optimal: 7.5,
    min_tolerable: 5.8,
    max_tolerable: 8.2,
    unit: 'pH',
    description: 'Neutral loamy soil maximizes grain filling.',
  },

  // 6. Tomato (Solanum lycopersicum)
  {
    id: 'th-tomato-moist',
    crop_name: 'Tomato',
    parameter: 'soil_moisture',
    min_optimal: 60,
    max_optimal: 75,
    min_tolerable: 45,
    max_tolerable: 85,
    unit: '%',
    description: 'Fluctuating soil moisture triggers blossom end rot and fruit cracking.',
  },
  {
    id: 'th-tomato-ph',
    crop_name: 'Tomato',
    parameter: 'soil_ph',
    min_optimal: 6.0,
    max_optimal: 6.8,
    min_tolerable: 5.5,
    max_tolerable: 7.5,
    unit: 'pH',
    description: 'Slightly acidic soil facilitates calcium and micronutrient uptake.',
  },

  // 7. Grapes (Vitis vinifera)
  {
    id: 'th-grapes-moist',
    crop_name: 'Grapes',
    parameter: 'soil_moisture',
    min_optimal: 50,
    max_optimal: 65,
    min_tolerable: 38,
    max_tolerable: 75,
    unit: '%',
    description: 'Regulated deficit irrigation (RDI) after veraison improves grape brix content.',
  },
  {
    id: 'th-grapes-ph',
    crop_name: 'Grapes',
    parameter: 'soil_ph',
    min_optimal: 6.5,
    max_optimal: 7.5,
    min_tolerable: 5.8,
    max_tolerable: 8.0,
    unit: 'pH',
    description: 'Well-drained soil with balanced pH avoids lime-induced chlorosis.',
  },
];

// Fallback baseline for non-standard crops
const GENERIC_AGRICULTURAL_THRESHOLDS: Record<SensorParameter, { minOpt: number; maxOpt: number; minTol: number; maxTol: number; unit: string }> = {
  soil_moisture: { minOpt: 50, maxOpt: 75, minTol: 35, maxTol: 85, unit: '%' },
  soil_temperature: { minOpt: 18, maxOpt: 30, minTol: 12, maxTol: 38, unit: '°C' },
  ambient_temperature: { minOpt: 18, maxOpt: 34, minTol: 10, maxTol: 42, unit: '°C' },
  relative_humidity: { minOpt: 50, maxOpt: 80, minTol: 30, maxTol: 95, unit: '%' },
  soil_ph: { minOpt: 6.0, maxOpt: 7.5, minTol: 5.2, maxTol: 8.2, unit: 'pH' },
  soil_ec: { minOpt: 0.2, maxOpt: 1.8, minTol: 0.1, maxTol: 2.8, unit: 'dS/m' },
  light_intensity: { minOpt: 20000, maxOpt: 70000, minTol: 5000, maxTol: 110000, unit: 'lux' },
  leaf_wetness: { minOpt: 0, maxOpt: 40, minTol: 0, maxTol: 75, unit: '%' },
  rainfall: { minOpt: 0, maxOpt: 50, minTol: 0, maxTol: 120, unit: 'mm' },
  water_level: { minOpt: 0.5, maxOpt: 3.0, minTol: 0.2, maxTol: 5.0, unit: 'm' },
};

// Parameter absolute limits for validation
const PARAMETER_VALIDATION_LIMITS: Record<SensorParameter, { min: number; max: number }> = {
  soil_moisture: { min: 0, max: 100 },
  soil_temperature: { min: -10, max: 65 },
  ambient_temperature: { min: -10, max: 60 },
  relative_humidity: { min: 0, max: 100 },
  soil_ph: { min: 1, max: 14 },
  soil_ec: { min: 0, max: 20 },
  light_intensity: { min: 0, max: 200000 },
  leaf_wetness: { min: 0, max: 100 },
  rainfall: { min: 0, max: 500 },
  water_level: { min: 0, max: 30 },
};

export class PlantHealthEngine {
  /**
   * Calculate human-readable data freshness from ISO timestamp
   */
  static calculateDataFreshness(timestamp?: string | null): string {
    if (!timestamp) return 'No recent data';
    const now = Date.now();
    const date = new Date(timestamp).getTime();
    if (isNaN(date)) return 'No recent data';

    const diffMinutes = Math.floor((now - date) / (1000 * 60));
    if (diffMinutes < 0) return 'Updated just now';
    if (diffMinutes < 2) return 'Updated just now';
    if (diffMinutes < 60) return `Updated ${diffMinutes} minutes ago`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `Updated ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Last updated yesterday';
    if (diffDays <= 7) return `Last updated ${diffDays} days ago`;
    return 'No recent data (> 7 days)';
  }

  /**
   * Validate sensor reading against physical feasibility
   */
  static validateReading(reading: Partial<SensorReading>): { isValid: boolean; reason?: string } {
    if (!reading.parameter || reading.value === undefined || reading.value === null) {
      return { isValid: false, reason: 'Missing parameter name or numeric value' };
    }
    const limits = PARAMETER_VALIDATION_LIMITS[reading.parameter as SensorParameter];
    if (!limits) {
      return { isValid: false, reason: `Unknown sensor parameter: ${reading.parameter}` };
    }
    if (typeof reading.value !== 'number' || isNaN(reading.value)) {
      return { isValid: false, reason: 'Value must be a valid numeric figure' };
    }
    if (reading.value < limits.min || reading.value > limits.max) {
      return {
        isValid: false,
        reason: `Value ${reading.value} out of physical range [${limits.min}, ${limits.max}] for ${reading.parameter}`,
      };
    }
    return { isValid: true };
  }

  /**
   * Evaluates plant health condition for a monitoring unit
   */
  static evaluateHealth(params: {
    unitId: string;
    propertyId: string;
    cropVariety: string;
    readings: SensorReading[];
    observations: PlantObservation[];
    configuredThresholds?: CropHealthThreshold[];
  }): PlantHealthAssessment {
    const {
      unitId,
      propertyId,
      cropVariety,
      readings,
      observations,
      configuredThresholds = DEFAULT_CROP_THRESHOLDS,
    } = params;

    const detectedAnomalies: string[] = [];
    const possibleConcerns: string[] = [];
    const suggestedNextSteps: string[] = [];
    const supportingMeasurements: PlantHealthAssessment['supporting_measurements'] = {};

    // 1. Check for data availability (Must NOT mark healthy if missing or empty!)
    const validReadings = readings.filter((r) => this.validateReading(r).isValid);
    const hasAnyReadings = validReadings.length > 0;
    const hasAnyObservations = observations.length > 0;

    // Latest timestamps
    const latestReadingTime = validReadings.length > 0
      ? validReadings.reduce((max, r) => (r.recorded_at > max ? r.recorded_at : max), validReadings[0].recorded_at)
      : null;
    const latestObsTime = observations.length > 0
      ? observations.reduce((max, o) => (o.timestamp > max ? o.timestamp : max), observations[0].timestamp)
      : null;

    const mostRecentTimestamp = latestReadingTime && latestObsTime
      ? latestReadingTime > latestObsTime ? latestReadingTime : latestObsTime
      : latestReadingTime || latestObsTime || null;

    const freshnessLabel = this.calculateDataFreshness(mostRecentTimestamp);

    // Stale check: if older than 72 hours, data is considered stale
    const isStale = mostRecentTimestamp
      ? Date.now() - new Date(mostRecentTimestamp).getTime() > 72 * 60 * 60 * 1000
      : true;

    if (!hasAnyReadings && !hasAnyObservations) {
      return {
        id: `pha-${Date.now()}`,
        monitoring_unit_id: unitId,
        property_id: propertyId,
        overall_status: 'Insufficient Data',
        assessment_timestamp: new Date().toISOString(),
        supporting_measurements: {},
        detected_anomalies: ['No sensor telemetry or plant photographs have been collected for this monitoring unit.'],
        possible_concerns: ['Root-zone condition, soil moisture, and pest presence cannot be ascertained without data.'],
        suggested_next_steps: [
          'Submit a manual field observation with photos or connect an operational IoT sensor gateway.',
        ],
        data_freshness: 'No recent data',
        confidence: null,
        assessment_method: 'Agronomic threshold rules on sensor readings and recorded field observations (no ML model)',
        model_version: 'agronomic-rules',
        is_preliminary: true,
        created_at: new Date().toISOString(),
      };
    }

    // Identify Crop Category & Threshold Reference
    const matchedCropName = DEFAULT_CROP_THRESHOLDS.find(
      (th) => cropVariety.toLowerCase().includes(th.crop_name.toLowerCase())
    )?.crop_name;

    const isPreliminary = !matchedCropName;
    const cropName = matchedCropName || cropVariety;

    // Crop Threshold lookup helper
    const getThreshold = (param: SensorParameter) => {
      return (
        configuredThresholds.find(
          (th) => th.crop_name.toLowerCase() === cropName.toLowerCase() && th.parameter === param
        ) || {
          crop_name: cropName,
          parameter: param,
          min_optimal: GENERIC_AGRICULTURAL_THRESHOLDS[param]?.minOpt ?? 40,
          max_optimal: GENERIC_AGRICULTURAL_THRESHOLDS[param]?.maxOpt ?? 75,
          min_tolerable: GENERIC_AGRICULTURAL_THRESHOLDS[param]?.minTol ?? 30,
          max_tolerable: GENERIC_AGRICULTURAL_THRESHOLDS[param]?.maxTol ?? 85,
          unit: GENERIC_AGRICULTURAL_THRESHOLDS[param]?.unit ?? '',
          description: 'Generic agricultural range',
        }
      );
    };

    // 2. Evaluate Sensor Measurements
    // Find latest reading for each parameter
    const latestByParam = new Map<SensorParameter, SensorReading>();
    for (const r of validReadings) {
      const existing = latestByParam.get(r.parameter);
      if (!existing || new Date(r.recorded_at) > new Date(existing.recorded_at)) {
        latestByParam.set(r.parameter, r);
      }
    }

    let criticalCount = 0;
    let atRiskCount = 0;
    let attentionCount = 0;

    // Soil Moisture Evaluation
    const moistureReading = latestByParam.get('soil_moisture');
    if (moistureReading !== undefined) {
      const th = getThreshold('soil_moisture');
      const val = moistureReading.value;
      if (val < th.min_tolerable) {
        criticalCount++;
        supportingMeasurements.soil_moisture = { value: val, unit: th.unit, status: 'critical' };
        detectedAnomalies.push(
          `Soil moisture at ${val.toFixed(1)}${th.unit} is critically below tolerable threshold (${th.min_tolerable}${th.unit}) for ${cropName}.`
        );
        possibleConcerns.push('Risk of permanent wilting point, vascular cavitation, and irreversible yield loss.');
        suggestedNextSteps.push('Immediately initiate scheduled drip irrigation and inspect pump pressure.');
      } else if (val > th.max_tolerable) {
        criticalCount++;
        supportingMeasurements.soil_moisture = { value: val, unit: th.unit, status: 'critical' };
        detectedAnomalies.push(
          `Soil moisture at ${val.toFixed(1)}${th.unit} exceeds upper waterlogging limit (${th.max_tolerable}${th.unit}).`
        );
        possibleConcerns.push('Root zone hypoxia (suffocation) and high susceptibility to fungal collar rot.');
        suggestedNextSteps.push('Halt irrigation cycles immediately and verify drainage trench outlets.');
      } else if (val < th.min_optimal) {
        attentionCount++;
        supportingMeasurements.soil_moisture = { value: val, unit: th.unit, status: 'low' };
        detectedAnomalies.push(
          `Soil moisture at ${val.toFixed(1)}${th.unit} is below optimal range [${th.min_optimal}-${th.max_optimal}${th.unit}].`
        );
        suggestedNextSteps.push('Increase irrigation frequency over the next 48 hours to restore optimal moisture.');
      } else if (val > th.max_optimal) {
        attentionCount++;
        supportingMeasurements.soil_moisture = { value: val, unit: th.unit, status: 'high' };
        detectedAnomalies.push(`Soil moisture at ${val.toFixed(1)}${th.unit} slightly exceeds optimal range.`);
      } else {
        supportingMeasurements.soil_moisture = { value: val, unit: th.unit, status: 'optimal' };
      }
    }

    // Soil pH Evaluation
    const phReading = latestByParam.get('soil_ph');
    if (phReading !== undefined) {
      const th = getThreshold('soil_ph');
      const val = phReading.value;
      if (val < th.min_tolerable || val > th.max_tolerable) {
        atRiskCount++;
        supportingMeasurements.soil_ph = {
          value: val,
          unit: th.unit,
          status: val < th.min_tolerable ? 'acidic' : 'alkaline',
        };
        detectedAnomalies.push(
          `Soil pH at ${val.toFixed(2)} is outside tolerable bounds [${th.min_tolerable} - ${th.max_tolerable}] for ${cropName}.`
        );
        possibleConcerns.push('Nutrient lockout: microelements (Fe, Zn) become unavailable in alkaline soil; P fixed in acidic soil.');
        suggestedNextSteps.push(val < 6.0 ? 'Apply agricultural lime (calcium carbonate) to amend soil acidity.' : 'Apply gypsum or elemental sulfur to reduce soil alkalinity.');
      } else if (val < th.min_optimal || val > th.max_optimal) {
        attentionCount++;
        supportingMeasurements.soil_ph = {
          value: val,
          unit: th.unit,
          status: val < th.min_optimal ? 'acidic' : 'alkaline',
        };
        detectedAnomalies.push(`Soil pH at ${val.toFixed(2)} deviates from optimal target [${th.min_optimal} - ${th.max_optimal}].`);
      } else {
        supportingMeasurements.soil_ph = { value: val, unit: th.unit, status: 'optimal' };
      }
    }

    // Soil Temperature Evaluation
    const soilTempReading = latestByParam.get('soil_temperature');
    if (soilTempReading !== undefined) {
      const th = getThreshold('soil_temperature');
      const val = soilTempReading.value;
      if (val < th.min_tolerable || val > th.max_tolerable) {
        attentionCount++;
        supportingMeasurements.soil_temperature = { value: val, unit: th.unit, status: 'warning' };
        detectedAnomalies.push(`Soil temperature at ${val.toFixed(1)}°C is outside tolerable range.`);
      } else {
        supportingMeasurements.soil_temperature = { value: val, unit: th.unit, status: 'optimal' };
      }
    }

    // Soil EC (Salinity)
    const ecReading = latestByParam.get('soil_ec');
    if (ecReading !== undefined) {
      const th = getThreshold('soil_ec');
      const val = ecReading.value;
      if (val > th.max_tolerable) {
        criticalCount++;
        supportingMeasurements.soil_ec = { value: val, unit: th.unit, status: 'saline' };
        detectedAnomalies.push(`Soil electrical conductivity (${val.toFixed(2)} dS/m) indicates severe salinity.`);
        possibleConcerns.push('Osmotic drought: roots cannot absorb water despite moist soil due to high salt concentration.');
        suggestedNextSteps.push('Leach root zone with low-salinity water and avoid chloride-based fertilizers.');
      } else {
        supportingMeasurements.soil_ec = { value: val, unit: th.unit, status: 'optimal' };
      }
    }

    // 3. Evaluate recorded field observations
    const latestObservation = observations[0];
    if (latestObservation) {
      if (latestObservation.wilting_observed) {
        atRiskCount++;
        detectedAnomalies.push('Visible foliage wilting observed during ground field inspection.');
        possibleConcerns.push('Loss of turgor pressure; plant is under active abiotic moisture stress.');
      }
      if (latestObservation.pest_observed) {
        atRiskCount++;
        detectedAnomalies.push(
          `Pest activity recorded: ${latestObservation.pest_details || 'Visual insect feeding symptoms observed.'}`
        );
        suggestedNextSteps.push('Inspect leaf undersides with hand lens and deploy recommended biological or targeted IPM spray.');
      }
      if (latestObservation.leaf_discoloration && latestObservation.leaf_discoloration !== 'None') {
        attentionCount++;
        detectedAnomalies.push(`Leaf discoloration noted: ${latestObservation.leaf_discoloration}`);
        possibleConcerns.push('Possible nitrogen or micronutrient deficiency, or early viral infection.');
      }

      // Older records may carry an "ai_prediction" from a former simulated vision feature;
      // it only echoed the observer's own inputs and is deliberately ignored.
    }

    // 4. Stale Data Notice
    if (isStale && mostRecentTimestamp) {
      attentionCount++;
      detectedAnomalies.push('Latest telemetry readings are over 72 hours old; conditions may have changed.');
      suggestedNextSteps.push('Synchronize sensor gateway or record a new field check to ensure fresh readings.');
    }

    // 5. Determine Overall Plant Health Category
    let overallStatus: PlantHealthStatus = 'Healthy';

    if (criticalCount > 0) {
      overallStatus = 'Critical';
    } else if (atRiskCount >= 2 || (atRiskCount >= 1 && attentionCount >= 1)) {
      overallStatus = 'At Risk';
    } else if (atRiskCount === 1 || attentionCount >= 1) {
      overallStatus = 'Needs Attention';
    } else if (validReadings.length < 1 && observations.length < 1) {
      overallStatus = 'Insufficient Data';
    } else {
      overallStatus = 'Healthy';
      suggestedNextSteps.push('Maintain current irrigation schedule and fertigation baseline.');
    }

    // A threshold rules engine has no statistical confidence; data limits are reported instead

    return {
      id: `pha-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      monitoring_unit_id: unitId,
      property_id: propertyId,
      overall_status: overallStatus,
      assessment_timestamp: new Date().toISOString(),
      supporting_measurements: supportingMeasurements,
      detected_anomalies: detectedAnomalies.length > 0 ? detectedAnomalies : ['All monitored parameters within optimal ranges.'],
      possible_concerns: possibleConcerns.length > 0 ? possibleConcerns : ['No acute physiological concerns detected.'],
      suggested_next_steps: suggestedNextSteps.length > 0 ? suggestedNextSteps : ['Continue regular monitoring cycles.'],
      data_freshness: freshnessLabel,
      confidence: null,
      assessment_method: 'Agronomic threshold rules on sensor readings and recorded field observations (no ML model)',
      model_version: 'agronomic-rules',
      is_preliminary: isPreliminary,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Generates a PlantHealthAlert from a Critical or At Risk assessment
   */
  static generateAlertFromAssessment(params: {
    assessment: PlantHealthAssessment;
    unitName: string;
    propertyName?: string;
    cropVariety: string;
  }): PlantHealthAlert | null {
    const { assessment, unitName, propertyName, cropVariety } = params;

    if (assessment.overall_status === 'Healthy' || assessment.overall_status === 'Insufficient Data') {
      return null;
    }

    const severity: PlantHealthAlert['severity'] =
      assessment.overall_status === 'Critical'
        ? 'critical'
        : assessment.overall_status === 'At Risk'
        ? 'high'
        : 'medium';

    const reason = assessment.detected_anomalies[0] || `Plant health alert for ${cropVariety}`;
    const supporting = assessment.possible_concerns[0] || 'Parameters outside optimal bounds';
    const action = assessment.suggested_next_steps[0] || 'Inspect field plot immediately';

    return {
      id: `alert-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      monitoring_unit_id: assessment.monitoring_unit_id,
      property_id: assessment.property_id,
      crop_name: cropVariety,
      unit_name: unitName,
      property_name: propertyName,
      severity,
      reason,
      supporting_measurement: supporting,
      recommended_action: action,
      status: 'active',
      detected_at: new Date().toISOString(),
    };
  }
}
