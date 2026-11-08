import type { Metadata } from 'next';
import { BrandKits } from './BrandKits';

export const metadata: Metadata = { title: 'Brand kits' };

export default function BrandsPage() {
  return <BrandKits />;
}
