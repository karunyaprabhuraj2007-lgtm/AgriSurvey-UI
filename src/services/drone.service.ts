import { mockDb } from './mock-db';
import { putMedia } from '@/lib/media-store';
import { readPhotoMetadata } from '@/lib/photo-metadata';
import { notificationService } from './notification.service';
import { firebaseService } from './firebase.service';
import { FarmerLandImage, DroneImagery } from '@/types';

export class DroneService {
  async getFarmerImages(propertyId?: string, applicationId?: string): Promise<FarmerLandImage[]> {
    return mockDb.landImages.filter((img) => {
      if (propertyId && img.property_id !== propertyId) return false;
      if (applicationId && img.application_id !== applicationId) return false;
      return true;
    });
  }

  async getDroneImages(propertyId?: string, applicationId?: string, inspectionId?: string): Promise<DroneImagery[]> {
    return mockDb.droneImagery.filter((img) => {
      if (inspectionId && img.inspection_id !== inspectionId) return false;
      if (propertyId && img.property_id !== propertyId) return false;
      if (applicationId && img.application_id !== applicationId) return false;
      return true;
    });
  }

  async uploadFarmerImages(params: {
    propertyId: string;
    applicationId: string;
    files: File[];
  }): Promise<FarmerLandImage[]> {
    const uploadedList: FarmerLandImage[] = [];

    for (const [idx, file] of params.files.entries()) {
      const id = `fli-${Date.now()}-${idx}`;
      const storagePath = `farmer-images/${params.propertyId}/${id}-${file.name}`;
      const meta = await readPhotoMetadata(file);
      const stored = await storeEvidenceFile(id, storagePath, file);
      const newImg: FarmerLandImage = {
        id,
        property_id: params.propertyId,
        application_id: params.applicationId,
        uploaded_by: mockDb.currentUser.id,
        storage_path: storagePath,
        original_filename: file.name,
        capture_timestamp: meta.capturedAt,
        latitude: meta.latitude,
        longitude: meta.longitude,
        metadata_status: meta.latitude !== null ? 'EXIF_GPS' : 'NO_GPS',
        uploaded_at: new Date().toISOString(),
        location_source: meta.latitude !== null ? 'EXIF_GPS' : 'NONE',
        gps_accuracy_m: meta.gpsAccuracyM,
        camera_make: meta.cameraMake,
        camera_model: meta.cameraModel,
        ...stored,
      };
      mockDb.landImages.push(newImg);
      uploadedList.push(newImg);
      syncToCloud(newImg, storagePath, file, 'farmer_land_images');
    }

    mockDb.addAuditLog(
      'FARMER_LAND_IMAGES_UPLOADED',
      'farmer_land_images',
      params.applicationId,
      null,
      { uploaded_count: params.files.length, property_id: params.propertyId }
    );

    // Notify assigned Tahsildar
    const app = mockDb.applications.find((a) => a.id === params.applicationId);
    if (app && app.assigned_tahsildar_id) {
      await notificationService.createNotification({
        recipient_user_id: app.assigned_tahsildar_id,
        notification_type: 'LAND_IMAGES_SUBMITTED',
        title: 'Farmer Submitted Land Photos',
        message: `Farmer submitted ${params.files.length} ground photos for application ${app.application_reference}.`,
        related_application_id: app.id,
        channel: 'in_app',
      });
    }

    mockDb.persistAll();
    return uploadedList;
  }

  async deleteFarmerImage(imageId: string): Promise<void> {
    mockDb.landImages = mockDb.landImages.filter((img) => img.id !== imageId);
    mockDb.persistAll();
  }

  async uploadDroneImages(params: {
    inspectionId: string;
    propertyId: string;
    applicationId: string;
    missionReference: string;
    files: File[];
  }): Promise<DroneImagery[]> {
    const uploadedList: DroneImagery[] = [];

    for (const [idx, file] of params.files.entries()) {
      const id = `drn-${Date.now()}-${idx}`;
      const storagePath = `drone-imagery/${params.inspectionId}/${id}-${file.name}`;
      const meta = await readPhotoMetadata(file);
      const stored = await storeEvidenceFile(id, storagePath, file);
      const hasGps = meta.latitude !== null;
      const newDroneImg: DroneImagery = {
        id,
        inspection_id: params.inspectionId,
        property_id: params.propertyId,
        application_id: params.applicationId,
        uploaded_by: mockDb.currentUser.id,
        storage_path: storagePath,
        original_filename: file.name,
        capture_timestamp: meta.capturedAt,
        latitude: meta.latitude,
        longitude: meta.longitude,
        mission_reference: params.missionReference || null,
        metadata_status: !hasGps ? 'NO_GPS' : meta.rtkStatus === 'FIXED' ? 'EXIF_GPS_RTK_FIXED' : 'EXIF_GPS',
        processing_status: 'UPLOADED',
        uploaded_at: new Date().toISOString(),
        location_source: hasGps ? 'EXIF_GPS' : 'NONE',
        gps_accuracy_m: meta.gpsAccuracyM,
        camera_make: meta.cameraMake,
        camera_model: meta.cameraModel,
        relative_altitude_m: meta.relativeAltitudeM,
        rtk_status: meta.rtkStatus,
        ...stored,
      };
      mockDb.droneImagery.push(newDroneImg);
      uploadedList.push(newDroneImg);
      syncToCloud(newDroneImg, storagePath, file, 'drone_imagery');
    }

    // Update inspection status to EVIDENCE_UPLOADED
    const insp = mockDb.inspections.find((i) => i.id === params.inspectionId);
    if (insp && uploadedList.length) {
      insp.inspection_status = 'EVIDENCE_UPLOADED';
      insp.updated_at = new Date().toISOString();
    }

    mockDb.addAuditLog('DRONE_IMAGERY_UPLOADED', 'drone_imagery', params.inspectionId, null, {
      mission: params.missionReference,
      count: uploadedList.length,
      with_gps: uploadedList.filter((i) => i.latitude !== null).length,
    });

    mockDb.persistAll();
    return uploadedList;
  }
}

/**
 * Keep the original file locally (IndexedDB). When that is not possible (no IndexedDB),
 * wait — up to a limit — for the cloud copy instead, so the record still points at a file.
 */
async function storeEvidenceFile(id: string, storagePath: string, file: File): Promise<{ media_id?: string; image_url?: string }> {
  const local = await putMedia(id, file).then(() => id).catch(() => undefined);
  if (local) return { media_id: local };
  if (!firebaseService.isConfigured) return {};
  const remote = await Promise.race([
    firebaseService.uploadFile(storagePath, file, file.type || undefined).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), CLOUD_WAIT_MS)),
  ]);
  return remote ? { image_url: remote } : {};
}

const CLOUD_WAIT_MS = 20000;

/**
 * Upload the original to cloud storage in the background (Firebase retries for minutes
 * when offline, so the user is never kept waiting) and record its URL when it lands.
 */
function syncToCloud(record: { id: string; image_url?: string }, storagePath: string, file: File, collection: string) {
  if (!firebaseService.isConfigured || record.image_url) return;
  firebaseService
    .uploadFile(storagePath, file, file.type || undefined)
    .then((url) => {
      if (!url) return;
      record.image_url = url;
      mockDb.persistAll();
      firebaseService.saveDocument(collection, record.id, record);
    })
    .catch(() => {});
}

export const droneService = new DroneService();
