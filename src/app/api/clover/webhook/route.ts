import {cloverPosAdapter} from '@/lib/clover-pos-adapter';
import {requireSupported} from '@/lib/pos-adapter';

export async function POST(request: Request) {
  return requireSupported(await cloverPosAdapter.webhook(request));
}
