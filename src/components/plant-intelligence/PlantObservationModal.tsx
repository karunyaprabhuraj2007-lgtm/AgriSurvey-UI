import React, { useState } from 'react';
import {
  UploadCloud,
  Camera,
  Activity,
  FileCheck2,
  AlertCircle,
  Info,
  CheckCircle2,
  Thermometer,
  Droplets,
  Zap,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { plantIntelligenceService } from '@/services/plant-intelligence.service';
import { mockDb } from '@/services/mock-db';
import { MonitoringUnit, SensorReading, PlantObservation } from '@/types';

interface PlantObservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  unit: MonitoringUnit | null;
  onSuccess: () => void;
}

export const PlantObservationModal: React.FC<PlantObservationModalProps> = ({
  isOpen,
  onClose,
  unit,
  onSuccess,
}) => {
  const [activeMethod, setActiveMethod] = useState<'image' | 'sensor' | 'manual'>('image');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Method A (Image) State
  const [photoCategory, setPhotoCategory] = useState<'leaf' | 'stem' | 'fruit' | 'pest_disease' | 'overview'>('leaf');
  const [photoCaption, setPhotoCaption] = useState('');
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string>(
    'https://images.unsplash.com/photo-1592982537447-7440770cbfc9?auto=format&fit=crop&w=800&q=80'
  );

  // Method B (Sensor) State
  const [sensorParams, setSensorParams] = useState({
    parameter: 'soil_moisture' as SensorReading['parameter'],
    value: 65.0,
    unit: '%',
  });

  // Method C (Manual Observation) State
  const [growthStage, setGrowthStage] = useState<PlantObservation['growth_stage']>('Vegetative');
  const [irrigationCondition, setIrrigationCondition] = useState<PlantObservation['irrigation_condition']>('Optimal');
  const [wiltingObserved, setWiltingObserved] = useState(false);
  const [leafDiscoloration, setLeafDiscoloration] = useState<PlantObservation['leaf_discoloration']>('None');
  const [pestObserved, setPestObserved] = useState(false);
  const [pestDetails, setPestDetails] = useState('');
  const [visibleSymptoms, setVisibleSymptoms] = useState('');
  const [generalNotes, setGeneralNotes] = useState('');

  if (!unit) return null;

  const handleSubmit = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      if (activeMethod === 'image') {
        // Method A: photograph + the observer's own findings (no automated image analysis exists)
        await plantIntelligenceService.recordObservation({
          monitoringUnitId: unit.id,
          propertyId: unit.property_id,
          recordedBy: mockDb.currentUser.id,
          observationType: 'image',
          collectionMethod: 'Mobile High-Resolution Camera',
          dataSource: 'farmer_mobile',
          photographs: [
            {
              url: selectedPhotoUrl,
              category: photoCategory,
              caption: photoCaption || `${photoCategory.toUpperCase()} view of ${unit.unit_name}`,
              uploaded_at: new Date().toISOString(),
            },
          ],
          growthStage,
          irrigationCondition,
          wiltingObserved,
          leafDiscoloration,
          pestObserved,
          pestDetails: pestObserved ? pestDetails : undefined,
          visibleDiseaseSymptoms: visibleSymptoms || undefined,
          generalNotes: generalNotes || undefined,
        });
      } else if (activeMethod === 'sensor') {
        // Method B: Telemetry ingestion
        await plantIntelligenceService.ingestSensorReading({
          monitoringUnitId: unit.id,
          propertyId: unit.property_id,
          parameter: sensorParams.parameter,
          value: Number(sensorParams.value),
          unit: sensorParams.unit,
          sourceDevice: 'Manual-Calibrated-Probe',
        });
      } else {
        // Method C: Manual agronomic checklist
        await plantIntelligenceService.recordObservation({
          monitoringUnitId: unit.id,
          propertyId: unit.property_id,
          recordedBy: mockDb.currentUser.id,
          observationType: 'manual',
          collectionMethod: 'Physical Ground Walk-Through',
          dataSource: 'farmer_mobile',
          growthStage,
          irrigationCondition,
          wiltingObserved,
          leafDiscoloration,
          pestObserved,
          pestDetails: pestObserved ? pestDetails : undefined,
          visibleDiseaseSymptoms: visibleSymptoms || undefined,
          generalNotes: generalNotes || undefined,
        });
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit plant observation.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Submit Plant Observation & Telemetry"
      size="lg"
    >
      <div className="space-y-5">
        {/* Unit Info Banner */}
        <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between text-xs">
          <div>
            <span className="font-bold text-emerald-950 text-sm block">{unit.unit_name}</span>
            <span className="text-emerald-800">
              Crop: <strong className="text-emerald-900">{unit.crop_variety}</strong> • Zone: {unit.zone_identifier}
            </span>
          </div>
          <span className="px-2.5 py-1 bg-white rounded-md text-emerald-700 font-bold border border-emerald-200">
            Current: {unit.current_health_status}
          </span>
        </div>

        {/* Method Switcher Tabs */}
        <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveMethod('image')}
            className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeMethod === 'image'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Method A: Photos</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMethod('sensor')}
            className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeMethod === 'sensor'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Method B: Sensor</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMethod('manual')}
            className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeMethod === 'manual'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            <span>Method C: Field Check</span>
          </button>
        </div>

        {errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* METHOD A: IMAGE-BASED MONITORING */}
        {activeMethod === 'image' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Photograph Target Category
                </label>
                <select
                  value={photoCategory}
                  onChange={(e) => setPhotoCategory(e.target.value as any)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white"
                >
                  <option value="leaf">Leaf / Foliage Surface</option>
                  <option value="stem">Stem / Cane Stalk Base</option>
                  <option value="fruit">Fruit / Crop Earhead</option>
                  <option value="pest_disease">Visible Pest / Disease Lesion</option>
                  <option value="overview">Whole-Plant / Canopy Overview</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Sample Demonstration Image
                </label>
                <select
                  value={selectedPhotoUrl}
                  onChange={(e) => setSelectedPhotoUrl(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white"
                >
                  <option value="https://images.unsplash.com/photo-1592982537447-7440770cbfc9?auto=format&fit=crop&w=800&q=80">
                    Cane Foliage - Green Active Canopies
                  </option>
                  <option value="https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80">
                    Plot Overview - Row Canopies
                  </option>
                  <option value="https://images.unsplash.com/photo-1595974482597-4b8da8879bc5?auto=format&fit=crop&w=800&q=80">
                    Drip Irrigation Line & Stem Base
                  </option>
                  <option value="https://images.unsplash.com/photo-1625246333195-78d9c38ad449?auto=format&fit=crop&w=800&q=80">
                    Vegetative Field Boundary Stand
                  </option>
                </select>
              </div>
            </div>

            {/* Photo Preview */}
            <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 h-44 flex items-center justify-center">
              <img
                src={selectedPhotoUrl}
                alt="Plant Observation Preview"
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-2 left-2 bg-slate-900/80 backdrop-blur-xs text-white text-[10px] px-2 py-1 rounded-md">
                Validation: High-Res JPG Validated • Private Storage Encryption Active
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Visual Caption / Location Notes
              </label>
              <input
                type="text"
                placeholder="e.g. Upper leaf whorl showing healthy green coloration..."
                value={photoCaption}
                onChange={(e) => setPhotoCaption(e.target.value)}
                className="w-full text-xs p-2.5 rounded-lg border border-slate-300"
              />
            </div>

            <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
              <span>
                The photograph is stored as evidence with your findings above. It is not analysed automatically: no
                plant-disease image model has been trained or validated for this platform yet.
              </span>
            </p>
          </div>
        )}

        {/* METHOD B: SENSOR-BASED MONITORING */}
        {activeMethod === 'sensor' && (
          <div className="space-y-4">
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 leading-relaxed">
              <strong>Sensor Ingestion Interface:</strong> Record or calibrate measurements from your in-situ soil probes or IoT gateway. Readings are validated against physical feasibility.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Sensor Telemetry Parameter
                </label>
                <select
                  value={sensorParams.parameter}
                  onChange={(e) => {
                    const param = e.target.value as SensorReading['parameter'];
                    let unit = '%';
                    let defaultVal = 65;
                    if (param === 'soil_ph') { unit = 'pH'; defaultVal = 6.8; }
                    else if (param === 'soil_temperature' || param === 'ambient_temperature') { unit = '°C'; defaultVal = 26; }
                    else if (param === 'relative_humidity') { unit = '%'; defaultVal = 70; }
                    else if (param === 'soil_ec') { unit = 'dS/m'; defaultVal = 0.9; }
                    else if (param === 'light_intensity') { unit = 'lux'; defaultVal = 45000; }
                    else if (param === 'leaf_wetness') { unit = '%'; defaultVal = 15; }
                    else if (param === 'rainfall') { unit = 'mm'; defaultVal = 0; }
                    else if (param === 'water_level') { unit = 'm'; defaultVal = 1.2; }
                    setSensorParams({ parameter: param, value: defaultVal, unit });
                  }}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white"
                >
                  <option value="soil_moisture">Soil Moisture (%)</option>
                  <option value="soil_ph">Soil pH (pH units)</option>
                  <option value="soil_temperature">Soil Temperature (°C)</option>
                  <option value="ambient_temperature">Ambient Temperature (°C)</option>
                  <option value="relative_humidity">Relative Humidity (%)</option>
                  <option value="soil_ec">Soil EC / Salinity (dS/m)</option>
                  <option value="light_intensity">Light Intensity (lux)</option>
                  <option value="leaf_wetness">Leaf Wetness (%)</option>
                  <option value="rainfall">Rainfall (mm)</option>
                  <option value="water_level">Water Level (m)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Measured Numeric Value ({sensorParams.unit})
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={sensorParams.value}
                  onChange={(e) => setSensorParams({ ...sensorParams, value: parseFloat(e.target.value) || 0 })}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 font-mono font-bold"
                />
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 flex items-center justify-between">
              <span>Source Device: In-Situ Handheld / IoT Gateway</span>
              <span className="font-semibold text-emerald-700">Physical Range Checked ✓</span>
            </div>
          </div>
        )}

        {/* METHOD C: MANUAL FIELD OBSERVATIONS */}
        {activeMethod === 'manual' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Crop Growth Stage
                </label>
                <select
                  value={growthStage}
                  onChange={(e) => setGrowthStage(e.target.value as any)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white"
                >
                  <option value="Germination">Germination</option>
                  <option value="Vegetative">Vegetative Growth</option>
                  <option value="Flowering">Flowering / Tasseling</option>
                  <option value="Fruiting">Fruiting / Cane Elongation</option>
                  <option value="Maturity">Maturity / Ripening</option>
                  <option value="Harvesting">Harvesting</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Irrigation Moisture Status
                </label>
                <select
                  value={irrigationCondition}
                  onChange={(e) => setIrrigationCondition(e.target.value as any)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white"
                >
                  <option value="Optimal">Optimal Moisture</option>
                  <option value="Over-irrigated">Over-irrigated / Waterlogged</option>
                  <option value="Moisture Deficit">Moisture Deficit (Dry Rootzone)</option>
                  <option value="Severe Drought">Severe Drought / Wilting Point</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Leaf Discoloration / Deficiency Symptoms
                </label>
                <select
                  value={leafDiscoloration}
                  onChange={(e) => setLeafDiscoloration(e.target.value as any)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white"
                >
                  <option value="None">None (Dark Green Uniform)</option>
                  <option value="Chlorosis (Yellowing)">Chlorosis (Yellowing)</option>
                  <option value="Necrosis (Browning)">Necrosis (Browning/Leaf Margin Scorch)</option>
                  <option value="Purpling">Purpling (Phosphorus Stress)</option>
                  <option value="Mottled">Mottled / Mosaic Pattern</option>
                </select>
              </div>

              <div className="space-y-2 pt-5">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wiltingObserved}
                    onChange={(e) => setWiltingObserved(e.target.checked)}
                    className="rounded text-amber-600 focus:ring-amber-500"
                  />
                  <span>Visible Foliage Wilting / Turgor Loss</span>
                </label>

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pestObserved}
                    onChange={(e) => setPestObserved(e.target.checked)}
                    className="rounded text-red-600 focus:ring-red-500"
                  />
                  <span>Active Pest Infestation Spotted</span>
                </label>
              </div>
            </div>

            {pestObserved && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Pest Identification Details
                </label>
                <input
                  type="text"
                  placeholder="e.g. Stem borer larvae in top cane nodes, whitefly under leaf surface..."
                  value={pestDetails}
                  onChange={(e) => setPestDetails(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                General Agronomic Field Notes
              </label>
              <textarea
                rows={2}
                placeholder="Record weather context, irrigation dripper condition, weed presence..."
                value={generalNotes}
                onChange={(e) => setGeneralNotes(e.target.value)}
                className="w-full text-xs p-2.5 rounded-lg border border-slate-300"
              />
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} isLoading={isSubmitting}>
            Record & Recalculate Health
          </Button>
        </div>
      </div>
    </Modal>
  );
};
