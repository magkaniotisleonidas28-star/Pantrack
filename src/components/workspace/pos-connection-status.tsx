import type {PosAvailability} from '@/lib/pos-provider-status';

export default function PosConnectionStatus({name, availability}: {name: string; availability: PosAvailability}) {
  const {native} = availability;
  const label = native.state === 'setup_required' ? 'setup required' : native.state === 'degraded' ? 'needs review' : native.state;
  return <div aria-live="polite">
    <p><strong>{name} native integration: {label}</strong></p>
    {native.reason === 'adapter_not_implemented'
      ? <p>Direct {name} sales sync is not available yet. API access and connection setup are pending. Use CSV imports or a separately configured bridge.</p>
      : native.reason === 'status_unavailable'
        ? <p>Connection status could not be checked. Refresh status before relying on native sync.</p>
        : native.state === 'setup_required'
          ? <p>An owner needs to complete the POS app setup or reconnect to the configured environment.</p>
          : native.state === 'disconnected'
            ? <p>Authorize the POS connection before reading its catalog or syncing sales.</p>
            : <p>Sales sync: {native.sync === 'paused' ? 'paused' : native.sync === 'ready' ? 'ready for manual sync' : 'needs review'}. {native.state === 'degraded' && 'Check the connection and sales exceptions before relying on its data.'}</p>}
    {native.sandboxAccepted && <p><small>Clover sandbox validation recorded.</small></p>}
    <p>CSV import: available. Bridge: {availability.fallbacks.bridge === 'disabled' ? 'not configured' : availability.fallbacks.bridge === 'configured' ? 'configured; no accepted requests yet' : 'configured; accepted requests recorded'}.</p>
  </div>;
}
