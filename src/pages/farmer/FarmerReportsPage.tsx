import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  FileText,
  Download,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  Clock,
  Eye,
  MapPin,
  Calendar,
  Building2,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  FileCheck2,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { reportService } from '@/services/report.service';
import { mockDb } from '@/services/mock-db';
import { VerificationReport, FinalVerificationStatus } from '@/types';
import { useLanguage } from '@/context/LanguageContext';
import { localizePlotOrCropName } from '@/lib/dashboard-localizer';

export const FarmerReportsPage: React.FC = () => {
  const { t, language } = useLanguage();
  const farmer = mockDb.currentUser;
  const [reports, setReports] = useState<VerificationReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<VerificationReport | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const list = await reportService.getReportsForFarmer(farmer.id);
      setReports(list);
      if (list.length > 0 && !selectedReport) {
        setSelectedReport(list[0]);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [farmer.id, selectedReport]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDownloadPdf = (report: VerificationReport) => {
    setIsDownloading(report.id);
    try {
      reportService.generatePdfReport(report);
    } finally {
      setTimeout(() => setIsDownloading(null), 800);
    }
  };

  const getStatusBadge = (status: FinalVerificationStatus) => {
    return <Badge status={status} />;
  };

  const totalReports = reports.length;
  const verifiedCount = reports.filter((r) => r.final_status === 'VERIFIED').length;
  const flaggedCount = reports.filter(
    (r) => r.final_status === 'ADDITIONAL_EVIDENCE_REQUIRED' || r.final_status === 'REINSPECTION_REQUIRED'
  ).length;
  const rejectedCount = reports.filter((r) => r.final_status === 'REJECTED').length;

  return (
    <DashboardLayout
      title={t('dashboard.reportsTitle', 'Official Verification Reports')}
      subtitle={t('dashboard.reportsSubtitle', 'Formal Tahsildar revenue verification certificates, crop survey findings, and official digital dossiers.')}
    >
      <div className="space-y-6">
        {/* KPI Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="p-4 bg-white border border-slate-200">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Total Reports Issued</span>
              <FileText className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">{totalReports}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Tahsildar signed certificates</div>
          </Card>

          <Card className="p-4 bg-white border border-slate-200">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Verified Parcels</span>
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold text-emerald-600 mt-1">{verifiedCount}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Title & crops confirmed</div>
          </Card>

          <Card className="p-4 bg-white border border-slate-200">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Under Review / Flags</span>
              <AlertCircle className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-extrabold text-amber-600 mt-1">{flaggedCount}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Minor boundary variances</div>
          </Card>

          <Card className="p-4 bg-white border border-slate-200">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Rejected / Appeals</span>
              <ShieldAlert className="w-4 h-4 text-rose-500" />
            </div>
            <div className="text-2xl font-extrabold text-rose-600 mt-1">{rejectedCount}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Appeals permitted</div>
          </Card>
        </div>

        {/* Action Header */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-slate-600">
            Showing all revenue reports for Khatedar <span className="font-bold text-slate-800">{farmer.full_name}</span>
          </div>

          <Button
            variant="outline"
            size="sm"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />}
            onClick={loadData}
          >
            Refresh Reports
          </Button>
        </div>

        {/* Reports List */}
        {reports.length === 0 ? (
          <Card className="p-12 text-center bg-white border-dashed border-2 border-slate-200">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800">No Verification Reports Yet</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto mt-1">
              Once the Tahsildar completes the examination of your 7/12 extract and aerial drone
              survey, the signed certificate will be available here for official download.
            </p>
          </Card>
        ) : (
          <div className="space-y-6">
            {reports.map((report) => {
              const prop = report.property || mockDb.properties.find((p) => p.id === report.property_id);
              const reviewer = report.reviewer || mockDb.profiles.find((p) => p.id === report.reviewed_by);

              return (
                <Card key={report.id} className="overflow-hidden border border-slate-200 bg-white">
                  {/* Report Card Header */}
                  <div className="p-5 sm:p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-emerald-100 text-emerald-900 border border-emerald-200">
                          {report.report_reference}
                        </span>
                        {getStatusBadge(report.final_status)}
                        <span className="text-xs text-slate-400">
                          • Certified on: {new Date(report.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                        <span>{prop?.property_name ? localizePlotOrCropName(prop.property_name, language) : 'Primary Farmland'}</span>
                        <span className="text-slate-400 font-normal text-sm">
                          (Survey No: {prop?.survey_number || '142/2A'})
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        <span>
                          {prop?.village || 'Wagholi'}, Taluk {prop?.taluk || 'Haveli'}, District {prop?.district || 'Pune'}
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <Button
                        variant="outline"
                        size="sm"
                        icon={<Eye className="w-3.5 h-3.5" />}
                        onClick={() => {
                          setSelectedReport(report);
                          setPreviewModalOpen(true);
                        }}
                      >
                        Inspect Dossier
                      </Button>

                      <Button
                        size="sm"
                        icon={
                          isDownloading === report.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )
                        }
                        onClick={() => handleDownloadPdf(report)}
                      >
                        Download PDF
                      </Button>
                    </div>
                  </div>

                  {/* Verification Findings Grid */}
                  <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-6 border-b border-slate-100">
                    {/* Findings Column 1 */}
                    <div className="space-y-2 text-xs">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        Land Area & Boundaries
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Declared Area:</span>
                          <span className="font-semibold text-slate-800">{report.findings?.declared_area ?? prop?.land_area ?? '—'} Acres</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Measured UAV Area:</span>
                          <span className="font-semibold text-emerald-700">{report.findings?.measured_area != null ? `${report.findings.measured_area} Acres` : 'Not measured'}</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-slate-200">
                          <span className="text-slate-500">Boundary Discrepancy:</span>
                          <span className="font-semibold text-slate-800">{report.findings?.boundary_discrepancy_meters != null ? `${report.findings.boundary_discrepancy_meters} meters` : 'Not measured'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Findings Column 2 */}
                    <div className="space-y-2 text-xs">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        Crop Stand Identification
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Declared Crop:</span>
                          <span className="font-semibold text-slate-800">{report.findings?.declared_crop ?? 'Not recorded'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Observed Crop Stand:</span>
                          <span className="font-semibold text-emerald-700">{report.findings?.observed_crop ?? 'Not recorded'}</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-slate-200">
                          <span className="text-slate-500">Irrigation Setup:</span>
                          <span className="font-semibold text-slate-800">{report.findings?.irrigation_verified ?? 'Not recorded'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Findings Column 3 */}
                    <div className="space-y-2 text-xs">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        Revenue Officer Sign-Off
                      </div>
                      <div className="bg-emerald-50/60 rounded-xl p-3.5 border border-emerald-200 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-emerald-900 font-bold">
                          <ShieldCheck className="w-4 h-4 text-emerald-600" />
                          <span>Digitally Certified</span>
                        </div>
                        <div className="text-slate-700">
                          Officer: <span className="font-semibold">{reviewer?.full_name || 'Anand Shrikant Kulkarni'}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Tahsildar & Executive Magistrate, Haveli Taluk
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Remarks & Evidence List */}
                  <div className="p-5 sm:p-6 bg-slate-50/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs">
                    <div className="space-y-1 max-w-2xl">
                      <span className="font-bold text-slate-700">Executive Remarks: </span>
                      <span className="text-slate-600 leading-relaxed">{report.discrepancies}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-slate-400 text-[11px]">Supporting Evidence:</span>
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                        {report.supporting_evidence?.length ?? 0} evidence item(s)
                      </span>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Modal: Full Digital Report Dossier */}
        {selectedReport && previewModalOpen && (
          <Modal
            isOpen={previewModalOpen}
            onClose={() => setPreviewModalOpen(false)}
            title={`Official Verification Certificate: ${selectedReport.report_reference}`}
            maxWidth="2xl"
          >
            <div className="space-y-6 text-xs text-slate-700">
              {/* Header Box */}
              <div className="p-4 rounded-xl bg-slate-900 text-white flex items-center justify-between">
                <div>
                  <div className="text-emerald-400 font-extrabold text-sm tracking-wider uppercase">
                    AgriSurvey Verification Dossier
                  </div>
                  <div className="text-xs text-slate-300 font-mono mt-0.5">{selectedReport.report_reference}</div>
                </div>
                {getStatusBadge(selectedReport.final_status)}
              </div>

              {/* Supporting Evidence List */}
              <div className="space-y-2">
                <div className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                  Verified Supporting Evidence
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(selectedReport.supporting_evidence || []).map((ev, i) => (
                    <div key={i} className="p-3 rounded-lg border border-slate-200 bg-white flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-slate-800">{ev.title}</div>
                        <div className="text-[11px] text-slate-500 font-mono">Ref: {ev.reference} • Date: {ev.date}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Statutory Disclaimer */}
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 leading-relaxed text-[11px]">
                <span className="font-bold block mb-1">STATUTORY NOTICE & DISCLAIMER:</span>
                This document is an evidence-backed technical agricultural inspection report compiled under the
                AgriSurvey platform based on farmer photographic submissions and authorized drone aerial photogrammetry.
                This verification record does not constitute legal title or conclusive property registry ownership.
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" size="sm" onClick={() => setPreviewModalOpen(false)}>
                  Close
                </Button>
                <Button
                  size="sm"
                  icon={<Download className="w-3.5 h-3.5" />}
                  onClick={() => handleDownloadPdf(selectedReport)}
                >
                  Download PDF Certificate
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </DashboardLayout>
  );
};
