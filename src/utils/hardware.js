function normalizeHardwareStatus(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/İ/g, 'I');
}

export function hasCurrentAssignmentDocument(hardware) {
  if (!hardware) return false;

  const status = normalizeHardwareStatus(hardware.status);
  const isAssigned = status === 'ASSIGNED' || status === 'AKTIF';

  return (
    isAssigned &&
    Boolean(String(hardware.assignedTo || '').trim()) &&
    Boolean(String(hardware.driveLink || '').trim())
  );
}
