// Turn leads into a CSV file and hand it to the platform share sheet
// (native) or trigger a download (web).

import { Platform } from 'react-native';
import type { Lead } from './types';

const COLUMNS: { header: string; value: (lead: Lead) => string | number | null }[] = [
  { header: 'Type', value: (l) => l.type },
  { header: 'Name', value: (l) => l.name },
  { header: 'Title', value: (l) => (l.type === 'person' ? l.title : l.industry) },
  { header: 'Company', value: (l) => (l.type === 'person' ? l.company : l.name) },
  { header: 'Email', value: (l) => (l.type === 'person' ? l.email : null) },
  { header: 'Email confidence', value: (l) => (l.type === 'person' ? l.email_confidence : null) },
  { header: 'Email verification', value: (l) => (l.type === 'person' ? l.email_verification : null) },
  { header: 'Location', value: (l) => l.location },
  { header: 'Website', value: (l) => (l.type === 'person' ? l.company_website : l.website) },
  { header: 'LinkedIn', value: (l) => l.linkedin_url },
];

function escapeCell(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function leadsToCsv(leads: Lead[]): string {
  const header = COLUMNS.map((c) => c.header).join(',');
  const rows = leads.map((lead) => COLUMNS.map((c) => escapeCell(c.value(lead))).join(','));
  return [header, ...rows].join('\n');
}

/** Export leads as a CSV via share sheet (native) or download (web). */
export async function exportLeadsCsv(leads: Lead[]): Promise<void> {
  const csv = leadsToCsv(leads);
  const filename = `overture-leads-${Date.now()}.csv`;

  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }

  // Native: write to the cache directory, then open the share sheet.
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const uri = await writeCsvFile(filename, csv);
  await Sharing.shareAsync(uri, {
    mimeType: 'text/csv',
    dialogTitle: 'Export leads',
  });
}

/**
 * Write the CSV with the current File API, falling back to the legacy
 * expo-file-system API if the new one fails on this device/runtime.
 * Returns the file:// URI to hand to the share sheet.
 */
async function writeCsvFile(filename: string, csv: string): Promise<string> {
  try {
    const { File, Paths } = await import('expo-file-system');
    const file = new File(Paths.cache, filename);
    file.create();
    file.write(csv);
    return file.uri;
  } catch {
    const legacy = await import('expo-file-system/legacy');
    const uri = `${legacy.cacheDirectory}${filename}`;
    await legacy.writeAsStringAsync(uri, csv);
    return uri;
  }
}
