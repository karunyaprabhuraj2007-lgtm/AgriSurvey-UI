// AgriSurvey Acceptance Test Runner
// Validates all 12 Test Cases from Section 26

import { mockDb } from '../src/services/mock-db';
import { registrationService } from '../src/services/registration.service';
import { inspectionService } from '../src/services/inspection.service';
import { droneService } from '../src/services/drone.service';
import { cropVerificationService } from '../src/services/crop-verification.service';
import { reportService } from '../src/services/report.service';
import { notificationService } from '../src/services/notification.service';
import { analyticsService } from '../src/services/analytics.service';
import { canAccessRoleRoute } from '../src/lib/permissions';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${msg}`);
  }
}

async function runAcceptanceTests() {
  console.log('\n======================================================');
  console.log('  AGRISURVEY AUTOMATED FUNCTIONAL ACCEPTANCE SUITE');
  console.log('======================================================\n');

  // Test 1 — Farmer Registration
  console.log('--- Test 1: Farmer Registration ---');
  mockDb.setCurrentUserByRole('farmer');
  const regResult = await registrationService.submitRegistration({
    farmerId: mockDb.currentUser.id,
    identity: {
      identityMethod: 'VOTER_ID',
      identityDocumentNumber: 'MH/2026/TEST01',
      address: 'Plot 45, Wagholi Rural Road',
      village: 'Wagholi',
      taluk: 'Haveli',
      district: 'Pune',
      state: 'Maharashtra',
      postalCode: '412207',
    },
    property: {
      propertyName: 'Automated Test Sugarcane Plot',
      landDocumentNumber: 'MH-PUN-7-12-TEST-001',
      surveyNumber: '199/4',
      subdivisionNumber: '4',
      landArea: 4.25,
      landAreaUnit: 'Acres',
      landType: 'Agricultural Land',
      farmType: 'Crop Farming',
      ownershipCategory: 'Individual Ownership',
      village: 'Wagholi',
      taluk: 'Haveli',
      district: 'Pune',
      state: 'Maharashtra',
      latitude: 18.579,
      longitude: 73.982,
    },
  });

  assert(Boolean(regResult.application.application_reference), 'Application reference generated');
  assert(regResult.application.status === 'PENDING_TAHSILDAR_REVIEW', 'Initial status is PENDING_TAHSILDAR_REVIEW');
  assert(regResult.property.survey_number === '199/4', 'Property survey number matches input');

  // Test 2 — Tahsildar Notification
  console.log('\n--- Test 2: Tahsildar Notification ---');
  const tahsildarUser = mockDb.setCurrentUserByRole('tahsildar');
  const tahsildarApps = await registrationService.listApplicationsForTahsildar({
    taluk: 'Haveli',
  });
  const foundApp = tahsildarApps.find((a) => a.id === regResult.application.id);
  assert(Boolean(foundApp), 'Submitted application visible in authorized Tahsildar jurisdiction queue');

  const tahsildarNotifs = await notificationService.getMyNotifications(tahsildarUser.id);
  assert(tahsildarNotifs.length > 0, 'In-app notification delivered to Tahsildar');

  // Test 3 — Registration Approval & SMS Queue
  console.log('\n--- Test 3: Registration Approval & SMS Queue ---');
  const approvedApp = await registrationService.reviewApplication(
    regResult.application.id,
    'APPROVED',
    { notes: 'Revenue 7/12 extract verified. Ready for farmer image upload.' }
  );
  assert(approvedApp.status === 'APPROVED', 'Application status updated to APPROVED');

  const farmerNotifs = await notificationService.getMyNotifications(regResult.application.farmer_id);
  const approvalNotif = farmerNotifs.find((n) => n.related_application_id === regResult.application.id);
  assert(Boolean(approvalNotif), 'Farmer received approval notification');
  assert(approvalNotif?.channel === 'both', 'Notification channel flagged for in-app & SMS');

  // Test 4 — Registration Rejection
  console.log('\n--- Test 4: Registration Rejection with Reason ---');
  // Create another application to reject
  const tempApp = await registrationService.submitRegistration({
    farmerId: 'usr-farmer-02',
    identity: {
      identityMethod: 'PAN_CARD',
      identityDocumentNumber: 'BCKPS4192K',
      address: 'Main Chowk',
      village: 'Supae',
      taluk: 'Baramati',
      district: 'Pune',
      state: 'Maharashtra',
      postalCode: '412204',
    },
    property: {
      propertyName: 'Disputed Boundary Parcel',
      landDocumentNumber: 'MH-PUN-7-12-DISPUTE',
      surveyNumber: '99/X',
      landArea: 1.5,
      landAreaUnit: 'Acres',
      landType: 'Agricultural Land',
      farmType: 'Crop Farming',
      ownershipCategory: 'Individual Ownership',
      village: 'Supae',
      taluk: 'Baramati',
      district: 'Pune',
      state: 'Maharashtra',
    },
  });

  const rejectedApp = await registrationService.reviewApplication(tempApp.application.id, 'REJECTED', {
    rejectionReason: 'Boundary dispute pending with civil court; 7/12 mutation uncertified.',
  });
  assert(rejectedApp.status === 'REJECTED', 'Status changed to REJECTED');
  assert(Boolean(rejectedApp.rejection_reason), 'Rejection reason successfully stored');

  // Test 5 — Land Image Upload
  console.log('\n--- Test 5: Land Image Upload (5-6 Photos Enforced) ---');
  mockDb.setCurrentUserByRole('farmer');
  const uploadedPhotos = await droneService.uploadFarmerImages({
    propertyId: regResult.property.id,
    applicationId: regResult.application.id,
    files: [
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'photo1.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'photo2.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'photo3.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'photo4.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'photo5.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'photo6.jpg', { type: 'image/jpeg' }),
    ],
  });
  assert(uploadedPhotos.length === 6, '6 farmer ground photographs accepted and stored');

  // Test 6 — Field Inspection & Drone Upload
  console.log('\n--- Test 6: Field Inspection & Drone Imagery ---');
  mockDb.setCurrentUserByRole('tahsildar');
  const newInspection = await inspectionService.assignInspection({
    propertyId: regResult.property.id,
    applicationId: regResult.application.id,
    workerId: 'usr-worker-01',
    scheduledAt: new Date().toISOString(),
  });
  assert(newInspection.inspection_status === 'ASSIGNED', 'Inspection assigned to field worker');

  mockDb.setCurrentUserByRole('field_worker');
  const droneUploads = await droneService.uploadDroneImages({
    inspectionId: newInspection.id,
    propertyId: regResult.property.id,
    applicationId: regResult.application.id,
    missionReference: 'MISSION-PUN-DRONE-HAV-085',
    files: [
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'dji_ortho_01.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'dji_ortho_02.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'dji_ortho_03.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'dji_ortho_04.jpg', { type: 'image/jpeg' }),
    ],
  });
  assert(droneUploads.length === 4, '4 drone photographs uploaded with mission reference');

  // Test 7 — Image Comparison Workspace
  console.log('\n--- Test 7: Image Comparison Workspace ---');
  mockDb.setCurrentUserByRole('tahsildar');
  const comparison = await cropVerificationService.saveImageComparison({
    applicationId: regResult.application.id,
    propertyId: regResult.property.id,
    comparisonResult: 'CONSISTENT',
    reviewNotes: 'Farmer ground photos align with RTK nadir orthomosaic boundaries.',
    similarityScore: 94.1,
  });
  assert(comparison.comparison_result === 'CONSISTENT', 'Image comparison recorded as CONSISTENT');
  assert(comparison.similarity_score === 94.1, 'Similarity correlation score stored');

  // Test 8 — Crop Verification
  console.log('\n--- Test 8: Crop Verification ---');
  const cropVerif = await cropVerificationService.saveCropVerification({
    applicationId: regResult.application.id,
    propertyId: regResult.property.id,
    data: {
      declaredCropType: 'Sugarcane (ऊस)',
      observedCropType: 'Sugarcane (ऊस)',
      cropCategory: 'Cash Crop',
      cultivationSeason: 'Annual',
      approximateCultivatedArea: 4.2,
      irrigationMethod: 'Drip Irrigation',
      verificationResult: 'MATCHES',
      reviewerNotes: 'Healthy sugarcane stand verified by Tahsildar.',
    },
  });
  assert(cropVerif.verification_result === 'MATCHES', 'Crop verification confirmed MATCHES');

  // Test 9 — Final Report Compilation
  console.log('\n--- Test 9: Final Land Verification Report ---');
  const finalReport = await reportService.finalizeReport({
    applicationId: regResult.application.id,
    propertyId: regResult.property.id,
    finalStatus: 'VERIFIED',
    discrepancies: 'No land boundary or title discrepancy found.',
  });
  assert(finalReport.final_status === 'VERIFIED', 'Final report status is VERIFIED');
  assert(Boolean(finalReport.report_reference), `Generated report reference: ${finalReport.report_reference}`);

  // Test 10 — Admin Analytics & Oversight
  console.log('\n--- Test 10: Admin Analytics & Oversight ---');
  mockDb.setCurrentUserByRole('admin');
  const adminStats = await analyticsService.getDashboardStats();
  assert(adminStats.totalFarmers >= 2, 'Total farmers counted from database records');
  assert(adminStats.totalProperties >= 3, 'Total properties verified in database');
  assert(adminStats.completedVerifications >= 1, 'Completed verification count accurate');

  // Test 11 — Authorization Matrix Checks
  console.log('\n--- Test 11: Authorization & Security Checks ---');
  assert(canAccessRoleRoute('farmer', 'farmer') === true, 'Farmer can access farmer routes');
  assert(canAccessRoleRoute('farmer', 'tahsildar') === false, 'Farmer CANNOT access tahsildar routes');
  assert(canAccessRoleRoute('field_worker', 'tahsildar') === false, 'Field worker CANNOT access tahsildar routes');
  assert(canAccessRoleRoute('admin', 'tahsildar') === true, 'Admin has oversight access across roles');

  // Test 12 — Failure & Graceful Fallback Handling
  console.log('\n--- Test 12: External Services Graceful Fallback ---');
  const aiResult = await cropVerificationService.runAiCropAnalysis();
  assert(
    aiResult.statusMessage.includes('manual') || aiResult.statusMessage.includes('unavailable'),
    'AI service truthfully falls back to manual verification when API key not set without false claims'
  );

  console.log('\n======================================================');
  console.log('  ALL 12 FUNCTIONAL ACCEPTANCE TESTS COMPLETED SUCCESSFULLY!  ');
  console.log('======================================================\n');
  process.exit(0);
}

runAcceptanceTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
