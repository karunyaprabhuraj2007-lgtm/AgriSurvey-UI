import React from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import { ShieldCheck, Clock, AlertCircle, Sprout, MapPin, Activity } from 'lucide-react';
import { Property, MonitoringUnit } from '@/types';

// Fix default Leaflet icon paths in Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface AgriculturalJurisdictionMapProps {
  properties: Property[];
  monitoringUnits: MonitoringUnit[];
  height?: string;
  onSelectUnit?: (unit: MonitoringUnit) => void;
}

export const AgriculturalJurisdictionMap: React.FC<AgriculturalJurisdictionMapProps> = ({
  properties,
  monitoringUnits,
  height = '420px',
  onSelectUnit,
}) => {
  // Center map around Pune division average
  const validProps = properties.filter((p) => p.latitude && p.longitude);
  const centerLat = validProps.length > 0 ? validProps[0].latitude! : 18.5793;
  const centerLng = validProps.length > 0 ? validProps[0].longitude! : 73.9824;
  const center: [number, number] = [centerLat, centerLng];

  const getMarkerColor = (status: string) => {
    switch (status) {
      case 'Healthy':
        return '#10b981'; // Green
      case 'Needs Attention':
        return '#f59e0b'; // Amber
      case 'At Risk':
        return '#f97316'; // Orange
      case 'Critical':
        return '#ef4444'; // Red
      case 'Insufficient Data':
      default:
        return '#94a3b8'; // Slate/Gray
    }
  };

  return (
    <div className="relative isolate rounded-2xl overflow-hidden border border-slate-200 shadow-xs bg-slate-100">
      <div style={{ height }}>
        <MapContainer
          center={center}
          zoom={12}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Render Monitoring Units as interactive colored CircleMarkers */}
          {monitoringUnits.map((unit) => {
            if (!unit.latitude || !unit.longitude) return null;
            const color = getMarkerColor(unit.current_health_status);

            return (
              <CircleMarker
                key={unit.id}
                center={[unit.latitude, unit.longitude]}
                radius={unit.current_health_status === 'Critical' ? 12 : 9}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.85,
                  weight: 3,
                }}
              >
                <Popup>
                  <div className="p-1 text-xs max-w-xs space-y-1">
                    <div className="font-bold text-slate-900">{unit.unit_name}</div>
                    <div className="text-emerald-700 font-semibold">{unit.crop_variety}</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-bold text-white"
                        style={{ backgroundColor: color }}
                      >
                        {unit.current_health_status}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        Zone: {unit.zone_identifier}
                      </span>
                    </div>
                    {unit.property && (
                      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                        {unit.property.property_name} • Survey {unit.property.survey_number}
                      </div>
                    )}
                    {onSelectUnit && (
                      <button
                        onClick={() => onSelectUnit(unit)}
                        className="mt-1.5 w-full py-1 bg-slate-900 text-white rounded text-[10px] font-bold"
                      >
                        Inspect Plant Telemetry
                      </button>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>

      {/* Map Legend Overlay */}
      <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-xs p-3 rounded-xl border border-slate-200 text-xs shadow-md z-[1000] space-y-1.5">
        <div className="font-bold text-slate-900 text-[11px] uppercase tracking-wider mb-1">
          Geospatial Health Markers
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-slate-700">Healthy Plot</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-amber-500 shrink-0" />
          <span className="text-slate-700">Needs Attention</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-orange-500 shrink-0" />
          <span className="text-slate-700">At Risk</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 shrink-0 ring-2 ring-red-200" />
          <span className="text-slate-700 font-bold">Critical Plant Alert</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-slate-400 shrink-0" />
          <span className="text-slate-700">Insufficient / Stale Data</span>
        </div>
      </div>
    </div>
  );
};
