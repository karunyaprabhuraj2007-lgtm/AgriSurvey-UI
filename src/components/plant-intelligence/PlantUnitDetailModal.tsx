import React, { useState } from 'react';
import {
  Activity,
  Calendar,
  Layers,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Clock,
  Camera,
  Info,
  Droplets,
  Thermometer,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { plantIntelligenceService } from '@/services/plant-intelligence.service';
import {
  MonitoringUnit,
  SensorReading,
  PlantObservation,
  PlantHealthAssessment,
  SensorDevice,
  PlantHealthAlert,
} from '@/types';

interface PlantUnitDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  unit: MonitoringUnit | null;
  readings: SensorReading[];
  observations: PlantObservation[];
  assessment: PlantHealthAssessment | null;
  device: SensorDevice | null;
  alerts: PlantHealthAlert[];
  onOpenObservationModal: () => void;
  onAlertUpdated: () => void;
}

export const PlantUnitDetailModal: React.FC<PlantUnitDetailModalProps> = ({
  isOpen,
  onClose,
  unit,
  readings,
  observations,
  assessment,
  device,
  alerts,
  onOpenObservationModal,
  onAlertUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'telemetry' | 'observations' | 'alerts'>('overview');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  if (!unit) return null;

  // Build telemetry chart series
  const chartData = readings
    .slice(0, 15)
    .reverse()
    .map((r, idx) => ({
      time: new Date(r.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: r.value,
      parameter: r.parameter,
    }));

  const moistureReadings = chartData.filter((d) => d.parameter === 'soil_moisture');
  const tempReadings = chartData.filter((d) => d.parameter === 'soil_temperature');

  const handleAcknowledgeAlert = async (alertId: string) => {
    setActionLoading(alertId);
    try {
      await plantIntelligenceService.acknowledgeAlert(alertId, 'usr-farmer-01');
      onAlertUpdated();
    } finally {
      setActionLoading(null);
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    setActionLoading(alertId);
    try {
      await plantIntelligenceService.resolveAlert(alertId, 'usr-farmer-01');
      onAlertUpdated();
    } finally {
      setActionLoading(null);
    }
  };

  const getHealthBadgeColor = (status: string) => {
    switch (status) {
      case 'Healthy':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'Needs Attention':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'At Risk':
        return 'bg-orange-50 text-orange-800 border-orange-200';
      case 'Critical':
        return 'bg-red-50 text-red-800 border-red-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${unit.unit_name} — Plant Intelligence`}
      size="xl"
    >
      <div className="space-y-5">
        {/* Unit Status Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold border ${getHealthBadgeColor(
                  unit.current_health_status
                )}`}
              >
                {unit.current_health_status}
              </span>
              <span className="text-xs font-mono text-slate-500">
                {unit.zone_identifier} • {unit.area_covered} {unit.area_unit}
              </span>
            </div>
            <h3 className="text-base font-extrabold text-slate-900 mt-1">
              {unit.crop_variety}
            </h3>
            <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>{assessment?.data_freshness || 'No recent data'}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              icon={<Camera className="w-3.5 h-3.5" />}
              onClick={() => {
                onClose();
                onOpenObservationModal();
              }}
            >
              Add Observation
            </Button>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
          {(['overview', 'telemetry', 'observations', 'alerts'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all capitalize ${
                activeTab === tab
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {tab === 'alerts' ? `Alerts (${alerts.filter((a) => a.status === 'active').length})` : tab}
            </button>
          ))}
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Telemetry Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Soil Moisture
                </span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-xl font-extrabold text-slate-900">
                    {assessment?.supporting_measurements.soil_moisture?.value !== undefined
                      ? `${assessment.supporting_measurements.soil_moisture.value}%`
                      : '—'}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {assessment?.supporting_measurements.soil_moisture?.status || 'No data'}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Soil pH
                </span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-xl font-extrabold text-slate-900">
                    {assessment?.supporting_measurements.soil_ph?.value !== undefined
                      ? assessment.supporting_measurements.soil_ph.value.toFixed(2)
                      : '—'}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {assessment?.supporting_measurements.soil_ph?.status || 'No data'}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Soil Temperature
                </span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-xl font-extrabold text-slate-900">
                    {assessment?.supporting_measurements.soil_temperature?.value !== undefined
                      ? `${assessment.supporting_measurements.soil_temperature.value}°C`
                      : '—'}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {assessment?.supporting_measurements.soil_temperature?.status || 'Optimal'}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Salinity (EC)
                </span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-xl font-extrabold text-slate-900">
                    {assessment?.supporting_measurements.soil_ec?.value !== undefined
                      ? `${assessment.supporting_measurements.soil_ec.value} dS/m`
                      : '—'}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {assessment?.supporting_measurements.soil_ec?.status || 'Optimal'}
                  </span>
                </div>
              </div>
            </div>

            {/* Assessment Details: Anomalies & Recommendations */}
            {assessment && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    Detected Physiological Anomalies
                  </h4>
                  <ul className="space-y-1 text-xs text-slate-700">
                    {assessment.detected_anomalies.map((a, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-amber-600 font-bold">•</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2">
                  <h4 className="text-xs font-bold text-emerald-950 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Recommended Agronomic Next Steps
                  </h4>
                  <ul className="space-y-1 text-xs text-emerald-900">
                    {assessment.suggested_next_steps.map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-emerald-600 font-bold">✓</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Sensor Device Status */}
            <div className="p-3 bg-white rounded-xl border border-slate-200 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Activity className="w-4 h-4 text-emerald-600" />
                <div>
                  <div className="font-semibold text-slate-900">
                    {device ? device.device_name : 'No Hardware Node Connected'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {device
                      ? `Serial: ${device.device_serial} • Model: ${device.model_number}`
                      : 'Deploy an IoT soil telemetry station to receive continuous root-zone updates'}
                  </div>
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  device?.status === 'active'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {device?.status === 'active' ? '● Sensor Connected' : 'Sensor Not Connected'}
              </span>
            </div>
          </div>
        )}

        {/* TAB 2: TELEMETRY & HISTORICAL TRENDS */}
        {activeTab === 'telemetry' && (
          <div className="space-y-4">
            <div className="p-4 bg-white rounded-xl border border-slate-200">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                Soil Moisture Trends (%)
              </h4>
              {moistureReadings.length > 0 ? (
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={moistureReadings}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#059669"
                        fill="#10b981"
                        fillOpacity={0.2}
                        name="Soil Moisture (%)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-40 flex items-center justify-center text-xs text-slate-400">
                  No historical moisture readings recorded yet.
                </div>
              )}
            </div>

            {/* Readings History Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
              <div className="bg-slate-50 px-3 py-2 font-bold text-slate-700 border-b border-slate-200">
                Recent Telemetry Telemetry Log
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                {readings.length > 0 ? (
                  readings.map((r) => (
                    <div key={r.id} className="p-2.5 flex items-center justify-between">
                      <span className="font-semibold capitalize text-slate-800">
                        {r.parameter.replace('_', ' ')}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-slate-900">
                          {r.value} {r.unit}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(r.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center text-slate-400">No sensor readings logged.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: OBSERVATIONS & PHOTOS */}
        {activeTab === 'observations' && (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {observations.length > 0 ? (
              observations.map((obs) => (
                <div key={obs.id} className="p-4 bg-white rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-900">
                      {obs.collection_method}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(obs.timestamp).toLocaleString()}
                    </span>
                  </div>

                  {obs.general_notes && (
                    <p className="text-xs text-slate-700 leading-relaxed italic">
                      "{obs.general_notes}"
                    </p>
                  )}

                  {/* Photo attachments */}
                  {obs.photographs && obs.photographs.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {obs.photographs.map((p, idx) => (
                        <div key={idx} className="relative rounded-lg overflow-hidden border border-slate-200 h-28 bg-slate-900">
                          <img src={p.url} alt={p.caption || 'Plant photo'} className="w-full h-full object-cover" />
                          <div className="absolute bottom-1 left-1 bg-slate-900/80 text-white text-[9px] px-1.5 py-0.5 rounded">
                            {p.category.toUpperCase()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Older records may contain a simulated "AI prediction"; it echoed the observer's inputs and is not shown */}
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-xs text-slate-400">
                No plant photographs or field observations uploaded yet.
              </div>
            )}
          </div>
        )}

        {/* TAB 4: ALERTS */}
        {activeTab === 'alerts' && (
          <div className="space-y-3">
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
              <strong>Notice:</strong> Acknowledging an alert marks that you have noted the condition. It does not automatically resolve the underlying plant moisture or disease stress.
            </div>

            {alerts.length > 0 ? (
              alerts.map((al) => (
                <div
                  key={al.id}
                  className={`p-4 rounded-xl border space-y-2 ${
                    al.severity === 'critical'
                      ? 'bg-red-50/60 border-red-200'
                      : 'bg-amber-50/60 border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-red-500" />
                      {al.reason}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {new Date(al.detected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <p className="text-xs text-slate-700">
                    <strong>Recommended Action:</strong> {al.recommended_action}
                  </p>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 text-xs">
                    <span className="text-[11px] font-semibold capitalize text-slate-600">
                      Status: {al.status}
                    </span>
                    <div className="flex items-center gap-2">
                      {al.status === 'active' && (
                        <button
                          onClick={() => handleAcknowledgeAlert(al.id)}
                          disabled={actionLoading === al.id}
                          className="px-2.5 py-1 bg-white text-slate-700 font-semibold rounded border border-slate-300 hover:bg-slate-50 text-xs"
                        >
                          Acknowledge
                        </button>
                      )}
                      {al.status !== 'resolved' && (
                        <button
                          onClick={() => handleResolveAlert(al.id)}
                          disabled={actionLoading === al.id}
                          className="px-2.5 py-1 bg-emerald-700 text-white font-semibold rounded hover:bg-emerald-800 text-xs"
                        >
                          Mark Resolved
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-xs text-slate-400">
                No active or historical plant alerts for this unit.
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};
