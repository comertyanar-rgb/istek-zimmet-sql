export const toTrLower = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
};
