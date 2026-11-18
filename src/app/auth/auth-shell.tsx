import { Boxes, ChefHat, Package, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import './auth.css';

export function AuthBrand({ light = false }: { light?: boolean }) {
  return (
    <Link className={light ? 'auth-brand auth-brand-light' : 'auth-brand'} href="/">
      <span aria-hidden="true">
        <Package size={22} />
      </span>
      <span>
        pantrack<span className="auth-brand-period">.</span>
      </span>
    </Link>
  );
}

const benefits = [
  { icon: Boxes, text: 'Stock counts, deliveries and waste in one list' },
  { icon: ChefHat, text: 'Recipes that take stock off with every sale' },
  { icon: ShieldCheck, text: 'Each café’s information stays private to its team' },
];

/** Shared frame for the signed-out screens: a short story beside one focused card. */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <aside className="auth-story">
        <AuthBrand light />
        <div className="auth-story-copy">
          <p className="auth-eyebrow">For cafés and small kitchens</p>
          <h2>Know what’s on the shelf before you run out.</h2>
          <ul>
            {benefits.map(({ icon: Icon, text }) => (
              <li key={text}>
                <Icon size={18} aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="auth-story-note">
          Pilot version. Ordering from suppliers isn’t switched on yet.
        </p>
      </aside>
      <section className="auth-panel">
        <div className="auth-mobile-brand">
          <AuthBrand />
        </div>
        <div className="auth-card">{children}</div>
        <p className="auth-mobile-note">
          Pilot version. Ordering from suppliers isn’t switched on yet.
        </p>
      </section>
    </main>
  );
}
