import React, { act, StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { useWorkspaceTheme } from '../../src/components/workspace/workspace-theme';
import MembersPanel from '../../src/components/workspace/members-panel';
import { useClock } from '../../src/hooks/use-clock';
import WeeklySchedules from '../../src/components/workspace/weekly-schedules';
import MenuWasteRecorder from '../../src/components/workspace/menu-waste-recorder';
import WasteRecorder from '../../src/components/workspace/waste-recorder';
import { wasteStorageKey } from '../../src/lib/waste-client';
import { DeliveryCountForm } from '../../src/components/workspace/delivery-count';
import PurchaseOrderArchives from '../../src/components/workspace/purchase-order-archives';
import SpendingLimitsPanel from '../../src/components/workspace/spending-limits';
import PaymentMethods from '../../src/components/workspace/payment-methods';
import DurableCart from '../../src/components/workspace/durable-cart';
import type { PurchaseOrderView } from '../../src/lib/purchase-order-contract';
import type { ManagerCartView } from '../../src/lib/po-cart-manager-contract';
import { intentKey } from '../../src/components/workspace/durable-cart-client';

declare global {
  interface Window {
    mountPollingCart: () => Promise<void>;
    cartPollState: 'queued' | 'canceled';
    cartPollRequests: number;
    mountLimits: () => Promise<void>;
    resolveLimits: (minor: number) => Promise<void>;
    mountPayments: (companyId: string) => Promise<void>;
    resolvePayments: (companyId: string) => Promise<void>;
    mountDurableRecovery: () => Promise<void>;
    mountDelivery: (confirmationId: string) => Promise<void>;
    mountArchive: (orderId: string) => Promise<void>;
    resolveArchive: (orderId: string, fail?: boolean) => Promise<void>;
    archiveAborted: (orderId: string) => boolean;
    mountRecoveredWaste: (kind: 'menu' | 'ingredient') => Promise<void>;
    recoveredWasteBody: Record<string, unknown>;
    mountTheme: (hydrate?: boolean) => Promise<void>;
    hydrationErrors: string[];
    serverThemeMarkup: string;
    mountWeekly: () => Promise<void>;
    clickScreen: (label: string) => Promise<void>;
    screenPosts: Record<string, unknown>[];
    mountClock: () => Promise<void>;
    flushScreen: () => Promise<void>;
    mountMembers: (companyId: string) => Promise<void>;
    resolveMembers: (companyId: string) => Promise<void>;
    screenRequests: {
      url: string;
      signal?: AbortSignal | null;
      resolve: (value: Response) => void;
    }[];
  }
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root = createRoot(document.getElementById('root')!);
window.screenRequests = [];
window.screenPosts = [];
const weekly = {
  timeZone: 'UTC',
  choices: {
    people: [{ userId: 'owner', role: 'owner' }],
    suppliers: [
      {
        id: 'supplier',
        name: 'Fictional supplier',
        groups: [
          {
            accountId: 'account',
            locationId: 'location',
            accountReference: 'Account',
            locationReference: 'Café',
          },
        ],
      },
    ],
  },
  schedules: [
    {
      id: 'schedule',
      version: 1,
      supplierId: 'supplier',
      accountId: 'account',
      locationId: 'location',
      weekday: 1,
      localTime: '09:00',
      marginPercent: 10,
      responsibleUserId: 'owner',
      status: 'active',
      weeks: [],
      nextRun: null,
    },
  ],
};
window.fetch = (input, init) => {
  const path = new URL(String(input), location.origin).pathname;
  if (path === '/api/po-cart-jobs' && window.cartPollRequests !== undefined) {
    window.cartPollRequests++;
    return Promise.resolve(Response.json(pollingView()));
  }
  if (init?.method === 'POST' && ['/api/payments', '/api/po-cart-authorizations'].includes(path)) {
    window.screenPosts.push(JSON.parse(String(init.body)));
    return Promise.resolve(
      path === '/api/payments'
        ? Response.json({})
        : Response.json({ error: 'Fictional lost cart response' }, { status: 503 }),
    );
  }
  if (path.startsWith('/api/waste')) {
    if (init?.method === 'POST') {
      window.screenPosts.push(JSON.parse(String(init.body)));
      return Promise.resolve(
        Response.json({ uncertain: true, error: 'Fictional lost save response' }, { status: 503 }),
      );
    }
    const item = path.endsWith('/items')
      ? {
          kind: 'product',
          id: 'milk',
          name: 'Fictional milk',
          version: 'v1',
          ready: true,
          issue: null,
          offered: true,
          revision: 1,
          modifiers: [],
        }
      : {
          productId: 'milk',
          name: 'Fictional milk',
          configId: 'config',
          version: 1,
          unitId: 'mL',
          unitLabel: 'mL',
          shortcuts: [],
          shortcutRevision: 0,
        };
    return Promise.resolve(
      Response.json({ enabled: true, serverNow: '2026-10-27T12:00:00Z', items: [item] }),
    );
  }

  if (String(input).includes('/api/po-draft-schedules')) {
    if (init?.method === 'POST') {
      window.screenPosts.push(JSON.parse(String(init.body)));
      return Promise.resolve(
        Response.json({ uncertain: true, error: 'Fictional lost save response' }, { status: 503 }),
      );
    }
    return Promise.resolve(Response.json(weekly));
  }
  return new Promise((resolve) => {
    window.screenRequests.push({ url: String(input), signal: init?.signal, resolve });
  });
};
window.mountMembers = (companyId) =>
  act(async () => {
    root.render(
      <StrictMode>
        <MembersPanel companyId={companyId} owner />
      </StrictMode>,
    );
  });
window.resolveMembers = (companyId) =>
  act(async () => {
    const requests = window.screenRequests.filter(
      (request) =>
        new URL(request.url, location.origin).searchParams.get('companyId') === companyId,
    );
    for (const request of requests) {
      request.resolve(
        Response.json({
          members: [{ user_id: companyId, email: `${companyId}@example.test`, role: 'owner' }],
          invitations: [],
          transfers: [],
          audit: [],
        }),
      );
    }
  });

function ClockProbe() {
  return <output data-clock>{useClock()}</output>;
}
window.mountClock = () =>
  act(async () => {
    root.render(
      <StrictMode>
        <ClockProbe />
      </StrictMode>,
    );
  });
window.flushScreen = () => act(async () => {});

const ignoreChange = () => {};
window.mountWeekly = () =>
  act(async () => {
    root.render(
      <StrictMode>
        <WeeklySchedules
          companyId="company"
          active
          onEnabledChange={ignoreChange}
          onDirtyChange={ignoreChange}
        />
      </StrictMode>,
    );
  });
window.clickScreen = (label) =>
  act(async () => {
    const button = [...document.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === label,
    );
    if (!button) throw new Error('Missing test button: ' + label);
    button.click();
  });

function ThemeProbe() {
  const { theme, toggleTheme } = useWorkspaceTheme();
  return (
    <button data-theme={theme} onClick={toggleTheme}>
      {theme}
    </button>
  );
}
window.hydrationErrors = [];
window.mountTheme = (hydrate) =>
  act(async () => {
    if (!hydrate) {
      root.render(
        <StrictMode>
          <ThemeProbe />
        </StrictMode>,
      );
      return;
    }
    root.unmount();
    const container = document.getElementById('root')!;
    window.serverThemeMarkup = renderToString(
      <StrictMode>
        <ThemeProbe />
      </StrictMode>,
    );
    container.innerHTML = window.serverThemeMarkup;
    root = hydrateRoot(
      container,
      <StrictMode>
        <ThemeProbe />
      </StrictMode>,
      {
        onRecoverableError: (error) => window.hydrationErrors.push(String(error)),
      },
    );
  });

window.mountRecoveredWaste = (kind) =>
  act(async () => {
    const common = {
      companyId: 'company',
      operationId: crypto.randomUUID(),
      effectiveAt: '2026-10-27T12:00:00Z',
      reason: 'spilled',
      note: 'Keep the original note',
    };
    const body =
      kind === 'menu'
        ? {
            ...common,
            sourceKind: 'product',
            sourceId: 'milk',
            sourceVersion: 'v1',
            quantity: 2,
            mode: 'unsold',
            modifiers: [],
          }
        : { ...common, productId: 'milk', expectedVersion: 1, amount: '20', unitId: 'mL' };
    window.recoveredWasteBody = body;
    const key =
      wasteStorageKey('company', 'employee@example.test') + (kind === 'menu' ? ':menu' : '');
    localStorage.setItem(key, '{broken preferences');
    sessionStorage.setItem(
      key + ':pending',
      JSON.stringify({ kind: kind === 'menu' ? 'entry' : 'waste', request: body }),
    );
    root.render(
      <StrictMode>
        {kind === 'menu' ? (
          <MenuWasteRecorder
            companyId="company"
            email="employee@example.test"
            role="employee"
            page
            onEnabledChange={ignoreChange}
            onDirtyChange={ignoreChange}
            onSaved={ignoreChange}
          />
        ) : (
          <WasteRecorder
            companyId="company"
            email="employee@example.test"
            role="employee"
            showButton={false}
            onDirtyChange={ignoreChange}
          />
        )}
      </StrictMode>,
    );
  });

window.mountDelivery = (confirmationId) =>
  act(async () => {
    const order = {
      confirmationId,
      supplierReference: 'Fictional order',
      expectedDelivery: '2026-10-28',
      waitingForReview: false,
      lines: [{ lineId: 'line', sku: 'MILK', description: 'Milk', unitLabel: 'case' }],
    };
    root.render(
      <StrictMode>
        <DeliveryCountForm companyId="company" order={order} onSaved={ignoreChange} />
      </StrictMode>,
    );
  });
const archiveCancel = { current: null };
window.mountArchive = (orderId) =>
  act(async () => {
    root.render(
      <StrictMode>
        <PurchaseOrderArchives
          selection={{ companyId: 'company', source: { kind: 'draft', orderId, revision: 1 } }}
          disabled={false}
          allowSave
          cancelRef={archiveCancel}
          onReload={ignoreChange}
        />
      </StrictMode>,
    );
  });
window.resolveArchive = (orderId, fail = false) =>
  act(async () => {
    for (const request of window.screenRequests.filter(
      (request) => new URL(request.url, location.origin).searchParams.get('orderId') === orderId,
    )) {
      request.resolve(
        fail
          ? Response.json({}, { status: 503 })
          : Response.json({ viewerId: 'actor', artifacts: [], hasMore: false }),
      );
    }
  });
window.archiveAborted = (orderId) =>
  window.screenRequests
    .filter(
      (request) => new URL(request.url, location.origin).searchParams.get('orderId') === orderId,
    )
    .every((request) => request.signal?.aborted);

window.mountLimits = () =>
  act(async () => {
    root.render(
      <StrictMode>
        <SpendingLimitsPanel
          companyId="company"
          active
          onEnabledChange={ignoreChange}
          onDirtyChange={ignoreChange}
        />
      </StrictMode>,
    );
  });
window.resolveLimits = (minor) =>
  act(async () => {
    for (const request of window.screenRequests.filter((request) =>
      request.url.startsWith('/api/po-cart-spending-limits'),
    )) {
      request.resolve(
        Response.json({
          limits: {
            version: 1,
            ownerSet: true,
            perOrderMinor: minor,
            perDayMinor: 20000,
            perMonthMinor: null,
            outstandingMinor: 20000,
            actor: 'owner',
            createdAt: null,
          },
          timeZone: {
            version: 1,
            timeZone: 'UTC',
            actor: 'owner',
            createdAt: '2026-10-27T12:00:00Z',
          },
          usage: null,
          history: [],
          timeZoneHistory: [],
          notice: 'Fictional limits',
        }),
      );
    }
  });
window.mountPayments = (companyId) =>
  act(async () => {
    root.render(
      <StrictMode>
        <PaymentMethods companyId={companyId} companyName={companyId} hasDraft={false} />
      </StrictMode>,
    );
  });
window.resolvePayments = (companyId) =>
  act(async () => {
    for (const request of window.screenRequests.filter(
      (request) =>
        new URL(request.url, location.origin).searchParams.get('companyId') === companyId,
    )) {
      request.resolve(
        Response.json({
          configured: true,
          testMode: true,
          defaultId: 'card',
          cards: [
            {
              id: 'card',
              brand: 'visa',
              last4: companyId === 'first' ? '1111' : '2222',
              month: 12,
              year: 2030,
              name: 'Fictional card',
            },
          ],
        }),
      );
    }
  });
window.mountDurableRecovery = () =>
  act(async () => {
    const body = {
      action: 'authorize',
      companyId: 'company',
      orderId: 'order',
      expectedRevision: 1,
      operationId: crypto.randomUUID(),
    };
    window.recoveredWasteBody = body;
    sessionStorage.setItem(
      intentKey('actor', 'company', 'order'),
      JSON.stringify({ endpoint: 'po-cart-authorizations', body }),
    );
    const order = {
      snapshot: { id: 'order', capMinor: '10000' },
      revision: 1,
      status: 'reviewed',
    } as PurchaseOrderView;
    root.render(
      <StrictMode>
        <DurableCart
          companyId="company"
          order={order}
          initial={{ actorId: 'actor', mode: 'durable', authorization: null, job: null }}
        />
      </StrictMode>,
    );
  });

function pollingView(): ManagerCartView {
  // Only the manager projection consumed in this scenario is needed; no private worker data.
  return {
    actorId: 'actor',
    mode: 'durable',
    authorization: null,
    job: {
      id: 'job',
      revision: 1,
      state: window.cartPollState,
      valid: true,
      reason: null,
      session: null,
      reconciliation: null,
      eligibility: { signIn: false, inspect: false, resume: false, accept: false, abandon: false },
      lines: [],
      verification: [],
      attempted: 0,
      browser: null,
      leaseExpired: false,
      updatedAt: '2026-10-27T12:00:00Z',
      holdReason: null,
    },
  };
}
window.mountPollingCart = () =>
  act(async () => {
    window.cartPollState = 'queued';
    window.cartPollRequests = 0;
    const order = {
      snapshot: { id: 'order', capMinor: '10000' },
      revision: 1,
      status: 'reviewed',
    } as PurchaseOrderView;
    root.render(
      <StrictMode>
        <DurableCart companyId="company" order={order} initial={pollingView()} />
      </StrictMode>,
    );
  });
