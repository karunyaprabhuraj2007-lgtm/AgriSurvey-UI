import React from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon } from 'react-leaflet';
import L from 'leaflet';
import { MapPin, ShieldAlert } from 'lucide-react';

// Fix default Leaflet icon paths in Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface PropertyMapProps {
  latitude: number;
  longitude: number;
  propertyName?: string;
  surveyNumber?: string;
  landArea?: string | number;
  height?: string;
  showBoundary?: boolean;
}

export const PropertyMap: React.FC<PropertyMapProps> = ({
  latitude = 18.5793,
  longitude = 73.9824,
  propertyName = 'Agricultural Parcel',
  surveyNumber = '142/2A',
  landArea = '3.5 Acres',
  height = '350px',
  showBoundary = true,
}) => {
  const center: [number, number] = [latitude, longitude];

  // Simulated surveyed polygon boundary around coordinates for visual verification
  const boundaryPolygon: [number, number][] = [
    [latitude + 0.0012, longitude - 0.0015],
    [latitude + 0.0014, longitude + 0.0018],
    [latitude - 0.0011, longitude + 0.0016],
    [latitude - 0.0013, longitude - 0.0013],
  ];

  return (
    <div className="relative isolate rounded-xl overflow-hidden border border-slate-200 shadow-xs bg-slate-100">
      <div style={{ height }}>
        <MapContainer
          center={center}
          zoom={16}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <Marker position={center}>
            <Popup>
              <div className="p-1 text-xs">
                <div className="font-bold text-slate-900">{propertyName}</div>
                <div className="text-emerald-700 font-semibold">Survey No: {surveyNumber}</div>
                <div className="text-slate-500">Area: {landArea}</div>
                <div className="text-[10px] text-slate-400 mt-1">
                  GPS: {latitude.toFixed(6)}, {longitude.toFixed(6)}
                </div>
              </div>
            </Popup>
          </Marker>

          {showBoundary && (
            <Polygon
              positions={boundaryPolygon}
              pathOptions={{
                color: '#15803D',
                fillColor: '#10B981',
                fillOpacity: 0.25,
                weight: 2,
                dashArray: '4, 4',
              }}
            />
          )}
        </MapContainer>
      </div>

      {/* Geospatial Evidence Notice Overlay */}
      <div className="absolute bottom-2 left-2 right-2 bg-white/95 backdrop-blur-xs px-3 py-1.5 rounded-lg border border-slate-200 text-[10px] text-slate-600 flex items-center justify-between z-[1000] shadow-xs">
        <span className="flex items-center gap-1.5 truncate">
          <MapPin className="w-3 h-3 text-emerald-600 shrink-0" />
          <span>
            Parcel Coordinates: {latitude.toFixed(5)}° N, {longitude.toFixed(5)}° E
          </span>
        </span>
        <span className="hidden sm:inline-flex items-center gap-1 text-slate-400">
          <ShieldAlert className="w-3 h-3 text-amber-500" />
          <span>Map coordinates are for inspection assistance, not legal title</span>
        </span>
      </div>
    </div>
  );
};
