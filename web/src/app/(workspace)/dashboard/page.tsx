import type { Metadata } from 'next';
import { Dashboard } from './Dashboard';

export const metadata: Metadata = { title: 'Home' };

export default function DashboardPage() {
  return <Dashboard />;
}
