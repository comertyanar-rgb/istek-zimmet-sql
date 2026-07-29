function cleanText(value, maxLength) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLength);
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')
  );
}

function safeHardware(items) {
  if (!Array.isArray(items)) return [];

  return items.map((item) => compactObject({
    hardwareId: Number.isFinite(Number(item?.hardwareId)) ? Number(item.hardwareId) : undefined,
    serial: cleanText(item?.serial, 160),
    type: cleanText(item?.type, 80),
    brand: cleanText(item?.brand, 120),
    model: cleanText(item?.model, 240),
    computerName: cleanText(item?.computerName, 160),
    campus: cleanText(item?.campus, 160)
  }));
}

function safePerson(person) {
  if (!person || typeof person !== 'object' || Array.isArray(person)) return undefined;

  return compactObject({
    id: cleanText(person.id, 160),
    name: cleanText(person.name, 240),
    campus: cleanText(person.campus, 160),
    department: cleanText(person.department, 240)
  });
}

export function buildSafeOperationPayload(actionType, payload = {}, redactedAt = new Date()) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const hardware = safeHardware(source.hardware);
  const redactedDate = redactedAt instanceof Date ? redactedAt : new Date(redactedAt);

  return compactObject({
    payloadVersion: 1,
    payloadRedacted: true,
    redactedAt: Number.isNaN(redactedDate.getTime()) ? new Date().toISOString() : redactedDate.toISOString(),
    actionType: cleanText(actionType, 120),
    documentType: cleanText(source.documentType, 40),
    pdfName: cleanText(source.pdfName, 260),
    campus: cleanText(source.campus, 160),
    senderCampus: cleanText(source.senderCampus, 160),
    receiverCampus: cleanText(source.receiverCampus, 160),
    transferDirection: cleanText(source.transferDirection, 20),
    person: safePerson(source.person),
    hardware,
    hardwareCount: hardware.length
  });
}
