import type { Metadata } from 'next';
import { ExportHistory } from './ExportHistory';

export const metadata: Metadata = { title: 'Exports' };

export default function ExportsPage() {
  return <ExportHistory />;
}
