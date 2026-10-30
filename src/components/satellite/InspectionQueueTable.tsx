/**
 * AgriSurvey AI — Tahsildar Continuous Satellite Inspection Queue
 * 
 * Allows Tahsildars and Revenue Officers to inspect flagged parcels where:
 * 1. Satellite crop identification abstained (ambiguous / no match) and is not yet ground-verified
 * 2. 15-day NDVI delta dropped abruptly (<-0.15)
 * 3. Canopy moisture stress (NDMI < -0.10) indicates potential drought or pest blighting.
 */

import React, { useState } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  Eye,
  UserCheck,
  Send,
  MapPin,
  TrendingDown,
  Droplets,
  Search,
} from 'lucide-react';
import { MonitoringInspectionItem } from '@/types';
import { mockDb } from '@/services/mock-db';
import { useLanguage } from '@/context/LanguageContext';
import { getTahsildarLabel, getStatusLabel, localizePlotOrCropName } from '@/lib/dashboard-localizer';

interface InspectionQueueTableProps {
  onInspectArea?: (areaId: string) => void;
}

export const InspectionQueueTable: React.FC<InspectionQueueTableProps> = ({ onInspectArea }) => {
  const { language } = useLanguage();
  const tl = (key: string) => getTahsildarLabel(key, language);

  const [selectedDistrict, setSelectedDistrict] = useState<string>('All');
  const [selectedTaluk, setSelectedTaluk] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [queue, setQueue] = useState<MonitoringInspectionItem[]>(mockDb.inspectionQueue);

  // Available taluks in Pune district
  const TALUKS = ['All', 'Haveli', 'Baramati', 'Shirur', 'Junnar', 'Indapur', 'Ambegaon'];

  const filteredItems = queue.filter((item) => {
    if (selectedDistrict !== 'All' && item.district.toLowerCase() !== selectedDistrict.toLowerCase()) {
      return false;
    }
    if (selectedTaluk !== 'All' && item.taluk.toLowerCase() !== selectedTaluk.toLowerCase()) {
      return false;
    }
    if (statusFilter !== 'All' && item.status !== statusFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        item.farmer_name.toLowerCase().includes(q) ||
        item.village.toLowerCase().includes(q) ||
        item.crop_type.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const handleUpdateStatus = (
    id: string,
    newStatus: 'PENDING_OFFICER_REVIEW' | 'INSPECTION_ASSIGNED' | 'VERIFIED'
  ) => {
    mockDb.updateInspectionStatus(id, newStatus);
    setQueue([...mockDb.inspectionQueue]);
  };

  const pendingCount = queue.filter((i) => i.status === 'PENDING_OFFICER_REVIEW').length;
  const criticalCount = queue.filter((i) => i.priority === 'CRITICAL' || i.priority === 'HIGH').length;
  const verifiedCount = queue.filter((i) => i.status === 'VERIFIED').length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden space-y-4 p-6">
      {/* Header and Stats */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 bg-red-100 text-red-700 rounded-lg">
              <ShieldAlert className="w-5 h-5" />
            </span>
            <h3 className="text-lg font-bold text-slate-900">
              {tl('satQueueTitle')}
            </h3>
          </div>
          <p className="text-xs text-slate-500">
            {tl('satQueueDesc')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-center">
            <div className="text-[11px] font-semibold text-red-700 uppercase">{tl('critHigh')}</div>
            <div className="text-lg font-bold text-red-800 font-mono">{criticalCount}</div>
          </div>
          <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-center">
            <div className="text-[11px] font-semibold text-amber-700 uppercase">{tl('pendingReviewStat')}</div>
            <div className="text-lg font-bold text-amber-800 font-mono">{pendingCount}</div>
          </div>
          <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
            <div className="text-[11px] font-semibold text-emerald-700 uppercase">{tl('groundVerifiedStat')}</div>
            <div className="text-lg font-bold text-emerald-800 font-mono">{verifiedCount}</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tl('searchQueuePlaceholder')}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-slate-800"
          />
        </div>

        {/* Taluk Filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-600">{tl('talukaFilter')}</span>
          <select
            value={selectedTaluk}
            onChange={(e) => setSelectedTaluk(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
          >
            {TALUKS.map((t) => (
              <option key={t} value={t}>
                {t === 'All' ? tl('allTaluks') : t}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-600">{tl('statusFilter')}</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
          >
            <option value="All">{tl('allStatuses')}</option>
            <option value="PENDING_OFFICER_REVIEW">{getStatusLabel('PENDING_OFFICER_REVIEW', language)}</option>
            <option value="INSPECTION_ASSIGNED">{tl('inspectionAssigned')}</option>
            <option value="VERIFIED">{getStatusLabel('VERIFIED', language)}</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
              <th className="p-3">{tl('thPriority')}</th>
              <th className="p-3">{tl('thFarmerLoc')}</th>
              <th className="p-3">{tl('thCropType')}</th>
              <th className="p-3">{tl('thReason')}</th>
              <th className="p-3">{tl('thCropMatch')}</th>
              <th className="p-3">{tl('th15dChange')}</th>
              <th className="p-3">{tl('thQueueStatus')}</th>
              <th className="p-3 text-right">{tl('thQueueActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-400 italic">
                  {tl('noQueueItems')}
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => {
                const priorityBadge =
                  item.priority === 'CRITICAL' ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-200 flex items-center gap-1 w-max">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping" />
                      {getStatusLabel('CRITICAL', language)}
                    </span>
                  ) : item.priority === 'HIGH' ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800 border border-orange-200 w-max">
                      {getStatusLabel('HIGH', language)}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 w-max">
                      {getStatusLabel('MEDIUM', language)}
                    </span>
                  );

                return (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="p-3 align-top">{priorityBadge}</td>

                    <td className="p-3 align-top">
                      <div className="font-bold text-slate-900">{item.farmer_name}</div>
                      <div className="text-slate-500 text-[11px] flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {item.village}, {tl('talukaFilter').replace(':', '')} {item.taluk}
                      </div>
                    </td>

                    <td className="p-3 align-top">
                      <span className="font-semibold text-slate-800">{localizePlotOrCropName(item.crop_type, language)}</span>
                    </td>

                    <td className="p-3 align-top max-w-xs">
                      <ul className="space-y-1">
                        {item.reasons.map((r, i) => (
                          <li key={i} className="text-[11px] text-red-700 flex items-start gap-1">
                            <span className="text-red-500 font-bold">&bull;</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </td>

                    <td className="p-3 align-top font-mono font-semibold">
                      {item.confidence_score === null ? (
                        <span className="text-slate-400 font-sans font-normal text-[11px]" title="Raised by measured satellite changes, not by a crop model">
                          No model
                        </span>
                      ) : (
                        <span
                          className={
                            item.confidence_score < 90
                              ? 'text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200'
                              : 'text-slate-700'
                          }
                        >
                          {item.confidence_score.toFixed(1)}%
                        </span>
                      )}
                    </td>

                    <td className="p-3 align-top font-mono font-semibold">
                      <span
                        className={`flex items-center gap-0.5 ${
                          item.latest_ndvi_delta < -0.10 ? 'text-red-600' : 'text-slate-600'
                        }`}
                      >
                        <TrendingDown className="w-3 h-3" />
                        {item.latest_ndvi_delta.toFixed(2)}
                      </span>
                    </td>

                    <td className="p-3 align-top">
                      {item.status === 'PENDING_OFFICER_REVIEW' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          {getStatusLabel('PENDING_OFFICER_REVIEW', language)}
                        </span>
                      ) : item.status === 'INSPECTION_ASSIGNED' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                          {tl('talathiAssigned')}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          {getStatusLabel('VERIFIED', language)}
                        </span>
                      )}
                    </td>

                    <td className="p-3 align-top text-right space-x-1.5">
                      {item.status === 'PENDING_OFFICER_REVIEW' && (
                        <button
                          onClick={() => handleUpdateStatus(item.id, 'INSPECTION_ASSIGNED')}
                          title="Assign Talathi / Field Officer"
                          className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold rounded-md transition-colors cursor-pointer inline-flex items-center gap-1"
                        >
                          <Send className="w-3 h-3" />
                          {tl('assignTalathiBtn')}
                        </button>
                      )}

                      {item.status !== 'VERIFIED' && (
                        <button
                          onClick={() => handleUpdateStatus(item.id, 'VERIFIED')}
                          title="Mark Ground Verified"
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold rounded-md transition-colors cursor-pointer inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          {tl('verifyBtn')}
                        </button>
                      )}

                      {onInspectArea && (
                        <button
                          onClick={() => onInspectArea(item.monitoring_area_id)}
                          title="View 15-Day Continuous Timeline"
                          className="p-1 text-slate-500 hover:text-emerald-700 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
