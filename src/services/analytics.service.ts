import { mockDb } from './mock-db';
import { AuditLog, StaffRegion } from '@/types';
import { computeNetNonOverlappingArea } from '@/lib/geospatial';

export interface DashboardStats {
  totalFarmers: number;
  totalProperties: number;
  pendingRegistrations: number;
  approvedRegistrations: number;
  rejectedRegistrations: number;
  pendingInspections: number;
  droneReportsAwaitingReview: number;
  completedVerifications: number;
  totalLandAreaAcres: number;
}

export interface GovernmentDecisionMetrics {
  kharifAcreageMapped: number;
  rabiAcreageMapped: number;
  subsidyVerificationRatePct: number;
  discrepanciesCount: number;
  criticalDamageHectares: number;
  highStressMoistureHectares: number;
  pendingInspectionBacklog: number;
  avgResolutionTurnaroundDays: number;
  nonOverlappingNetAreaHa: number;
  overlapAvoidedHa: number;
  pilotZonesCoverage: Record<string, { plotsCount: number; areaAcres: number; verifiedAcres: number }>;
}

export class AnalyticsService {
  async getDashboardStats(): Promise<DashboardStats> {
    const totalFarmers = mockDb.profiles.filter((p) => p.role === 'farmer').length;
    const totalProperties = mockDb.properties.length;
    const pendingRegistrations = mockDb.applications.filter((a) => a.status === 'PENDING_TAHSILDAR_REVIEW').length;
    const approvedRegistrations = mockDb.applications.filter((a) => a.status === 'APPROVED').length;
    const rejectedRegistrations = mockDb.applications.filter((a) => a.status === 'REJECTED').length;
    const pendingInspections = mockDb.inspections.filter((i) => i.inspection_status === 'ASSIGNED' || i.inspection_status === 'SCHEDULED' || i.inspection_status === 'IN_PROGRESS').length;
    const droneReportsAwaitingReview = mockDb.inspections.filter((i) => i.inspection_status === 'EVIDENCE_UPLOADED' || i.inspection_status === 'SUBMITTED_FOR_REVIEW').length;
    const completedVerifications = mockDb.reports.filter((r) => r.final_status === 'VERIFIED').length;
    const totalLandAreaAcres = mockDb.farmPlots.length > 0
      ? mockDb.farmPlots.reduce((acc, p) => acc + (p.area_acres || 0), 0)
      : mockDb.properties.reduce((acc, p) => acc + Number(p.land_area || 0), 0);

    return {
      totalFarmers,
      totalProperties,
      pendingRegistrations,
      approvedRegistrations,
      rejectedRegistrations,
      pendingInspections,
      droneReportsAwaitingReview,
      completedVerifications,
      totalLandAreaAcres: Math.round(totalLandAreaAcres * 10) / 10,
    };
  }

  async getRegistrationsOverTime(): Promise<Array<{ month: string; applications: number; verified: number }>> {
    const monthBuckets: Record<string, { applications: number; verified: number }> = {
      'Oct 2025': { applications: 14, verified: 10 },
      'Nov 2025': { applications: 28, verified: 22 },
      'Dec 2025': { applications: 45, verified: 38 },
      'Jan 2026': { applications: 62, verified: 51 },
      'Feb 2026': { applications: 84, verified: 72 },
      'Mar 2026': { applications: 98, verified: 85 },
    };

    // Incorporate dynamic application and report records
    for (const app of mockDb.applications) {
      if (app.submitted_at) {
        const d = new Date(app.submitted_at);
        const mKey = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        if (monthBuckets[mKey]) {
          monthBuckets[mKey].applications++;
        }
      }
    }

    for (const rep of mockDb.reports) {
      if (rep.created_at && rep.final_status === 'VERIFIED') {
        const d = new Date(rep.created_at);
        const mKey = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        if (monthBuckets[mKey]) {
          monthBuckets[mKey].verified++;
        }
      }
    }

    return Object.entries(monthBuckets).map(([month, data]) => ({
      month,
      applications: data.applications,
      verified: data.verified,
    }));
  }

  async getDistrictDistribution(): Promise<Array<{ district: string; acres: number; properties: number }>> {
    const talukMap: Record<string, { acres: number; count: number }> = {};

    for (const plot of mockDb.farmPlots) {
      const key = `${plot.district} (${plot.taluk})`;
      if (!talukMap[key]) {
        talukMap[key] = { acres: 0, count: 0 };
      }
      talukMap[key].acres += plot.area_acres || 0;
      talukMap[key].count += 1;
    }

    // Default baseline if mockDb is minimal
    if (Object.keys(talukMap).length === 0) {
      return [
        { district: 'Pune (Haveli)', acres: 245.5, properties: 58 },
        { district: 'Pune (Baramati)', acres: 380.2, properties: 72 },
        { district: 'Pune (Shirur)', acres: 190.8, properties: 41 },
        { district: 'Pune (Daund)', acres: 165.0, properties: 34 },
      ];
    }

    return Object.entries(talukMap).map(([district, data]) => ({
      district,
      acres: Math.round(data.acres * 10) / 10,
      properties: data.count,
    }));
  }

  async getCropDistribution(): Promise<Array<{ name: string; count: number; color: string }>> {
    const cropColors: Record<string, string> = {
      sugarcane: '#15803D',
      soybean: '#0F766E',
      onion: '#0891B2',
      wheat: '#D97706',
      cotton: '#8B5CF6',
      maize: '#EAB308',
      tur: '#F97316',
      jowar: '#64748B',
      rice: '#10B981',
      bajra: '#A855F7',
    };

    const countMap: Record<string, number> = {};

    for (const plot of mockDb.farmPlots) {
      const crop = plot.crop_type || 'Sugarcane';
      const k = crop.split(' ')[0].toLowerCase();
      countMap[k] = (countMap[k] || 0) + 1;
    }

    return Object.entries(countMap).map(([key, count]) => {
      const displayName = key.charAt(0).toUpperCase() + key.slice(1);
      return {
        name: displayName,
        count,
        color: cropColors[key] || '#15803D',
      };
    });
  }

  /**
   * Actionable Intelligence metrics answering 10 Government Policy & Planning Questions
   */
  async getGovernmentDecisionMetrics(): Promise<GovernmentDecisionMetrics> {
    let kharifAcres = 0;
    let rabiAcres = 0;
    let verifiedPlots = 0;

    for (const plot of mockDb.farmPlots) {
      const crop = (plot.crop_type || '').toLowerCase();
      if (crop.includes('wheat') || crop.includes('gram') || crop.includes('onion')) {
        rabiAcres += plot.area_acres || 0;
      } else {
        kharifAcres += plot.area_acres || 0;
      }
      if (plot.is_cadastral_verified) {
        verifiedPlots++;
      }
    }

    const totalPlots = mockDb.farmPlots.length || 1;
    const subsidyVerificationRatePct = Math.round((verifiedPlots / totalPlots) * 100);

    const discrepanciesCount = mockDb.cropPredictions.filter(
      (p) => p.verification_status === 'DISCREPANCY_MARKED' || p.verdict_status === 'ambiguous'
    ).length;

    const criticalDamageHectares = mockDb.disasterAssessments
      .filter((d) => d.damage_severity === 'CRITICAL' || d.damage_severity === 'SEVERE')
      .reduce((acc, d) => acc + (d.affected_area_hectares || 0), 0);

    const highStressMoistureHectares = mockDb.periodObservations
      .filter((o) => o.moisture_stress_indicator === 'SEVERE_MOISTURE_DEFICIT')
      .reduce((acc, o) => {
        const plot = mockDb.farmPlots.find((p) => p.id === o.plot_id);
        return acc + (plot ? plot.area_hectares : 0);
      }, 0);

    const pendingInspectionBacklog = mockDb.inspections.filter(
      (i) => i.inspection_status === 'ASSIGNED' || i.inspection_status === 'SCHEDULED'
    ).length;

    // Deduplication across all polygons
    const polygons = mockDb.farmPlots
      .filter((p) => p.boundary_coordinates && p.boundary_coordinates.length >= 3)
      .map((p) => p.boundary_coordinates);
    const overlapData = computeNetNonOverlappingArea(polygons);

    const pilotZonesCoverage: GovernmentDecisionMetrics['pilotZonesCoverage'] = {};
    for (const taluk of ['Haveli', 'Baramati', 'Shirur', 'Daund']) {
      const talukPlots = mockDb.farmPlots.filter((p) => p.taluk.toLowerCase() === taluk.toLowerCase());
      const totalAcres = talukPlots.reduce((acc, p) => acc + (p.area_acres || 0), 0);
      const verAcres = talukPlots.filter((p) => p.is_cadastral_verified).reduce((acc, p) => acc + (p.area_acres || 0), 0);
      pilotZonesCoverage[taluk] = {
        plotsCount: talukPlots.length,
        areaAcres: Math.round(totalAcres * 10) / 10,
        verifiedAcres: Math.round(verAcres * 10) / 10,
      };
    }

    return {
      kharifAcreageMapped: Math.round(kharifAcres * 10) / 10,
      rabiAcreageMapped: Math.round(rabiAcres * 10) / 10,
      subsidyVerificationRatePct,
      discrepanciesCount,
      criticalDamageHectares: Math.round(criticalDamageHectares * 100) / 100,
      highStressMoistureHectares: Math.round(highStressMoistureHectares * 100) / 100,
      pendingInspectionBacklog,
      avgResolutionTurnaroundDays: 2.8,
      nonOverlappingNetAreaHa: overlapData.netMappedHectares,
      overlapAvoidedHa: Math.round((overlapData.totalOverlapAreaSqm / 10000) * 1000) / 1000,
      pilotZonesCoverage,
    };
  }

  async getAuditLogs(): Promise<AuditLog[]> {
    return mockDb.auditLogs;
  }

  async getStaffRegions(): Promise<StaffRegion[]> {
    return mockDb.staffRegions;
  }
}

export const analyticsService = new AnalyticsService();
