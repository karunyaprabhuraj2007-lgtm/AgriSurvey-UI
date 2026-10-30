import { mockDb } from './mock-db';
import { firebaseService } from './firebase.service';
import { CropVerification, ImageComparison, ComparisonResultType } from '@/types';
import { CropVerificationFormData } from '@/lib/validators';

export interface AiCropAnalysisResult {
  isConfigured: boolean;
  statusMessage: string;
  prediction?: {
    cropName: string;
    botanicalName?: string;
    category?: string;
    confidence: number;
    vegetationIndexNdvi: number | null;
    canopyDensity?: string;
    suggestedVerification?: 'MATCHES' | 'PARTIALLY_MATCHES' | 'DOES_NOT_MATCH';
  };
}

export class CropVerificationService {
  async getCropVerification(applicationId: string): Promise<CropVerification | null> {
    return mockDb.cropVerifications.find((c) => c.application_id === applicationId) || null;
  }

  async getImageComparison(applicationId: string): Promise<ImageComparison | null> {
    return mockDb.comparisons.find((c) => c.application_id === applicationId) || null;
  }

  async saveImageComparison(params: {
    applicationId: string;
    propertyId: string;
    comparisonResult: ComparisonResultType;
    reviewNotes: string;
    similarityScore?: number;
  }): Promise<ImageComparison> {
    const existing = mockDb.comparisons.find((c) => c.application_id === params.applicationId);
    if (existing) {
      existing.comparison_result = params.comparisonResult;
      existing.review_notes = params.reviewNotes;
      // Only a measured score is stored; there is no automated image-matching model yet
      existing.similarity_score = params.similarityScore ?? null;
      existing.similarity_model_version = params.similarityScore != null ? existing.similarity_model_version : null;
      existing.reviewed_at = new Date().toISOString();
      mockDb.persistAll();
      if (firebaseService.isConfigured) {
        firebaseService.saveDocument('image_comparisons', existing.id, existing);
      }
      return existing;
    }

    const comparison: ImageComparison = {
      id: `cmp-${Date.now()}`,
      application_id: params.applicationId,
      property_id: params.propertyId,
      comparison_result: params.comparisonResult,
      similarity_score: params.similarityScore ?? null,
      similarity_model_version: null,
      review_notes: params.reviewNotes,
      reviewed_by: mockDb.currentUser.id,
      reviewed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    mockDb.comparisons.push(comparison);
    mockDb.addAuditLog(
      'IMAGE_COMPARISON_RECORDED',
      'image_comparisons',
      comparison.id,
      null,
      { result: params.comparisonResult, notes: params.reviewNotes }
    );

    mockDb.persistAll();
    if (firebaseService.isConfigured) {
      firebaseService.saveDocument('image_comparisons', comparison.id, comparison);
    }
    return comparison;
  }

  async runAiCropAnalysis(imageUrl?: string): Promise<AiCropAnalysisResult> {
    const env = typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env : {};
    const apiKey = env.CROP_ANALYSIS_API_KEY;
    const apiUrl = env.CROP_ANALYSIS_API_URL;

    if (!apiKey || !apiUrl) {
      return {
        isConfigured: false,
        statusMessage: 'No image-based crop analysis service is connected, so nothing was analysed. Complete the verification manually; satellite crop identification for a plot is available in GIS Crop Survey.',
      };
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ image_url: imageUrl }),
      });

      if (!response.ok) {
        return {
          isConfigured: true,
          statusMessage: 'AI service endpoint returned an error. Proceed with manual verification.',
        };
      }

      const data = await response.json();
      // Only report what the service actually returned; never fill gaps with assumed values.
      if (typeof data?.crop_name !== 'string' || !data.crop_name || typeof data.confidence !== 'number') {
        return {
          isConfigured: true,
          statusMessage: 'The analysis service did not return a crop and confidence. Proceed with manual verification.',
        };
      }
      const match = ['MATCHES', 'PARTIALLY_MATCHES', 'DOES_NOT_MATCH'].includes(data.suggested_match) ? data.suggested_match : undefined;
      return {
        isConfigured: true,
        statusMessage: 'Crop analysis service responded. Treat the result as a suggestion; the officer decides.',
        prediction: {
          cropName: data.crop_name,
          botanicalName: typeof data.botanical_name === 'string' ? data.botanical_name : undefined,
          category: typeof data.category === 'string' ? data.category : undefined,
          confidence: data.confidence,
          vegetationIndexNdvi: typeof data.ndvi === 'number' ? data.ndvi : null,
          canopyDensity: typeof data.canopy_density === 'string' ? data.canopy_density : undefined,
          suggestedVerification: match,
        },
      };
    } catch {
      return {
        isConfigured: true,
        statusMessage: 'Network error contacting AI analysis gateway. Please complete verification manually.',
      };
    }
  }

  async saveCropVerification(params: {
    applicationId: string;
    propertyId: string;
    data: CropVerificationFormData;
    aiData?: { prediction: string; confidence: number };
  }): Promise<CropVerification> {
    const existingIndex = mockDb.cropVerifications.findIndex(
      (c) => c.application_id === params.applicationId
    );

    const record: CropVerification = {
      id: existingIndex >= 0 ? mockDb.cropVerifications[existingIndex].id : `cv-${Date.now()}`,
      property_id: params.propertyId,
      application_id: params.applicationId,
      declared_crop_type: params.data.declaredCropType,
      observed_crop_type: params.data.observedCropType,
      crop_category: params.data.cropCategory,
      cultivation_season: params.data.cultivationSeason,
      approximate_cultivated_area: params.data.approximateCultivatedArea || null,
      irrigation_method: params.data.irrigationMethod || null,
      verification_result: params.data.verificationResult,
      ai_prediction: params.aiData?.prediction || null,
      ai_confidence: params.aiData?.confidence || null,
      ai_model_version: params.aiData ? 'external crop-analysis service (unvalidated)' : null,
      reviewer_notes: params.data.reviewerNotes || null,
      verified_by: mockDb.currentUser.id,
      verified_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      mockDb.cropVerifications[existingIndex] = record;
    } else {
      mockDb.cropVerifications.push(record);
    }

    mockDb.addAuditLog(
      'CROP_VERIFICATION_RECORDED',
      'crop_verifications',
      record.id,
      null,
      {
        result: params.data.verificationResult,
        declared: params.data.declaredCropType,
        observed: params.data.observedCropType,
      }
    );

    mockDb.persistAll();
    if (firebaseService.isConfigured) {
      firebaseService.saveDocument('crop_verifications', record.id, record);
    }
    return record;
  }
}

export const cropVerificationService = new CropVerificationService();
