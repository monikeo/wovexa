import type { Metadata } from 'next';
import { AssetLibrary } from './AssetLibrary';

export const metadata: Metadata = { title: 'Assets' };

export default function AssetsPage() {
  return <AssetLibrary />;
}
