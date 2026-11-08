import type { Metadata } from 'next';
import { ProjectsList } from './ProjectsList';

export const metadata: Metadata = { title: 'Projects' };

export default function ProjectsPage() {
  return <ProjectsList />;
}
