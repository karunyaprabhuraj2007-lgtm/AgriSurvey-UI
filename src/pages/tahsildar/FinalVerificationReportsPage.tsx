import React, { useState, useEffect } from 'react';
import {
  FileCheck2,
  Download,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Building2,
  FileText,
  Calendar,
  Layers,
  ShieldCheck,
  Search,
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
import {
  getTahsildarLabel,
  localizeEvidenceTitle,
  localizeDiscrepancies,
  getStatusLabel,
} from '@/lib/dashboard-localizer';

export const FinalVerificationReportsPage: React.FC = () => {
  const { language } = useLanguage();
  const tl = (key: string) => getTahsildarLabel(key, language);

  const [reports, setReports] = useState<VerificationReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<VerificationReport | null>(null);
  const [compileModalOpen, setCompileModalOpen] = useState(false);
  const [finalStatus, setFinalStatus] = useState<FinalVerificationStatus | ''>('');
  const [discrepanciesText, setDiscrepanciesText] = useState('');
  const [compileError, setCompileError] = useState<string | null>(null);

  // Applications that have reached review, with the evidence a report would cite
  const candidateApps = mockDb.applications
    .filter((a) => a.status === 'APPROVED' || mockDb.comparisons.some((c) => c.application_id === a.id))
    .map((a) => {
      const hasFile = (r: { media_id?: string; image_url?: string }) => Boolean(r.media_id || r.image_url);
      return {
        app: a,
        property: mockDb.properties.find((p) => p.id === a.property_id),
        farmer: mockDb.profiles.find((p) => p.id === a.farmer_id),
        groundPhotos: mockDb.landImages.filter((i) => i.application_id === a.id && hasFile(i)).length,
        dronePhotos: mockDb.droneImagery.filter((i) => i.application_id === a.id && hasFile(i)).length,
        comparison: mockDb.comparisons.find((c) => c.application_id === a.id),
      };
    });
  const [compileAppId, setCompileAppId] = useState<string>(candidateApps[0]?.app.id ?? '');
  const compileTarget = candidateApps.find((c) => c.app.id === compileAppId) ?? null;
  const [isCompiling, setIsCompiling] = useState(false);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    // Enrich reports with joined property & farmer details
    const list = mockDb.reports.map((r) => ({
      ...r,
      property: mockDb.properties.find((p) => p.id === r.property_id),
      application: mockDb.applications.find((a) => a.id === r.application_id),
      reviewer: mockDb.profiles.find((p) => p.id === r.reviewed_by),
    }));
    setReports(list);
    if (list.length > 0) setSelectedReport(list[0]);
  };

  const handleCompileNewReport = async () => {
    if (!compileTarget || !finalStatus) {
      setCompileError('Select an application and a final status.');
      return;
    }
    setCompileError(null);
    setIsCompiling(true);
    try {
      const rep = await reportService.finalizeReport({
        applicationId: compileTarget.app.id,
        propertyId: compileTarget.app.property_id,
        finalStatus,
        discrepancies: discrepanciesText,
      });

      setIsCompiling(false);
      setCompileModalOpen(false);
      loadReports();
      setSelectedReport(rep);
    } catch (err: any) {
      setIsCompiling(false);
      alert(err.message || 'Error compiling report');
    }
  };

  const handleDownloadPdf = (rep: VerificationReport) => {
    reportService.generatePdfReport(rep);
  };

  return (
    <DashboardLayout
      title={tl('landVerificationReportsTitle')}
      subtitle={tl('landVerificationReportsSubtitle')}
    >
      <div className="space-y-6">
        {/* Top Control Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              {tl('certifiedVerificationRecords')} ({reports.length})
            </h3>
            <p className="text-xs text-slate-500">
              {tl('evidenceBackedDesc')}
            </p>
          </div>

          <Button
            size="sm"
            onClick={() => setCompileModalOpen(true)}
            icon={<FileCheck2 className="w-3.5 h-3.5" />}
          >
            {tl('compileNewReportBtn')}
          </Button>
        </div>

        {/* Reports Grid and Detail View */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Reports Table / List (5 Cols) */}
          <div className="lg:col-span-5 space-y-3">
            {reports.map((rep) => {
              const isSelected = selectedReport?.id === rep.id;
              const prop = rep.property;
              const app = rep.application;
              return (
                <div
                  key={rep.id}
                  onClick={() => setSelectedReport(rep)}
                  className={`bg-white rounded-xl border p-4 transition-all cursor-pointer ${
                    isSelected
                      ? 'border-emerald-500 ring-2 ring-emerald-500/10 shadow-md'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <span className="font-mono font-bold text-slate-900 text-xs block">
                        {rep.report_reference}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {language === 'mr' ? 'गट क्र.' : 'Survey'} {prop?.survey_number} • {prop?.village}, {prop?.taluk}
                      </span>
                    </div>
                    <Badge status={rep.final_status} size="sm" />
                  </div>

                  <div className="text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-100 pt-2">
                    <span>{tl('issuedPrefix')} {new Date(rep.created_at).toLocaleDateString()}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadPdf(rep);
                      }}
                      className="text-emerald-700 font-semibold hover:underline flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      <span>{tl('downloadPdfBtn')}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Report Detailed View (7 Cols) */}
          <div className="lg:col-span-7">
            {selectedReport ? (
              <Card className="p-6 sm:p-8 space-y-6">
                {/* Official Header */}
                <div className="border-b border-slate-200 pb-4 flex items-start justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-emerald-700 tracking-wider">
                      {tl('officialRecordHeader')}
                    </span>
                    <h3 className="text-xl font-extrabold text-slate-900 mt-0.5">
                      {selectedReport.report_reference}
                    </h3>
                    <p className="text-xs text-slate-500 font-mono">
                      App Ref: {selectedReport.application?.application_reference}
                    </p>
                  </div>

                  <Button
                    size="sm"
                    onClick={() => handleDownloadPdf(selectedReport)}
                    icon={<Download className="w-3.5 h-3.5" />}
                  >
                    {tl('exportCertifiedPdfBtn')}
                  </Button>
                </div>

                {/* Status & Reviewer Summary */}
                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">{tl('verificationDecisionLabel')}</span>
                    <div className="mt-1">
                      <Badge status={selectedReport.final_status} />
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">{tl('authorizedOfficerLabel')}</span>
                    <span className="font-semibold text-slate-800">
                      {selectedReport.reviewer?.full_name || `Anand S. Kulkarni (${language === 'mr' ? 'तहसीलदार' : language === 'hi' ? 'तहसीलदार' : 'Tahsildar'})`}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">{tl('surveyedParcelLabel')}</span>
                    <span className="font-semibold text-slate-800">
                      {language === 'mr' ? 'गट क्र.' : 'Gat No.'} {selectedReport.property?.survey_number} ({selectedReport.property?.land_area} {language === 'mr' ? 'एकर' : language === 'hi' ? 'एकड़' : 'Acres'})
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">{tl('digitalTimestampLabel')}</span>
                    <span className="font-mono text-slate-700">
                      {new Date(selectedReport.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Evidence Chain Table */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-2">
                    {tl('evidenceTrailTitle')}
                  </h4>
                  <div className="border border-slate-200 rounded-lg overflow-x-auto text-xs">
                    <table className="w-full text-left min-w-[280px]">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase font-bold">
                        <tr>
                          <th className="py-2 px-3">{tl('evidenceSourceTh')}</th>
                          <th className="py-2 px-3">{tl('referenceTh')}</th>
                          <th className="py-2 px-3">{tl('dateTh')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedReport.supporting_evidence.map((ev, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="py-2 px-3 font-medium text-slate-800">{localizeEvidenceTitle(ev.title, language)}</td>
                            <td className="py-2 px-3 font-mono text-slate-600">{ev.reference}</td>
                            <td className="py-2 px-3 text-slate-400">{ev.date || '2026-02-18'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Discrepancies and Findings Memo */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    {tl('reviewerDiscrepanciesTitle')}
                  </h4>
                  <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200 leading-relaxed">
                    {localizeDiscrepancies(selectedReport.discrepancies, language)}
                  </p>
                </div>

                {/* Statutory Disclaimer Notice (Section 16 Requirement) */}
                <div className="p-3.5 bg-rose-50/70 border border-rose-200 rounded-xl text-[11px] text-rose-950 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-rose-800">
                    <ShieldCheck className="w-4 h-4 text-rose-600" />
                    <span>{tl('statutoryNoticeTitle')}</span>
                  </div>
                  <p className="leading-relaxed">
                    {tl('statutoryNoticeDesc')}
                  </p>
                </div>
              </Card>
            ) : (
              <div className="p-12 text-center text-xs text-slate-400">
                {tl('selectReportPrompt')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compile Report Modal */}
      <Modal
        isOpen={compileModalOpen}
        onClose={() => setCompileModalOpen(false)}
        title={tl('finalizeReportModalTitle')}
        description={tl('finalizeReportModalDesc')}
        maxWidth="lg"
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tl('selectAppToFinalizeLabel')}
            </label>
            <select
              value={compileAppId}
              onChange={(e) => setCompileAppId(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
            >
              {candidateApps.length === 0 && <option value="">No applications ready for a report</option>}
              {candidateApps.map(({ app, property, farmer }) => (
                <option key={app.id} value={app.id}>
                  {app.application_reference} • {farmer?.full_name ?? 'Farmer'} • {language === 'mr' ? 'गट क्र.' : 'Survey'} {property?.survey_number ?? '—'} {property?.village ?? ''}
                </option>
              ))}
            </select>
            {compileTarget && (
              <p className="mt-1.5 text-[11px] text-slate-600">
                Evidence on record: {compileTarget.groundPhotos} ground photo(s), {compileTarget.dronePhotos} drone photo(s), image comparison{' '}
                <strong>{compileTarget.comparison?.comparison_result ?? 'not recorded'}</strong>.
              </p>
            )}
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tl('finalStatusLabel')}
            </label>
            <select
              value={finalStatus}
              onChange={(e) => setFinalStatus(e.target.value as FinalVerificationStatus | '')}
              className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
            >
              <option value="">— Select the final status —</option>
              <option value="VERIFIED">{getStatusLabel('VERIFIED', language)} ({language === 'mr' ? 'पुरावे पूर्णपणे जुळतात' : 'Evidence fully corresponds'})</option>
              <option value="ADDITIONAL_EVIDENCE_REQUIRED">{getStatusLabel('ADDITIONAL_EVIDENCE_REQUIRED', language)}</option>
              <option value="REINSPECTION_REQUIRED">{getStatusLabel('REINSPECTION_REQUIRED', language)}</option>
              <option value="REJECTED">{getStatusLabel('REJECTED', language)} ({language === 'mr' ? 'हद्दी किंवा मालकी वाद' : 'Boundary or title conflict'})</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tl('findingsDiscrepancyStatementLabel')}
            </label>
            <textarea
              rows={3}
              value={discrepanciesText}
              placeholder="Record the discrepancies you found, or state that none were found."
              onChange={(e) => setDiscrepanciesText(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-slate-300 bg-white text-slate-900"
            />
          </div>

          {finalStatus === 'VERIFIED' && compileTarget && compileTarget.comparison?.comparison_result !== 'CONSISTENT' && (
            <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
              No image comparison has been recorded as consistent for this application. Review the evidence in the Image
              Comparison Workspace before marking it verified.
            </p>
          )}
          {compileError && (
            <p role="alert" className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
              {compileError}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="ghost" onClick={() => setCompileModalOpen(false)}>
              {tl('cancelBtn')}
            </Button>
            <Button onClick={handleCompileNewReport} isLoading={isCompiling} disabled={!compileTarget || !finalStatus}>
              {tl('compileSignReportBtn')}
            </Button>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  );
};
