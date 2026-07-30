import { sendOtpChallenge, verifyOtpCode } from './otpService.js';
import { processPdfQueue } from './pdfQueueWorker.js';
import { verifyGoogleIdentity } from './googleAuth.js';
import { createSession, getSessionUser, revokeSession } from './sessionService.js';
import { config } from './config.js';
import {
  clearPersonnelOverrideForAdmin,
  fetchAdminAuditLogsForUser,
  fetchAdminOverviewForUser,
  saveAuthorizedUserForAdmin,
  savePersonnelOverrideForAdmin
} from './repositories/adminRepository.js';
import { isSuperAdminEmail, requireSuperAdmin } from './superAdmin.js';
import {
  addHardwareForUser,
  bulkAddHardwareForUser,
  bulkStatusUpdateForUser,
  bulkUpdateGroupForUser,
  cancelSignatureJobForUser,
  cancelTransferForUser,
  completeAdPasswordAgentJob,
  completeSignatureAgentJob,
  completeTransferForUser,
  createPersonnelSignatureForUser,
  createSheetForUser,
  dismissQueueNotificationsForUser,
  enqueueAdPasswordResetForUser,
  fetchAdPasswordAgentJobs,
  fetchAdPasswordQueueForUser,
  fetchDataForUser,
  fetchHardwareHistoryForUser,
  fetchMissingGlpiDevicesForUser,
  fetchOperationQueueForUser,
  fetchSignatureAgentJobStates,
  fetchSignatureAgentJobs,
  fetchSignatureMetaForUser,
  fetchSignatureQueueForUser,
  getAuthorizedUser,
  getOtpRecipientForUser,
  importMissingGlpiDevicesForUser,
  manualAssignOrUploadMissingDocumentForUser,
  processGlpiReconcileQueue,
  recordInventoryScanForUser,
  saveZimmetOrReturnForUser,
  startTransferForUser,
  syncPersonnelFromAgent,
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

function agentSecretForRequest(data, context, action) {
  const agentAuth = context?.agentAuth;
  if (agentAuth?.verified && agentAuth.action === action) return agentAuth.secret;
  return data.secret;
}

export async function handleAction(data, context = {}) {
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
      picture: authorizedUser.picture || googleUser.picture || '',
      isSuperAdmin: isSuperAdminEmail(authorizedUser.email, config.superAdminEmails)
    });
  }

  if (action === 'fetchADPasswordJobs') {
    const payload = await fetchAdPasswordAgentJobs(agentSecretForRequest(data, context, action), data);
    return success(payload);
  }

  if (action === 'completeADPasswordJob') {
    const payload = await completeAdPasswordAgentJob(agentSecretForRequest(data, context, action), data);
    return success(payload);
  }

  if (action === 'syncGLPI') {
    const payload = await syncGlpiDevicesFromAgent(agentSecretForRequest(data, context, action), data);
    return success(payload);
  }

  if (action === 'syncPersonnel') {
    const payload = await syncPersonnelFromAgent(agentSecretForRequest(data, context, action), data);
    return success(payload);
  }

  if (action === 'fetchSignatureJobs') {
    const payload = await fetchSignatureAgentJobs(agentSecretForRequest(data, context, action), data);
    return success(payload);
  }

  if (action === 'fetchSignatureJobStates') {
    const payload = await fetchSignatureAgentJobStates(agentSecretForRequest(data, context, action), data);
    return success(payload);
  }

  if (action === 'completeSignatureJob') {
    const payload = await completeSignatureAgentJob(agentSecretForRequest(data, context, action), data);
    return success(payload);
  }

  if (action === 'logout') {
    await revokeSession(data.authToken);
    return success();
  }

  const currentUser = await getSessionUser(data.authToken);

  if (action === 'adminFetchOverview') {
    requireSuperAdmin(currentUser, config.superAdminEmails);
    const payload = await fetchAdminOverviewForUser();
    return success({
      ...payload,
      users: payload.users.map((user) => ({
        ...user,
        protected: isSuperAdminEmail(user.email, config.superAdminEmails)
      }))
    });
  }

  if (action === 'adminSaveAuthorizedUser') {
    requireSuperAdmin(currentUser, config.superAdminEmails);
    const payload = await saveAuthorizedUserForAdmin(currentUser, data, {
      isProtectedEmail: (email) => isSuperAdminEmail(email, config.superAdminEmails)
    });
    return success(payload);
  }

  if (action === 'adminSavePersonnelOverride') {
    requireSuperAdmin(currentUser, config.superAdminEmails);
    const payload = await savePersonnelOverrideForAdmin(currentUser, data);
    return success(payload);
  }

  if (action === 'adminClearPersonnelOverride') {
    requireSuperAdmin(currentUser, config.superAdminEmails);
    const payload = await clearPersonnelOverrideForAdmin(currentUser, data);
    return success(payload);
  }

  if (action === 'sendOTP') {
    const person = await getOtpRecipientForUser(currentUser, data.personId);
    const payload = await sendOtpChallenge({
      person,
      personPhone: data.personPhone,
      channel: data.otpChannel,
      context: {
        requesterEmail: currentUser.email,
        action: data.otpAction,
        hardwareIds: data.hardwareIds
      }
    });

    if (payload.channel === 'sms' && data.personId && payload.phone) {
      await updatePersonnelPhoneForUser(currentUser, data.personId, payload.phone);
    }

    return success({
      challengeId: payload.challengeId,
      phone: payload.phone,
      channel: payload.channel,
      delivery: payload.delivery
    });
  }

  if (action === 'verifyOTP') {
    const person = await getOtpRecipientForUser(currentUser, data.personId);
    const payload = verifyOtpCode({
      challengeId: data.challengeId,
      otpCode: data.otpCode,
      context: {
        requesterEmail: currentUser.email,
        personId: person.id,
        personEmail: person.email,
        action: data.otpAction,
        hardwareIds: data.hardwareIds
      }
    });
    return success(payload);
  }

  if (action === 'fetchOperationQueue') {
    const payload = await fetchOperationQueueForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'dismissQueueNotifications') {
    const payload = await dismissQueueNotificationsForUser(currentUser, data);
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

  if (action === 'fetchSignatureQueue') {
    const payload = await fetchSignatureQueueForUser(currentUser, data);
    return success(payload);
  }

  if (action === 'cancelSignatureJob') {
    const payload = await cancelSignatureJobForUser(currentUser, data);
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
    const maxJobs = data.maxJobs || 5;
    const [pdfQueue, glpiQueue] = await Promise.all([
      processPdfQueue({ maxJobs, includeFailed: true }),
      processGlpiReconcileQueue({ maxJobs: 1, includeFailed: true })
    ]);
    return success({
      processed: pdfQueue.processed + glpiQueue.processed,
      results: [...(pdfQueue.results || []), ...(glpiQueue.results || [])],
      pdf: pdfQueue,
      glpi: glpiQueue
    });
  }

  if (action === 'fetchData') {
    const payload = await fetchDataForUser(currentUser, data);
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

  if (action === 'adminFetchAuditLogs') {
    requireSuperAdmin(currentUser, config.superAdminEmails);
    const payload = await fetchAdminAuditLogsForUser(data);
    return success(payload);
  }

  if (action === 'bulkAddHardware') {
    const payload = await bulkAddHardwareForUser(currentUser, data);
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
