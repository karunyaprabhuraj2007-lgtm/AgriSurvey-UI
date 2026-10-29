/**
 * AgriSurvey AI — Plot Weather Drawer Component
 * 
 * Powered by Open-Meteo High-Resolution Agrometeorological Service
 */

import React, { useEffect, useState } from 'react';
import {
  X,
  CloudSun,
  Droplets,
  Wind,
  Thermometer,
  Calendar,
  RefreshCw,
  AlertCircle,
  MapPin,
  Clock,
} from 'lucide-react';
import { FarmPlot, WeatherObservation } from '@/types';
import { weatherService } from '@/services/weather.service';

interface PlotWeatherDrawerProps {
  plot: FarmPlot;
  isOpen: boolean;
  onClose: () => void;
}

const PlotWeatherDrawerContent: React.FC<PlotWeatherDrawerProps> = ({ plot, isOpen, onClose }) => {

  const [weather, setWeather] = useState<WeatherObservation | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadWeather = async (refresh = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await weatherService.getPlotWeather(plot.id, refresh);
      setWeather(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load meteorological data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadWeather();
  }, [plot.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden my-8">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-500/20 text-amber-400 rounded-lg">
              <CloudSun className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">Agrometeorological Weather Intelligence</h3>
              <p className="text-xs text-slate-400">
                {plot.plot_name} • Village {plot.village}, {plot.taluk}, {plot.district}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {isLoading && (
            <div className="text-center py-12 text-slate-500 text-xs">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
              Retrieving high-resolution Open-Meteo observations for parcel coordinates...
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {weather && !isLoading && (
            <>
              {/* Current Weather Card */}
              <div className="bg-gradient-to-br from-emerald-900 to-slate-900 text-white rounded-xl p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-xs text-emerald-300 font-medium flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      Coordinates: {weather.latitude.toFixed(4)}°N, {weather.longitude.toFixed(4)}°E
                      {weather.elevation_meters && ` • Alt: ${weather.elevation_meters}m`}
                    </div>
                    <div className="text-4xl font-extrabold mt-1 tracking-tight">
                      {weather.temperature_celsius}°C
                    </div>
                    <div className="text-sm font-semibold text-emerald-200 mt-0.5">
                      {weather.weather_condition}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs bg-white/10 backdrop-blur-xs p-3 rounded-xl border border-white/10">
                    <div className="flex items-center gap-2">
                      <Droplets className="w-4 h-4 text-sky-400" />
                      <div>
                        <div className="text-slate-300 text-[10px]">Humidity</div>
                        <div className="font-bold">{weather.relative_humidity_pct}%</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Wind className="w-4 h-4 text-teal-300" />
                      <div>
                        <div className="text-slate-300 text-[10px]">Wind Speed</div>
                        <div className="font-bold">{weather.wind_speed_kmh} km/h</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Thermometer className="w-4 h-4 text-amber-300" />
                      <div>
                        <div className="text-slate-300 text-[10px]">Precipitation</div>
                        <div className="font-bold">{weather.precipitation_mm} mm</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-emerald-300" />
                      <div>
                        <div className="text-slate-300 text-[10px]">Quality</div>
                        <div className="font-bold text-emerald-300">{weather.quality_status}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Provider: {weather.provider}</span>
                  <button
                    onClick={() => loadWeather(true)}
                    className="flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh Observation
                  </button>
                </div>
              </div>

              {/* 5-Day / 7-Day Forecast Grid */}
              <div>
                <h4 className="font-bold text-xs text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-emerald-600" />
                  Upcoming Agricultural 5-Day Forecast
                </h4>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  {weather.daily_forecast.slice(0, 5).map((item, idx) => (
                    <div
                      key={item.date}
                      className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-slate-50 transition-colors text-center text-xs space-y-1"
                    >
                      <div className="font-bold text-slate-700">
                        {idx === 0
                          ? 'Today'
                          : new Date(item.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </div>
                      <div className="text-base font-extrabold text-slate-900">
                        {item.temp_max_celsius}°
                        <span className="text-xs font-normal text-slate-500"> / {item.temp_min_celsius}°</span>
                      </div>
                      <div className="text-[11px] text-sky-700 flex items-center justify-center gap-1">
                        <Droplets className="w-3 h-3" /> {item.precipitation_mm} mm
                      </div>
                      {item.rain_probability !== undefined && (
                        <div className="text-[10px] text-slate-500">
                          Rain Risk: <span className="font-semibold text-slate-700">{item.rain_probability}%</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// Mount the content only while open so its hooks always run in the same order.
export const PlotWeatherDrawer: React.FC<PlotWeatherDrawerProps> = (props) =>
  props.isOpen ? <PlotWeatherDrawerContent {...props} /> : null;
