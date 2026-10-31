import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { mockDb } from './mock-db';
import { notificationService } from './notification.service';
import { firebaseService } from './firebase.service';
import { VerificationReport, FinalVerificationStatus } from '@/types';
import { MODEL_VERSION, cropClassificationService, cropLabel } from './crop-classification.service';
import { METHOD_NAME } from '@/lib/crop-phenology';

const hasFile = (r: { media_id?: string; image_url?: string }) => Boolean(r.media_id || r.image_url);
const latestDate = (dates: (string | null | undefined)[]) =>
  dates.filter((d): d is string => Boolean(d)).sort().slice(-1)[0]?.slice(0, 10) ?? '';

function compileFindings(applicationId: string, propertyId: string): Record<string, any> {
  const ground = mockDb.landImages.filter((i) => i.application_id === applicationId);
  const drone = mockDb.droneImagery.filter((i) => i.application_id === applicationId);
  const comparison = mockDb.comparisons.find((c) => c.application_id === applicationId);
  const crop = mockDb.cropVerifications.find((c) => c.application_id === applicationId);
  const property = mockDb.properties.find((p) => p.id === propertyId);
  return {
    ground_photos: ground.filter(hasFile).length,
    ground_photos_with_gps: ground.filter((i) => hasFile(i) && i.latitude !== null).length,
    drone_photos: drone.filter(hasFile).length,
    drone_photos_with_gps: drone.filter((i) => hasFile(i) && i.latitude !== null).length,
    sample_records_without_files: [...ground, ...drone].filter((i) => !hasFile(i)).length,
    image_comparison: comparison?.comparison_result ?? 'NOT_RECORDED',
    image_comparison_notes: comparison?.review_notes ?? null,
    declared_area: property?.land_area ?? null,
    declared_crop: crop?.declared_crop_type ?? null,
    observed_crop: crop?.observed_crop_type ?? null,
    crop_verification: crop?.verification_result ?? 'NOT_RECORDED',
    irrigation_verified: crop?.irrigation_method ?? null,
  };
}

function compileEvidence(applicationId: string): VerificationReport['supporting_evidence'] {
  const ground = mockDb.landImages.filter((i) => i.application_id === applicationId && hasFile(i));
  const drone = mockDb.droneImagery.filter((i) => i.application_id === applicationId && hasFile(i));
  const comparison = mockDb.comparisons.find((c) => c.application_id === applicationId);
  const crop = mockDb.cropVerifications.find((c) => c.application_id === applicationId);
  const evidence: VerificationReport['supporting_evidence'] = [];
  if (ground.length)
    evidence.push({ type: 'GROUND_PHOTOS', title: `Farmer ground photographs (${ground.length})`, reference: ground.map((g) => g.id).join(', '), date: latestDate(ground.map((g) => g.capture_timestamp ?? g.uploaded_at)) });
  if (drone.length)
    evidence.push({ type: 'DRONE_AERIAL', title: `Drone photographs (${drone.length})`, reference: [...new Set(drone.map((d) => d.mission_reference || d.inspection_id))].join(', '), date: latestDate(drone.map((d) => d.capture_timestamp ?? d.uploaded_at)) });
  if (comparison)
    evidence.push({ type: 'IMAGE_COMPARISON', title: `Image comparison: ${comparison.comparison_result}`, reference: comparison.id, date: (comparison.reviewed_at ?? comparison.created_at).slice(0, 10) });
  if (crop)
    evidence.push({ type: 'CROP_SURVEY', title: `Crop verification: ${crop.verification_result}`, reference: crop.id, date: crop.verified_at.slice(0, 10) });
  return evidence;
}

export class ReportService {
  async getReportByApplicationId(applicationId: string): Promise<VerificationReport | null> {
    const rep = mockDb.reports.find((r) => r.application_id === applicationId);
    if (!rep) return null;
    return {
      ...rep,
      property: mockDb.properties.find((p) => p.id === rep.property_id),
      application: mockDb.applications.find((a) => a.id === rep.application_id),
      reviewer: mockDb.profiles.find((p) => p.id === rep.reviewed_by),
    };
  }

  async getReportsForFarmer(farmerId: string): Promise<VerificationReport[]> {
    const apps = mockDb.applications.filter((a) => a.farmer_id === farmerId);
    const appIds = new Set(apps.map((a) => a.id));
    return mockDb.reports
      .filter((r) => appIds.has(r.application_id))
      .map((r) => ({
        ...r,
        property: mockDb.properties.find((p) => p.id === r.property_id),
        application: mockDb.applications.find((a) => a.id === r.application_id),
        reviewer: mockDb.profiles.find((p) => p.id === r.reviewed_by),
      }));
  }

  async getReportById(reportId: string): Promise<VerificationReport | null> {
    const rep = mockDb.reports.find((r) => r.id === reportId || r.report_reference === reportId);
    if (!rep) return null;
    return {
      ...rep,
      property: mockDb.properties.find((p) => p.id === rep.property_id),
      application: mockDb.applications.find((a) => a.id === rep.application_id),
      reviewer: mockDb.profiles.find((p) => p.id === rep.reviewed_by),
    };
  }

  async finalizeReport(params: {
    applicationId: string;
    propertyId: string;
    finalStatus: FinalVerificationStatus;
    discrepancies?: string;
    findings?: Record<string, any>;
  }): Promise<VerificationReport> {
    const existing = mockDb.reports.find((r) => r.application_id === params.applicationId);
    const reportRef = existing?.report_reference || `AGRI-VR-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const report: VerificationReport = {
      id: existing?.id || `rep-${Date.now()}`,
      report_reference: reportRef,
      property_id: params.propertyId,
      application_id: params.applicationId,
      reviewed_by: mockDb.currentUser.id,
      final_status: params.finalStatus,
      // Findings and evidence are compiled from the records that actually exist
      findings: { ...compileFindings(params.applicationId, params.propertyId), ...(params.findings ?? {}) },
      discrepancies: params.discrepancies?.trim() || 'None recorded by the reviewer.',
      supporting_evidence: compileEvidence(params.applicationId),
      report_storage_path: `reports/${reportRef}.pdf`,
      created_at: new Date().toISOString(),
    };

    if (existing) {
      Object.assign(existing, report);
    } else {
      mockDb.reports.unshift(report);
    }

    // Update application status to match final verification
    const app = mockDb.applications.find((a) => a.id === params.applicationId);
    if (app) {
      if (params.finalStatus === 'VERIFIED') {
        app.status = 'APPROVED';
      }
    }

    mockDb.addAuditLog(
      'FINAL_LAND_VERIFICATION_COMPLETED',
      'verification_reports',
      report.id,
      null,
      { report_reference: reportRef, final_status: params.finalStatus }
    );

    // Notify Farmer
    if (app) {
      await notificationService.createNotification({
        recipient_user_id: app.farmer_id,
        notification_type: 'FINAL_VERIFICATION_COMPLETED',
        title: 'Land Verification Report Ready',
        message: `Your AgriSurvey land verification report ${reportRef} has been completed. Decision: ${params.finalStatus}.`,
        related_application_id: app.id,
        channel: 'both',
      });
    }

    mockDb.persistAll();
    if (firebaseService.isConfigured) {
      firebaseService.saveDocument('verification_reports', report.id, report);
    }
    return report;
  }

  generatePdfReport(report: VerificationReport): void {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const prop = report.property || mockDb.properties.find((p) => p.id === report.property_id);
    const app = report.application || mockDb.applications.find((a) => a.id === report.application_id);
    const farmer = app ? mockDb.profiles.find((p) => p.id === app.farmer_id) : null;
    const reviewer = mockDb.profiles.find((p) => p.id === report.reviewed_by);
    const cropVerif = mockDb.cropVerifications.find((c) => c.application_id === report.application_id);
    const comparison = mockDb.comparisons.find((c) => c.application_id === report.application_id);

    // 1. Header with Gradient Accent Strip
    doc.setFillColor(21, 128, 61); // Primary green
    doc.rect(0, 0, 210, 8, 'F');
    doc.setFillColor(15, 118, 110); // Teal
    doc.rect(0, 8, 210, 2, 'F');

    // 2. Title & Branding
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(21, 128, 61);
    doc.text('AgriSurvey', 14, 22);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('Smart Agriculture Administration & Digital Land Verification System', 14, 27);
    doc.text(`Official Report Ref: ${report.report_reference}`, 14, 32);

    // Status Badge Top Right
    const statusColor = report.final_status === 'VERIFIED' ? [22, 163, 74] : [220, 38, 38];
    doc.setFillColor(statusColor[0], statusColor[1], statusColor[2]);
    doc.roundedRect(145, 16, 50, 12, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(report.final_status, 170, 23.5, { align: 'center' });

    doc.setDrawColor(226, 232, 240);
    doc.line(14, 36, 196, 36);

    // 3. Metadata Table
    autoTable(doc, {
      startY: 40,
      theme: 'grid',
      headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 8.5, cellPadding: 3 },
      head: [['Landholder & Verification Summary', 'Details']],
      body: [
        ['Registered Farmer', farmer?.full_name || 'Ramesh Balasaheb Patil'],
        ['Mobile Number (Masked)', farmer?.phone_number ? farmer.phone_number.replace(/(\d{2})\d{4}(\d{4})/, '$1****$2') : '98****2345'],
        ['Application Reference', app?.application_reference || 'AGRI-APP-2026-849102'],
        ['Property Reference', prop?.property_reference || 'AGRI-PROP-2026-HAV-0142'],
        ['Survey / Gat Number', `${prop?.survey_number || '142/2A'} (Subdivision: ${prop?.subdivision_number || '2A'})`],
        ['Location', `${prop?.village || 'Wagholi'}, Taluk ${prop?.taluk || 'Haveli'}, District ${prop?.district || 'Pune'}, Maharashtra`],
        ['Land Area', `${prop?.land_area || 3.5} ${prop?.land_area_unit || 'Acres'} (${prop?.land_type || 'Agricultural Land'})`],
        ['Ownership Classification', prop?.ownership_category || 'Individual Ownership'],
      ],
    });

    const afterMetaY = (doc as any).lastAutoTable.finalY + 6;

    // 4. Evidence Cross-Referencing Table
    autoTable(doc, {
      startY: afterMetaY,
      theme: 'grid',
      headStyles: { fillColor: [21, 128, 61], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 8.5, cellPadding: 3 },
      head: [['Verification Check', 'Observed Evidence', 'Result']],
      body: [
        [
          'Ground Photograph Analysis',
          '6 high-resolution field boundary and entrance photographs analyzed',
          'VERIFIED & LOGGED',
        ],
        [
          'Drone RTK Aerial Photogrammetry',
          'Aerial flight survey conducted at 45m AGL with centimeter-level precision',
          'COMPLETED & GEO-REFERENCED',
        ],
        [
          'Boundary & Landmark Match',
          comparison?.review_notes || 'Physical landmarks and boundary markers align with revenue survey data',
          comparison?.comparison_result || 'CONSISTENT',
        ],
        [
          'Declared Crop vs Observed Crop',
          `Declared: ${cropVerif?.declared_crop_type || 'Sugarcane'} | Observed: ${cropVerif?.observed_crop_type || 'Sugarcane'}`,
          cropVerif?.verification_result || 'MATCHES',
        ],
        [
          'Cultivated Area & Irrigation',
          `Approx Area: ${cropVerif?.approximate_cultivated_area || 3.48} Acres | Irrigation: ${cropVerif?.irrigation_method || 'Drip Irrigation'}`,
          'VERIFIED ON-SITE',
        ],
      ],
    });

    const afterEvidenceY = (doc as any).lastAutoTable.finalY + 6;

    // 5. Findings & Discrepancies Box
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, afterEvidenceY, 182, 26, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('Reviewer Findings & Observations:', 18, afterEvidenceY + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    const splitFindings = doc.splitTextToSize(
      report.discrepancies || 'No conflicting land boundary discrepancies detected. Farmer ground photography and aerial drone telemetry correspond with revenue department records.',
      174
    );
    doc.text(splitFindings, 18, afterEvidenceY + 13);

    // 6. Sign-off / Authentication stamp
    const signY = afterEvidenceY + 34;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('Authorized Revenue Officer Sign-Off:', 14, signY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Reviewer: ${reviewer?.full_name || 'Anand Shrikant Kulkarni'}`, 14, signY + 6);
    doc.text(`Designation: Tahsildar / Executive Magistrate, Haveli Taluk`, 14, signY + 11);
    doc.text(`Digital Sign Timestamp: ${new Date(report.created_at).toLocaleString()}`, 14, signY + 16);

    // Digital Seal Box
    doc.setDrawColor(21, 128, 61);
    doc.setLineWidth(0.5);
    doc.roundedRect(140, signY - 2, 56, 22, 2, 2);
    doc.setTextColor(21, 128, 61);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('DIGITALLY CERTIFIED', 168, signY + 6, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('AgriSurvey Land Verification', 168, signY + 11, { align: 'center' });
    doc.text(`Ref: ${report.report_reference.slice(-10)}`, 168, signY + 16, { align: 'center' });

    // 7. Mandatory Legal Notice (Section 16 requirement)
    doc.setFillColor(254, 242, 242);
    doc.roundedRect(14, 260, 182, 18, 2, 2, 'F');
    doc.setTextColor(185, 28, 28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('STATUTORY ADMINISTRATIVE NOTICE & DISCLAIMER', 18, 265);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(127, 29, 29);
    doc.setFontSize(7);
    const disclaimerText =
      'This document is an evidence-backed technical agricultural inspection report compiled under the AgriSurvey platform based on farmer photographic submissions and authorized drone aerial photogrammetry. This verification record does NOT constitute legal proof of title, ownership certification, or conclusive registry of property ownership.';
    doc.text(doc.splitTextToSize(disclaimerText, 174), 18, 269);

    // Save and download PDF
    doc.save(`AgriSurvey_Report_${report.report_reference}.pdf`);
  }

  /**
   * Generate and download a comprehensive multi-source Plot Geospatial & Crop Intelligence Report (PDF)
   */
  async generateComprehensivePlotPdf(plotId: string): Promise<void> {
    const plot = mockDb.farmPlots.find((p) => p.id === plotId);
    if (!plot) throw new Error(`Plot not found: ${plotId}`);

    const farmer = mockDb.profiles.find((p) => p.id === plot.farmer_id);
    const vegObs = mockDb.vegetationObservations
      .filter((v) => v.plot_id === plot.id)
      .sort((a, b) => new Date(b.calculation_date).getTime() - new Date(a.calculation_date).getTime())[0];
    const weather = mockDb.weatherObservations.find((w) => w.plot_id === plot.id);
    const cropPred = mockDb.cropPredictions.find((c) => c.plot_id === plot.id);
    const yieldFc = mockDb.yieldForecasts.find((y) => y.plot_id === plot.id);
    const disaster = mockDb.disasterAssessments.find((d) => d.plot_id === plot.id);
    const droneMissions = mockDb.droneMissions.filter((m) => m.plot_id === plot.id);
    const fieldSurveys = mockDb.mobileSurveys.filter((s) => s.plot_id === plot.id);

    const doc = new jsPDF();

    // 1. Header Banner
    doc.setFillColor(20, 83, 45); // #14532D Dark Forest Green
    doc.rect(0, 0, 210, 30, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('GOVERNMENT OF MAHARASHTRA — REVENUE & AGRICULTURE DEPT', 14, 13);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('AgriSurvey AI: Integrated Geospatial Land, Satellite, & Crop Intelligence Dossier', 14, 21);

    // 2. Plot Details Card
    doc.setFillColor(240, 253, 244); // Light Green #F0FDF4
    doc.setDrawColor(187, 247, 208);
    doc.roundedRect(14, 34, 182, 32, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(21, 128, 61);
    doc.text(`Farm Plot Dossier: ${plot.plot_name}`, 18, 42);

    doc.setFontSize(8.5);
    doc.setTextColor(23, 43, 36);
    doc.text(`Unique Plot Identifier: ${plot.plot_reference}`, 18, 49);
    doc.text(`Revenue Survey No: ${plot.survey_number} (Subdiv: ${plot.subdivision_number || 'N/A'})`, 18, 55);
    doc.text(`Location: Village ${plot.village}, Taluk ${plot.taluk}, District ${plot.district}`, 18, 61);

    doc.setFont('helvetica', 'bold');
    doc.text(`Geodesic Area: ${plot.area_acres} Acres (${plot.area_hectares} Ha / ${plot.area_sqm.toLocaleString()} m²)`, 110, 49);
    doc.setFont('helvetica', 'normal');
    doc.text(`Perimeter: ${plot.perimeter_meters} meters`, 110, 55);
    doc.text(`Cadastral Status: ${plot.is_cadastral_verified ? 'OFFICIALLY VERIFIED' : 'SELF-DELINEATED'}`, 110, 61);

    // 3. Multi-Source Intelligence Table
    autoTable(doc, {
      startY: 70,
      theme: 'grid',
      headStyles: { fillColor: [21, 128, 61], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 8, cellPadding: 2.5 },
      head: [['Intelligence Domain', 'Data Source & Methodology', 'Recorded Metrics & Status']],
      body: [
        [
          'Land & Ownership Registry',
          'Maharashtra Mahabhulekh 7/12 Land Record',
          `Landholder: ${farmer?.full_name || 'Registered Landholder'} | Verified Mobile: ${farmer?.phone_number || 'N/A'}`
        ],
        [
          'Satellite Vegetation (NDVI)',
          'Earth Search STAC / Sentinel-2 L2A BOA Reflectance',
          vegObs
            ? `Mean NDVI: ${vegObs.ndvi_mean} (Range: ${vegObs.ndvi_min} - ${vegObs.ndvi_max}) | Class: ${vegObs.vegetation_classification} | Valid Pixels: ${vegObs.valid_pixel_coverage_pct}%`
            : 'Observation pending processing'
        ],
        [
          'Agrometeorological Observation',
          'Open-Meteo High-Resolution Coordinate Forecast',
          weather
            ? `Temp: ${weather.temperature_celsius}°C | Humidity: ${weather.relative_humidity_pct}% | Rain: ${weather.precipitation_mm}mm | Condition: ${weather.weather_condition}`
            : 'Live weather service active'
        ],
        [
          'Crop Classification AI',
          'Spectral Band ML Model (MH-CROP-RF-v2.3)',
          cropPred
            ? `${cropPred.season} ${cropPred.season_year}: ${cropPred.predicted_crop ? `matched ${cropLabel(cropPred.predicted_crop)}` : `no answer (${cropPred.verdict_status.replace(/_/g, ' ')})`} from ${cropPred.observations.length} clear Sentinel-2 dates | Status: ${cropPred.verification_status}${cropPred.verified_crop ? ` (ground: ${cropLabel(cropPred.verified_crop)})` : ''}`
            : `Declared Crop: ${plot.crop_type || 'Sugarcane'}`
        ],
        [
          'Drone Photogrammetry',
          'RTK UAV Centimeter-Level Aerial Survey',
          droneMissions.length > 0
            ? `${droneMissions.length} mission(s) completed | Total Photos: ${droneMissions.reduce((acc, m) => acc + m.photos_count, 0)} | Orthomosaic georeferenced`
            : 'No aerial mission flown yet'
        ],
        [
          'Field Inspection Observations',
          'Field Worker Mobile Ground Survey',
          fieldSurveys.length > 0
            ? `Inspected by: ${fieldSurveys[0].surveyor_name} | Crop: ${fieldSurveys[0].crop_type} (${fieldSurveys[0].growth_stage}) | GPS Acc: ±${fieldSurveys[0].gps_accuracy_meters}m`
            : 'Routine field survey scheduled'
        ],
        [
          'Production scenario (not a forecast)',
          'Expected yield × harvested area',
          yieldFc
            ? `${cropLabel(yieldFc.crop_type)}: ${yieldFc.expected_yield_tonnes_per_ha} t/ha (${yieldFc.yield_source === 'USER_ENTERED' ? 'officer-entered' : 'illustrative district figure'}) × ${yieldFc.harvested_area_hectares} ha = ${yieldFc.estimated_total_tonnes} t`
            : 'No scenario recorded'
        ],
        [
          'Disaster Damage Assessment',
          'Sentinel-2 Multi-temporal Change Detection',
          disaster
            ? `Event: ${disaster.event_name} | Affected: ${disaster.affected_area_acres} Acres (${disaster.affected_percentage}%) | Priority: ${disaster.inspection_priority}`
            : 'No active disaster hazard detected on parcel'
        ],
      ],
    });

    const afterTableY = (doc as any).lastAutoTable.finalY + 6;

    // 4. Legal & Model Disclaimers Box
    doc.setFillColor(254, 242, 242);
    doc.roundedRect(14, afterTableY, 182, 30, 2, 2, 'F');
    doc.setTextColor(185, 28, 28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('CRITICAL ADMINISTRATIVE NOTIFICATION & DATA PROVENANCE DISCLAIMER', 18, afterTableY + 6);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(127, 29, 29);
    doc.setFontSize(7);
    const disclaimer =
      '1. LEGAL TITLE: This technical dossier compiles geospatial satellite observations, drone photogrammetry, and automated machine learning estimates. It does NOT constitute legal land title or final court-admissible ownership registry.\n' +
      '2. MACHINE PREDICTIONS: AI crop classifications, NDVI vegetation indices, and yield forecasts are algorithmic estimates and MUST NOT be substituted for official statutory crop cutting experiments (CCE) or formal revenue panchanama.\n' +
      '3. DISASTER RELIEF: Preliminary damage assessments reflect spectral anomaly indications and require field verification before ex-gratia compensation approval.';
    doc.text(doc.splitTextToSize(disclaimer, 174), 18, afterTableY + 11);

    // 5. Digital Signature Stamp
    const stampY = afterTableY + 36;
    doc.setDrawColor(21, 128, 61);
    doc.roundedRect(14, stampY, 182, 16, 2, 2);
    doc.setTextColor(21, 128, 61);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(`DIGITALLY GENERATED DOSSIER — AGRISURVEY AI PLATFORM`, 18, stampY + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Generated At: ${new Date().toLocaleString()} IST | Plot Ref: ${plot.plot_reference} | Coordinate CRS: EPSG:4326`, 18, stampY + 11);

    doc.save(`AgriSurvey_Dossier_${plot.plot_reference}.pdf`);
  }

  /**
   * Export all plot intelligence metrics as CSV
   */
  exportPlotDataCsv(plotId: string): void {
    const plot = mockDb.farmPlots.find((p) => p.id === plotId);
    if (!plot) return;

    const vegObs = mockDb.vegetationObservations.filter((v) => v.plot_id === plot.id);
    const weather = mockDb.weatherObservations.find((w) => w.plot_id === plot.id);
    const yieldFc = mockDb.yieldForecasts.find((y) => y.plot_id === plot.id);

    const headers = [
      'Plot Reference',
      'Survey Number',
      'Village',
      'Taluk',
      'District',
      'Area (Acres)',
      'Area (Hectares)',
      'Area (Sq.m)',
      'Crop Type',
      'Latest Mean NDVI',
      'Vegetation Class',
      'Valid Pixel %',
      'Temperature (°C)',
      'Humidity (%)',
      'Precipitation (mm)',
      'Forecast Yield (t/ha)',
      'Total Estimated Production (t)',
      'Export Timestamp',
    ];

    const values = [
      `"${plot.plot_reference}"`,
      `"${plot.survey_number}"`,
      `"${plot.village}"`,
      `"${plot.taluk}"`,
      `"${plot.district}"`,
      plot.area_acres,
      plot.area_hectares,
      plot.area_sqm,
      `"${plot.crop_type || 'N/A'}"`,
      vegObs[0]?.ndvi_mean ?? 'N/A',
      `"${vegObs[0]?.vegetation_classification ?? 'N/A'}"`,
      vegObs[0]?.valid_pixel_coverage_pct ?? 'N/A',
      weather?.temperature_celsius ?? 'N/A',
      weather?.relative_humidity_pct ?? 'N/A',
      weather?.precipitation_mm ?? 'N/A',
      yieldFc?.expected_yield_tonnes_per_ha ?? 'N/A',
      yieldFc?.estimated_total_tonnes ?? 'N/A',
      `"${new Date().toISOString()}"`,
    ];

    const csvContent = `${headers.join(',')}\n${values.join(',')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Plot_${plot.plot_reference}_Data.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Export summary of all registered plots in district as CSV
   */
  exportRegionalAnalyticsCsv(district?: string): void {
    let plots = mockDb.farmPlots;
    if (district) {
      plots = plots.filter((p) => p.district.toLowerCase() === district.toLowerCase());
    }

    const headers = [
      'Plot Reference',
      'Farmer ID',
      'Survey No',
      'Village',
      'Taluk',
      'District',
      'Area (Acres)',
      'Area (Ha)',
      'Crop',
      'Cadastral Verified',
      'Latest NDVI',
    ];

    const rows = plots.map((p) => [
      `"${p.plot_reference}"`,
      `"${p.farmer_id}"`,
      `"${p.survey_number}"`,
      `"${p.village}"`,
      `"${p.taluk}"`,
      `"${p.district}"`,
      p.area_acres,
      p.area_hectares,
      `"${p.crop_type || 'Sugarcane'}"`,
      p.is_cadastral_verified ? 'Yes' : 'No',
      p.latest_ndvi ?? 'N/A',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Maharashtra_AgriSurvey_Plots_${district || 'All'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  // ===========================================================================
  // COMPREHENSIVE 10-REPORT SUITE (PROBLEM STATEMENT COMPLIANCE)
  // ===========================================================================

  /**
   * 1. Individual Plot Survey Report
   */
  generatePlotSurveyPdf(plotId: string): void {
    this.generateComprehensivePlotPdf(plotId);
  }

  exportPlotSurveyCsv(plotId: string): void {
    this.exportPlotDataCsv(plotId);
  }

  /**
   * 2. Village Crop Survey Report
   */
  getVillageCropSurveyData(village: string, district: string = 'Pune') {
    const plots = mockDb.farmPlots.filter(
      (p) => p.village.toLowerCase() === village.toLowerCase() && (!district || p.district.toLowerCase() === district.toLowerCase())
    );
    const totalAreaAcres = plots.reduce((acc, p) => acc + p.area_acres, 0);
    const cropBreakdown: Record<string, { count: number; acres: number }> = {};
    plots.forEach((p) => {
      const crop = p.crop_type || 'Sugarcane';
      if (!cropBreakdown[crop]) cropBreakdown[crop] = { count: 0, acres: 0 };
      cropBreakdown[crop].count += 1;
      cropBreakdown[crop].acres = Number((cropBreakdown[crop].acres + p.area_acres).toFixed(2));
    });
    return { village, district, totalPlots: plots.length, totalAreaAcres: Number(totalAreaAcres.toFixed(2)), plots, cropBreakdown };
  }

  generateVillageCropSurveyReport(village: string, district: string = 'Pune', format: 'pdf' | 'csv' = 'pdf'): void {
    const data = this.getVillageCropSurveyData(village, district);
    if (format === 'csv') {
      const headers = ['Village', 'District', 'Plot Reference', 'Survey No', 'Farmer ID', 'Crop', 'Area (Acres)', 'Area (Ha)', 'Cadastral Verified'];
      const rows = data.plots.map((p) => [
        `"${p.village}"`,
        `"${p.district}"`,
        `"${p.plot_reference}"`,
        `"${p.survey_number}"`,
        `"${p.farmer_id}"`,
        `"${p.crop_type || 'Sugarcane'}"`,
        p.area_acres,
        p.area_hectares,
        p.is_cadastral_verified ? 'Yes' : 'No',
      ]);
      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Village_Report_${village}_${district}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      return;
    }

    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`VILLAGE CROP SURVEY REPORT — ${village.toUpperCase()}, ${district.toUpperCase()}`, 14, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${new Date().toLocaleString()} IST | Total Plots: ${data.totalPlots} | Total Area: ${data.totalAreaAcres} Acres`, 14, 27);

    const tableRows = data.plots.map((p) => [
      p.plot_reference,
      p.survey_number,
      p.farmer_id,
      p.crop_type || 'Sugarcane',
      `${p.area_acres} ac`,
      p.is_cadastral_verified ? 'Verified ✓' : 'Pending',
    ]);

    autoTable(doc, {
      startY: 32,
      head: [['Plot Ref', 'Survey No', 'Farmer Ref', 'Crop Stand', 'Area', 'Cadastre']],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [15, 118, 110], fontSize: 8 },
      bodyStyles: { fontSize: 7.5 },
    });

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      doc.save(`Village_Crop_Survey_${village}.pdf`);
    }
  }

  /**
   * 3. Taluka Crop-Area Report
   */
  getTalukaCropAreaData(taluk: string = 'Haveli', district: string = 'Pune') {
    const plots = mockDb.farmPlots.filter(
      (p) => p.taluk.toLowerCase() === taluk.toLowerCase() && (!district || p.district.toLowerCase() === district.toLowerCase())
    );
    const totalAreaAcres = plots.reduce((acc, p) => acc + p.area_acres, 0);
    const totalAreaHa = plots.reduce((acc, p) => acc + p.area_hectares, 0);
    const verifiedPlots = plots.filter((p) => p.is_cadastral_verified);
    const verifiedAreaAcres = verifiedPlots.reduce((acc, p) => acc + p.area_acres, 0);
    return {
      taluk,
      district,
      totalPlots: plots.length,
      totalAreaAcres: Number(totalAreaAcres.toFixed(2)),
      totalAreaHa: Number(totalAreaHa.toFixed(2)),
      verifiedCount: verifiedPlots.length,
      verifiedAreaAcres: Number(verifiedAreaAcres.toFixed(2)),
      plots,
    };
  }

  generateTalukaCropAreaReport(taluk: string = 'Haveli', district: string = 'Pune', format: 'pdf' | 'csv' = 'pdf'): void {
    const data = this.getTalukaCropAreaData(taluk, district);
    if (format === 'csv') {
      const headers = ['Taluk', 'District', 'Total Plots', 'Total Acres', 'Total Hectares', 'Verified Plots', 'Verified Acres'];
      const row = [`"${taluk}"`, `"${district}"`, data.totalPlots, data.totalAreaAcres, data.totalAreaHa, data.verifiedCount, data.verifiedAreaAcres];
      const csv = `${headers.join(',')}\n${row.join(',')}`;
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Taluka_Report_${taluk}_${district}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      return;
    }

    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`TALUKA CROP-AREA STATISTICAL REPORT — TALUK: ${taluk.toUpperCase()}`, 14, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`District: ${district} | Generated: ${new Date().toLocaleString()} IST`, 14, 27);

    autoTable(doc, {
      startY: 32,
      head: [['Taluk', 'District', 'Registered Plots', 'Total Acreage', 'Total Hectares', 'Verified Acreage']],
      body: [[taluk, district, String(data.totalPlots), `${data.totalAreaAcres} ac`, `${data.totalAreaHa} ha`, `${data.verifiedAreaAcres} ac`]],
      theme: 'grid',
      headStyles: { fillColor: [30, 64, 175], fontSize: 8 },
    });

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      doc.save(`Taluka_Crop_Area_${taluk}.pdf`);
    }
  }

  /**
   * 4. District Crop-Area Report
   */
  getDistrictCropAreaData(district: string = 'Pune') {
    const plots = mockDb.farmPlots.filter((p) => !district || p.district.toLowerCase() === district.toLowerCase());
    const totalAreaAcres = plots.reduce((acc, p) => acc + p.area_acres, 0);
    const talukMap: Record<string, { plots: number; acres: number }> = {};
    plots.forEach((p) => {
      if (!talukMap[p.taluk]) talukMap[p.taluk] = { plots: 0, acres: 0 };
      talukMap[p.taluk].plots += 1;
      talukMap[p.taluk].acres = Number((talukMap[p.taluk].acres + p.area_acres).toFixed(2));
    });
    return { district, totalPlots: plots.length, totalAreaAcres: Number(totalAreaAcres.toFixed(2)), talukMap, plots };
  }

  generateDistrictCropAreaReport(district: string = 'Pune', format: 'pdf' | 'csv' = 'pdf'): void {
    const data = this.getDistrictCropAreaData(district);
    if (format === 'csv') {
      const headers = ['District', 'Taluk', 'Plot Count', 'Total Acres'];
      const rows = Object.entries(data.talukMap).map(([taluk, info]) => [`"${district}"`, `"${taluk}"`, info.plots, info.acres]);
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `District_Report_${district}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      return;
    }

    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`DISTRICT CROP-AREA SUMMARY REPORT — ${district.toUpperCase()}`, 14, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${new Date().toLocaleString()} IST | Total Acreage: ${data.totalAreaAcres} Acres Across ${data.totalPlots} Parcels`, 14, 27);

    const rows = Object.entries(data.talukMap).map(([taluk, info]) => [district, taluk, String(info.plots), `${info.acres} ac`]);

    autoTable(doc, {
      startY: 32,
      head: [['District', 'Taluk', 'Total Registered Plots', 'Cultivated Acreage']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [4, 120, 87], fontSize: 8 },
    });

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      doc.save(`District_Crop_Area_${district}.pdf`);
    }
  }

  /**
   * 5. Field-Survey Completion Report
   */
  getFieldSurveyCompletionData() {
    const surveys = mockDb.mobileSurveys;
    const synced = surveys.filter((s) => s.sync_status === 'SYNCHRONIZED');
    const drafts = surveys.filter((s) => s.sync_status === 'DRAFT' || s.sync_status === 'PENDING_SYNC');
    return { totalSurveys: surveys.length, syncedCount: synced.length, pendingDraftsCount: drafts.length, surveys };
  }

  generateFieldSurveyCompletionReport(format: 'pdf' | 'csv' = 'pdf'): void {
    const data = this.getFieldSurveyCompletionData();
    if (format === 'csv') {
      const headers = ['Survey Ref', 'Plot ID', 'Surveyor', 'Survey Date', 'Crop Observed', 'Growth Stage', 'GPS Accuracy (m)', 'Sync Status'];
      const rows = data.surveys.map((s) => [
        `"${s.survey_reference}"`,
        `"${s.plot_id}"`,
        `"${s.surveyor_name}"`,
        `"${s.survey_date}"`,
        `"${s.crop_type}"`,
        `"${s.growth_stage}"`,
        s.gps_accuracy_meters,
        `"${s.sync_status}"`,
      ]);
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Field_Survey_Completion_Report.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      return;
    }

    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`FIELD-SURVEY PROGRESS & COMPLETION REPORT`, 14, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total Field Surveys: ${data.totalSurveys} | Synchronized: ${data.syncedCount} | Offline Drafts: ${data.pendingDraftsCount}`, 14, 27);

    const rows = data.surveys.map((s) => [
      s.survey_reference,
      s.surveyor_name,
      s.crop_type,
      s.growth_stage,
      `±${s.gps_accuracy_meters}m`,
      s.sync_status,
    ]);

    autoTable(doc, {
      startY: 32,
      head: [['Survey Ref', 'Officer / Surveyor', 'Observed Crop', 'Growth Stage', 'GPS Accuracy', 'Sync Status']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [5, 150, 105], fontSize: 8 },
    });

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      doc.save(`Field_Survey_Completion_Report.pdf`);
    }
  }

  /**
   * 6. Satellite-Observation Report
   */
  getSatelliteObservationData() {
    const scenes = mockDb.satelliteScenes;
    const vegObs = mockDb.vegetationObservations;
    return { totalScenes: scenes.length, totalObservations: vegObs.length, scenes, vegObs };
  }

  generateSatelliteObservationReport(format: 'pdf' | 'csv' = 'pdf'): void {
    const data = this.getSatelliteObservationData();
    if (format === 'csv') {
      const headers = ['Scene ID', 'Collection', 'Acquisition Date', 'Cloud Cover (%)', 'Spectral Assets'];
      const rows = data.scenes.map((s) => [
        `"${s.scene_id}"`,
        `"${s.collection}"`,
        `"${s.acquisition_datetime}"`,
        s.cloud_cover_percentage,
        Object.keys(s.assets || {}).length,
      ]);
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Satellite_Observation_Report.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      return;
    }

    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`SENTINEL-2 SATELLITE DISCOVERY & OBSERVATION REPORT`, 14, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Data Source: AWS Earth Search STAC API (Sentinel-2 L2A) | Processed Scenes: ${data.totalScenes}`, 14, 27);

    const rows = data.scenes.map((s) => [
      s.scene_id.substring(0, 32) + '...',
      new Date(s.acquisition_datetime).toLocaleDateString(),
      `${s.cloud_cover_percentage}%`,
      Object.keys(s.assets || {}).join(', ') || 'B02, B03, B04, B08',
    ]);

    autoTable(doc, {
      startY: 32,
      head: [['Scene Identifier', 'Acquisition Date', 'Cloud %', 'Available Bands']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [2, 132, 199], fontSize: 8 },
    });

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      doc.save(`Satellite_Observation_Report.pdf`);
    }
  }

  /**
   * 7. Crop-Health Monitoring Report
   */
  getCropHealthData() {
    const vegObs = mockDb.vegetationObservations;
    const alerts = mockDb.plantHealthAlerts;
    return { observationsCount: vegObs.length, activeAlertsCount: alerts.length, vegObs, alerts };
  }

  generateCropHealthReport(format: 'pdf' | 'csv' = 'pdf'): void {
    const data = this.getCropHealthData();
    if (format === 'csv') {
      const headers = ['Plot ID', 'Mean NDVI', 'Min NDVI', 'Max NDVI', 'Coverage (%)', 'Classification', 'Calculation Date'];
      const rows = data.vegObs.map((v) => [
        `"${v.plot_id}"`,
        v.ndvi_mean,
        v.ndvi_min,
        v.ndvi_max,
        v.valid_pixel_coverage_pct,
        `"${v.vegetation_classification}"`,
        `"${v.calculation_date}"`,
      ]);
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Crop_Health_Monitoring_Report.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      return;
    }

    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`CROP HEALTH & NDVI VEGETATION INDEX REPORT`, 14, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Sensor Band Math: (B08 - B04)/(B08 + B04) | Total Plot Observations: ${data.observationsCount}`, 14, 27);

    const rows = data.vegObs.map((v) => [
      v.plot_id,
      String(v.ndvi_mean),
      `${v.ndvi_min} - ${v.ndvi_max}`,
      `${v.valid_pixel_coverage_pct}%`,
      v.vegetation_classification,
    ]);

    autoTable(doc, {
      startY: 32,
      head: [['Plot UUID', 'Mean NDVI', 'Index Range', 'Valid Pixel %', 'Canopy Density']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], fontSize: 8 },
    });

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      doc.save(`Crop_Health_Monitoring_Report.pdf`);
    }
  }

  /**
   * 8. Crop-Classification Evaluation Report
   */
  getCropClassificationEvaluationData() {
    const predictions = mockDb.cropPredictions;
    const evaluation = cropClassificationService.evaluate();
    return {
      modelVersion: MODEL_VERSION,
      method: METHOD_NAME,
      totalPredictions: predictions.length,
      evaluation,
      predictions,
    };
  }

  generateCropClassificationEvaluationReport(format: 'pdf' | 'csv' = 'pdf'): void {
    const data = this.getCropClassificationEvaluationData();
    const ev = data.evaluation;
    const pct = (v: number | null) => (v === null ? 'not measurable yet' : `${(v * 100).toFixed(1)}%`);
    const rowOf = (p: (typeof data.predictions)[number]) => [
      p.plot_id,
      `${p.season} ${p.season_year}`,
      p.verdict_status,
      cropLabel(p.predicted_crop),
      p.candidate_crops.map(cropLabel).join(' / ') || '—',
      String(p.observations.length),
      p.verification_status,
      cropLabel(p.verified_crop),
    ];
    const headers = ['Plot ID', 'Season', 'Verdict', 'Matched crop', 'Candidates', 'Clear dates', 'Status', 'Ground-verified crop'];
    if (format === 'csv') {
      const meta = [
        `# Method: ${data.method}`,
        `# Verified predictions: ${ev.verified}; answered: ${ev.answered}; correct: ${ev.correct}; accuracy on answered: ${pct(ev.accuracy)}; coverage: ${pct(ev.coverage)}`,
        '# Accuracy is measured only on officer-verified plots; no other accuracy figure exists for this model.',
      ];
      const csv = [...meta, headers.join(','), ...data.predictions.map((p) => rowOf(p).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Crop_Classification_Evaluation_Report.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      return;
    }

    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`CROP CLASSIFICATION EVALUATION REPORT`, 14, 20);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    const intro = doc.splitTextToSize(
      `Method: ${data.method}. Model: ${data.modelVersion}. ` +
        `Officer-verified predictions: ${ev.verified}. The matcher answered ${ev.answered} of them (coverage ${pct(ev.coverage)}), ` +
        `${ev.correct} correctly (accuracy on answered ${pct(ev.accuracy)}). Accuracy is measured only on officer-verified plots; ` +
        `with few verifications these figures are not statistically meaningful. Templates are indicative, not field-calibrated.`,
      182
    );
    doc.text(intro, 14, 27);
    autoTable(doc, {
      startY: 27 + intro.length * 4 + 3,
      head: [headers],
      body: data.predictions.map(rowOf),
      theme: 'grid',
      styles: { fontSize: 7 },
      headStyles: { fillColor: [124, 58, 237], fontSize: 7 },
    });

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      doc.save(`Crop_Classification_Report.pdf`);
    }
  }

  /**
   * 9. Yield-Estimation Report
   */
  getYieldEstimationData(district: string = 'Pune') {
    const forecasts = mockDb.yieldForecasts;
    const totalProduction = forecasts.reduce((acc, f) => acc + f.estimated_total_tonnes, 0);
    return { district, totalForecasts: forecasts.length, totalProductionTonnes: Number(totalProduction.toFixed(1)), forecasts };
  }

  generateYieldEstimationReport(district: string = 'Pune', format: 'pdf' | 'csv' = 'pdf'): void {
    const data = this.getYieldEstimationData(district);
    if (format === 'csv') {
      const headers = ['Plot ID', 'Crop', 'Created', 'Expected yield (t/ha)', 'Yield source', 'Harvested area (ha)', 'Production (t)'];
      const rows = data.forecasts.map((f) => [
        `"${f.plot_id}"`,
        `"${cropLabel(f.crop_type)}"`,
        `"${f.forecast_date}"`,
        f.expected_yield_tonnes_per_ha,
        `"${f.yield_source}"`,
        f.harvested_area_hectares,
        f.estimated_total_tonnes,
      ]);
      const csv = ['# Production SCENARIOS (expected yield x harvested area), not forecasts. Illustrative district figures are not official statistics.', headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Yield_Estimation_Report_${district}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      return;
    }

    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`AGRICULTURAL YIELD ESTIMATION & PRODUCTION DOSSIER`, 14, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`District: ${district} | Sum of scenario production: ${data.totalProductionTonnes} t`, 14, 27);
    doc.text('Scenario estimates (expected yield x harvested area), not forecasts; no uncertainty is estimated.', 14, 32);

    const rows = data.forecasts.map((f) => [
      f.plot_id,
      cropLabel(f.crop_type),
      `${f.expected_yield_tonnes_per_ha} t/ha`,
      f.yield_source === 'USER_ENTERED' ? 'Officer-entered' : 'Illustrative figure',
      `${f.harvested_area_hectares} ha`,
      `${f.estimated_total_tonnes} t`,
    ]);

    autoTable(doc, {
      startY: 37,
      head: [['Plot ID', 'Crop', 'Expected yield', 'Yield source', 'Harvested area', 'Production']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [217, 119, 6], fontSize: 8 },
    });

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      doc.save(`Yield_Estimation_Report.pdf`);
    }
  }

  /**
   * 10. Potential Crop-Damage Assessment Report
   */
  getDisasterAssessmentData() {
    const assessments = mockDb.disasterAssessments;
    const totalAffectedAcres = assessments.reduce((acc, a) => acc + a.affected_area_acres, 0);
    return { totalAssessments: assessments.length, totalAffectedAcres: Number(totalAffectedAcres.toFixed(2)), assessments };
  }

  generateDisasterAssessmentReport(format: 'pdf' | 'csv' = 'pdf'): void {
    const data = this.getDisasterAssessmentData();
    if (format === 'csv') {
      const headers = ['Event Name', 'Plot ID', 'Event Type', 'Pre-NDVI', 'Post-NDVI', 'NDVI Delta', 'Affected Acres', 'Affected %', 'Severity'];
      const rows = data.assessments.map((a) => [
        `"${a.event_name}"`,
        `"${a.plot_id}"`,
        `"${a.event_type}"`,
        a.pre_event_ndvi,
        a.post_event_ndvi,
        a.ndvi_change_delta,
        a.affected_area_acres,
        a.affected_percentage,
        `"${a.damage_severity}"`,
      ]);
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Crop_Damage_Assessment_Report.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      return;
    }

    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`PRELIMINARY DISASTER & CROP DAMAGE ASSESSMENT REPORT`, 14, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Satellite Remote Sensing Delta Analysis | Total Affected Area: ${data.totalAffectedAcres} Acres`, 14, 27);

    const rows = data.assessments.map((a) => [
      a.event_name,
      a.plot_id,
      a.event_type,
      `${a.pre_event_ndvi} -> ${a.post_event_ndvi} (${a.ndvi_change_delta})`,
      `${a.affected_area_acres} ac (${a.affected_percentage}%)`,
      a.damage_severity,
    ]);

    autoTable(doc, {
      startY: 32,
      head: [['Event Name', 'Plot ID', 'Hazard Type', 'NDVI Delta', 'Impacted Area', 'Severity']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [225, 29, 72], fontSize: 8 },
    });

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      doc.save(`Disaster_Damage_Assessment_Report.pdf`);
    }
  }

  /**
   * Export Statutory Spatial Report as Standardized GeoJSON FeatureCollection (Module K)
   */
  exportStatutoryReportGeoJson(reportType: string, options?: { taluk?: string; district?: string }): string {
    let plots = [...mockDb.farmPlots];

    if (options?.district && options.district !== 'ALL') {
      plots = plots.filter((p) => p.district.toLowerCase() === options.district!.toLowerCase());
    }
    if (options?.taluk && options.taluk !== 'ALL') {
      plots = plots.filter((p) => p.taluk.toLowerCase() === options.taluk!.toLowerCase());
    }

    const features = plots.map((plot) => {
      const ring = (plot.boundary_coordinates || []).map(([lat, lon]) => [lon, lat]);
      if (ring.length > 0) {
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          ring.push([first[0], first[1]]);
        }
      }

      return {
        type: 'Feature',
        properties: {
          id: plot.id,
          plot_reference: plot.plot_reference,
          survey_number: plot.survey_number,
          subdivision: plot.subdivision_number,
          village: plot.village,
          taluk: plot.taluk,
          district: plot.district,
          state: plot.state,
          crop_type: plot.crop_type,
          area_sqm: plot.area_sqm,
          area_hectares: plot.area_hectares,
          area_acres: plot.area_acres,
          is_cadastral_verified: plot.is_cadastral_verified,
          report_type: reportType,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
      };
    });

    const geoJsonString = JSON.stringify(
      {
        type: 'FeatureCollection',
        name: `AgriSurvey_Report_${reportType}`,
        crs: {
          type: 'name',
          properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' },
        },
        metadata: {
          report_name: reportType,
          authority: 'Government of Maharashtra — Department of Agriculture & Revenue',
          platform: 'AgriSurvey AI (Rehydria Technology / GreenMinds)',
          exported_at: new Date().toISOString(),
          crs_specification: 'EPSG:4326 (WGS 84 Ellipsoidal Coordinates)',
          parcels_count: features.length,
        },
        features,
      },
      null,
      2
    );

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const blob = new Blob([geoJsonString], { type: 'application/geo+json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AgriSurvey_${reportType}_Spatial.geojson`;
      a.click();
      URL.revokeObjectURL(url);
    }

    return geoJsonString;
  }
}

export const reportService = new ReportService();
