import DepotClient from './DepotClient'

export const dynamic = 'force-dynamic'

export default function DepotPage({ params }: { params: { token: string } }) {
  return <DepotClient token={params.token} />
}
