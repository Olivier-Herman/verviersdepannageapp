// src/app/avance-fonds/page.tsx
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { redirect }         from 'next/navigation';
import AvanceFondsClient    from './AvanceFondsClient';

export const metadata = { title: 'Avance de fonds — Verviers Dépannage' };

export default async function AvanceFondsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return <AvanceFondsClient user={session.user} />;
}
