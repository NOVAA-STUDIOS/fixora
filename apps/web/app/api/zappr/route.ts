import { handleZapprRequest } from './proxy-handler'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return handleZapprRequest(request)
}
