import { sendOtpChallenge, verifyOtpCode } from './otpService.js';
import { processPdfQueue } from './pdfQueueWorker.js';
import { verifyGoogleIdentity } from './googleAuth.js';
import { createSession, getSessionUser } from './sessionService.js';
import {
  addHardwareForUser,
  bulkStatusUpdateForUser,
  bulkUpdateGroupForUser,
  cancelTransferForUser,
  completeAdPasswordAgentJob,
  completeSignatureAgentJob,
  completeTransferForUser,
  createPersonnelSignatureForUser,
  createSheetForUser,
  enqueueAdPasswordResetForUser,
  fetchAdPasswordAgentJobs,
  fetchAdPasswordQueueForUser,
  fetchDataForUser,
  fetchHardwareHistoryForUser,
  fetchMissingGlpiDevicesForUser,
  fetchOperationQueueForUser,
  fetchSignatureAgentJobs,
  fetchSignatureMetaForUser,
  getAuthorizedUser,
  importMissingGlpiDevicesForUser,
  manualAssignOrUploadMissingDocumentForUser,
  recordInventoryScanForUser,
  saveZimmetOrReturnForUser,
  startTransferForUser,
  syncGlpiDevicesFromAgent,
  updateHardwareForUser,
  updatePersonnelPhoneForUser
} from './repositories/inventoryRepository.js';

function success(payload = {}) {
  return { success: true, ...payload };
}

function notImplemented(action) {
  return {
    success: false,
    error:
      `${action} aksiyonu SQL API tarafına henüz taşınmadı. ` +
      'Bu aksiyon için bir sonraki taşıma adımını uygulayın.'
  };
}

export async function handleAction(data) {
  const action = data?.action;
  if (!action) return { success: false, error: 'Action bulunamadı.' };

  if (action === 'verifyLogin') {
    const googleUser = await verifyGoogleIdentity(data);
    const authorizedUser = await getAuthorizedUser(googleUser.email);

    if (!authorizedUser) {
      return { success: false, error: 'Sistemde yetkiniz bulunmuyor.' };
    }

    const sessionToken = await createSession(authorizedUser.email);
    return success({
      sessionToken,
      email: authorizedUser.email,
      role: authorizedUser.role,
      campus: authorizedUser.campus,
      name: authorizedUser.name || googleUser.name || authorizedUser.email.split('@')[0],
      picture: authorizedUser.picture || googleUser.picture || ''
    });
  }

  if (action === 'fetchADPasswordJobs') {
    const payload = await fetchAdPasswordAgentJobs(data.secret, data);
    return success(payload);
  }

  if (action === 'completeADPasswordJob') {
    const payload = await completeAdPasswordAgentJob(data.secret, data);
    return success(payload);
  }

  if (action === 'syncGLPI') {
    const payload = await syncGlpiDevicesFromAgent(data.secret, data);
    return success(payload);
  }

  if (action === 'fetchSignatureJobs') {
    const payload = await fetchSignatureAgentJobs(data.secret, data);
    return success(payload);
  }

  if (action === 'completeSignatureJob') {
    const payload = await completeSignatureAgentJob(data.secret, data);
    return success(payload);
  }
  const currentUser = await getSessionUser(data.authToken);

  if (action === 'sendOTP') {
    const payload = await sendOtpChallenge({
      personEmail: data.personEmail,
      personName: data.personName,
      personPhone: data.personPhone,
      channel: data.otpChannel
    });

    if (payload.channel === 'sms' && data.personId && payload.phone) {
      await updatePersonnelPhoneForUser(currentUser, data.personId, payload.phone);
    }

    return success({ phone: payload.phone, channel: payload.channel, delivery: payload.delivery, debugOtp: payload.debugOtp });
  }

  if (action === 'verifyOTP') {
    const payload = verifyOtpCode(data.personEmail, data.otpCode);
    return success(payload);
  }

  if (action === 'fetchOperationQueue') {
    const payload = await fetchOperationQueueForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'fetchADPasswordQueue') {
    const payload = await fetchAdPasswordQueueForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'enqueueADPasswordReset') {
    const payload = await enqueueAdPasswordResetForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'fetchSignatureMeta') {
    const payload = await fetchSignatureMetaForUser(currentUser);
    return success(payload);
  }

  if (action === 'createPersonnelSignature') {
    const payload = await createPersonnelSignatureForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'runOperationQueue') {
    if (currentUser.role !== 'HQ IT') {
      return { success: false, error: 'Kuyruğu sadece HQ IT çalıştırabilir.' };
    }
    const payload = await processPdfQueue({ maxJobs: data.maxJobs || 5, includeFailed: true });
    return success(payload);
  }

  if (action === 'fetchData') {
    const payload = await fetchDataForUser(currentUser);
    return success(payload);
  }

  if (action === 'fetchHardwareHistory') {
    const history = await fetchHardwareHistoryForUser(currentUser, data.hardwareId);
    return success({ history });
  }

  if (action === 'fetchMissingGLPIDevices') {
    const payload = await fetchMissingGlpiDevicesForUser(currentUser);
    return success(payload);
  }

  if (action === 'importMissingGLPIDevices') {
    const payload = await importMissingGlpiDevicesForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'createSheet') {
    const payload = await createSheetForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'addHardware') {
    const payload = await addHardwareForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'updateHardware') {
    const payload = await updateHardwareForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'bulkUpdateGroup') {
    const payload = await bulkUpdateGroupForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'bulkStatusUpdate') {
    const payload = await bulkStatusUpdateForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'recordInventoryScan') {
    const payload = await recordInventoryScanForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'manualAssign' || action === 'uploadMissingDocument') {
    const payload = await manualAssignOrUploadMissingDocumentForUser(currentUser, { ...data, action });
    return success(payload);
  }

  if (action === 'saveZimmetServerSide' || action === 'returnZimmetServerSide') {
    const payload = await saveZimmetOrReturnForUser(currentUser, { ...data, action });
    return success(payload);
  }

  if (action === 'startTransferServerSide') {
    const payload = await startTransferForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'completeTransferServerSide') {
    const payload = await completeTransferForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'cancelTransfer') {
    const payload = await cancelTransferForUser(currentUser, data);
    return success(payload);
  }

  return notImplemented(action);
}
