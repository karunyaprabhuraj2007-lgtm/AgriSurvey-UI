import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UploadCloud,
  Camera,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Eye,
  Info,
  ShieldCheck,
  ArrowRight,
  Layers,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { droneService } from '@/services/drone.service';
import { mockDb } from '@/services/mock-db';
import { FarmerLandImage, RegistrationApplication } from '@/types';

import { EvidenceImage } from '@/components/media/EvidenceImage';
import { hasEvidenceFile } from '@/lib/evidence';
import { PhotoMetadata, locationSourceLabel, readPhotoMetadata } from '@/lib/photo-metadata';

import { useLanguage } from '@/context/LanguageContext';
import { localizePlotOrCropName } from '@/lib/dashboard-localizer';

export const LandImageUploadPage: React.FC = () => {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const farmer = mockDb.currentUser;

  // Find approved applications eligible for image upload
  const approvedApps = mockDb.applications.filter(
    (a) => a.farmer_id === farmer.id && a.status === 'APPROVED'
  );

  const [selectedApp, setSelectedApp] = useState<RegistrationApplication | null>(
    approvedApps[0] || null
  );

  const [existingImages, setExistingImages] = useState<FarmerLandImage[]>([]);
  const [sampleRecordCount, setSampleRecordCount] = useState(0);
  const [stagedImages, setStagedImages] = useState<Array<{ file: File; url: string; meta: PhotoMetadata }>>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successNotice, setSuccessNotice] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (selectedApp) {
      loadImages(selectedApp.property_id, selectedApp.id);
    }
  }, [selectedApp]);

  const loadImages = async (propId: string, appId: string) => {
    const list = await droneService.getFarmerImages(propId, appId);
    // Seeded sample records have no photograph file; they do not count towards the 5–6 photos
    setExistingImages(list.filter(hasEvidenceFile));
    setSampleRecordCount(list.filter((i) => !hasEvidenceFile(i)).length);
  };

  const handleAddPhotos = async (list: FileList | null) => {
    if (!list?.length) return;
    const room = 6 - existingImages.length - stagedImages.length;
    const files = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (files.length > room) setErrorMessage('Maximum 6 land photographs are permitted; extra files were not added.');
    else setErrorMessage(null);
    const added = await Promise.all(
      files.slice(0, Math.max(0, room)).map(async (file) => ({ file, url: URL.createObjectURL(file), meta: await readPhotoMetadata(file) }))
    );
    setStagedImages((prev) => [...prev, ...added]);
  };

  const handleRemoveStaged = (index: number) => {
    const next = [...stagedImages];
    URL.revokeObjectURL(next[index].url);
    next.splice(index, 1);
    setStagedImages(next);
  };

  const handleSubmitPhotos = async () => {
    const totalCount = existingImages.length + stagedImages.length;
    if (totalCount < 5 || totalCount > 6) {
      setErrorMessage(
        `AgriSurvey requires between 5 and 6 photographs (Currently: ${totalCount}). Please adjust your submission.`
      );
      return;
    }

    if (!selectedApp) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await droneService.uploadFarmerImages({
        propertyId: selectedApp.property_id,
        applicationId: selectedApp.id,
        files: stagedImages.map((s) => s.file),
      });

      setIsSubmitting(false);
      setSuccessNotice(true);
      stagedImages.forEach((s) => URL.revokeObjectURL(s.url));
      setStagedImages([]);
      loadImages(selectedApp.property_id, selectedApp.id);
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMessage(err.message || 'Error saving land photographs.');
    }
  };

  const totalImageCount = existingImages.length + stagedImages.length;

  return (
    <DashboardLayout
      title={t('dashboard.uploadPhotosTitle', 'Upload Land Photographs')}
      subtitle={t('dashboard.uploadPhotosSubtitle', 'Submit 5–6 ground photographs of your approved agricultural property for drone inspection matching')}
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Approved Property Banner */}
        {selectedApp ? (
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-slate-500 uppercase">Selected Property</span>
                <Badge status={selectedApp.status} size="sm" />
              </div>
              <h3 className="text-base font-bold text-slate-900">
                {selectedApp.property?.property_name ? localizePlotOrCropName(selectedApp.property.property_name, language) : `Survey No. ${selectedApp.property?.survey_number}`}
              </h3>
              <p className="text-xs text-slate-500 font-mono">
                App Ref: {selectedApp.application_reference} • Gat No: {selectedApp.property?.survey_number} • Area: {selectedApp.property?.land_area} Acres
              </p>
            </div>

            <div className="text-right">
              <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                {totalImageCount} of 6 Photos Staged
              </span>
            </div>
          </div>
        ) : (
          <div className="p-6 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <span className="font-bold">No Approved Registration Found:</span> Land photographs can only be submitted
              once the Tahsildar has reviewed and officially approved your registration application.
            </div>
          </div>
        )}

        {/* Mandatory Instructions Box (Section 9 Requirement) */}
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-5 text-xs text-emerald-950 space-y-2">
          <div className="flex items-center gap-2 font-bold text-emerald-900 text-sm">
            <Camera className="w-4 h-4 text-emerald-700" />
            <span>Official Land Photographic Guidelines</span>
          </div>
          <p className="leading-relaxed">
            “Upload 5–6 clear photographs of your agricultural land from different viewpoints. Where possible, capture field boundaries, crop rows, irrigation arrangements, and the overall condition of the property.”
          </p>
          <div className="text-[11px] text-emerald-800 flex items-center gap-1.5 pt-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Privacy Note: Please avoid capturing photographs of unrelated individuals or neighboring private homesteads.</span>
          </div>
        </div>

        {/* Alerts */}
        {errorMessage && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successNotice && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2 shadow-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>
                “Your land photographs have been submitted successfully. The field verification team will review your submission and coordinate the next inspection step.”
              </span>
            </div>
            <Button size="sm" onClick={() => navigate('/farmer/dashboard')}>
              Go to Dashboard
            </Button>
          </div>
        )}

        {/* Drag and Drop Upload Area */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                Ground Photograph Gallery (5 to 6 Required)
              </h4>
              <p className="text-xs text-slate-500">
                {totalImageCount >= 5 && totalImageCount <= 6 ? (
                  <span className="text-emerald-700 font-semibold">
                    ✓ Required photo quota satisfied ({totalImageCount}/6)
                  </span>
                ) : (
                  <span className="text-amber-700 font-semibold">
                    Need {Math.max(0, 5 - totalImageCount)} more photo(s) to reach minimum requirement of 5
                  </span>
                )}
              </p>
            </div>


          </div>

          {sampleRecordCount > 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {sampleRecordCount} seeded sample record(s) for this application have no photograph file. They are not evidence and
              do not count towards the 5–6 photographs; please upload your own.
            </p>
          )}

          {/* Photo Grid Preview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Existing Saved Photos */}
            {existingImages.map((img, idx) => (
              <div
                key={img.id}
                className="group relative rounded-xl overflow-hidden border border-emerald-300 bg-slate-900 shadow-xs"
              >
                <EvidenceImage
                  record={img}
                  onOpen={setPreviewImage}
                  className="w-full h-44 object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-slate-950/80 via-transparent to-black/30 p-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="bg-emerald-600/90 backdrop-blur-xs text-white text-[10px] font-bold px-2 py-0.5 rounded">
                      Submitted Photo #{idx + 1}
                    </span>

                  </div>
                  <div>
                    <div className="text-white text-xs font-semibold truncate">
                      {img.original_filename}
                    </div>
                    <div className="text-[10px] text-emerald-300 font-mono">
                      {img.latitude !== null && img.longitude !== null
                        ? `GPS: ${img.latitude.toFixed(6)}°, ${img.longitude.toFixed(6)}°`
                        : 'No GPS in file'}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Staged New Photos */}
            {stagedImages.map((stg, idx) => (
              <div
                key={stg.url}
                className="group relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 shadow-xs"
              >
                <img
                  src={stg.url}
                  alt={stg.file.name}
                  className="w-full h-44 object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-black/30 p-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="bg-teal-600/90 backdrop-blur-xs text-white text-[10px] font-bold px-2 py-0.5 rounded">
                      Staged Viewpoint #{existingImages.length + idx + 1}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setPreviewImage(stg.url)}
                        className="p-1 rounded bg-white/20 text-white hover:bg-white/40"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveStaged(idx)}
                        className="p-1 rounded bg-rose-600/80 text-white hover:bg-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="text-white text-xs font-semibold truncate">{stg.file.name}</div>
                    <div className={`text-[10px] truncate ${stg.meta.latitude === null ? 'text-amber-300' : 'text-emerald-300'}`}>
                      {locationSourceLabel(stg.meta)}
                      {stg.meta.capturedAt ? ` · ${stg.meta.capturedAt.replace('T', ' ').slice(0, 16)}` : ' · no capture time'}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Upload Placeholder if under 6 */}
            {totalImageCount < 6 && (
              <label
                className="border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-xl h-44 flex flex-col items-center justify-center p-4 text-center cursor-pointer bg-slate-50/50 hover:bg-emerald-50/20 transition-all group"
              >
                <UploadCloud className="w-8 h-8 text-slate-400 group-hover:text-emerald-600 mb-2 transition-colors" />
                <span className="text-xs font-semibold text-slate-700 group-hover:text-emerald-800">
                  Add Photo #{totalImageCount + 1}
                </span>
                <span className="text-[10px] text-slate-400 mt-1">
                  Take or choose original camera photos (location services on, so GPS is recorded)
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="sr-only"
                  aria-label="Land photographs"
                  onChange={(e) => {
                    handleAddPhotos(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>

          {/* Submission Bar */}
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-500">
              Original files are kept on this device and uploaded to cloud storage when it is configured. GPS and
              capture time are read from each photo; nothing is filled in when a tag is missing.
            </div>

            <Button
              onClick={handleSubmitPhotos}
              disabled={totalImageCount < 5 || totalImageCount > 6 || stagedImages.length === 0}
              isLoading={isSubmitting}
              icon={<CheckCircle2 className="w-4 h-4" />}
            >
              Submit Photos for Inspection
            </Button>
          </div>
        </div>
      </div>

      {/* Fullscreen Photo Modal */}
      <Modal isOpen={Boolean(previewImage)} onClose={() => setPreviewImage(null)} maxWidth="2xl">
        {previewImage && (
          <div className="space-y-3">
            <img src={previewImage} alt="Preview" className="w-full h-auto rounded-lg max-h-[70vh] object-contain mx-auto" />
            <div className="text-center text-xs text-slate-500">
              Original photograph
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
};
