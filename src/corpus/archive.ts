import AdmZip from 'adm-zip';

export const readZipEntries = (zipPath: string): string[] => {
  const zip = new AdmZip(zipPath);
  const entries = zip
    .getEntries()
    .filter(e => !e.isDirectory)
    .map(e => e.entryName.replace(/\\/g, '/'));
  return entries.sort();
};
