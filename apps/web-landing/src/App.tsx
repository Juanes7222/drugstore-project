import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SiteHeader } from './components/site-header';
import { Hero } from './components/hero';
import { Pillars } from './components/pillars';
import { OfflinePanel } from './components/offline-panel';
import { Pricing } from './components/pricing';
import { Steps } from './components/steps';
import { Faq } from './components/faq';
import { CtaBand } from './components/cta-band';
import { MobileBuyBar } from './components/mobile-buy-bar';
import { SiteFooter } from './components/site-footer';
import { CheckoutDialog } from './components/checkout-dialog';
import { LegalPage } from './components/legal-page';

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <Pillars />
        <OfflinePanel />
        <Pricing />
        <Steps />
        <Faq />
        <CtaBand />
      </main>
      <SiteFooter />
      {/* Mobile-only; hidden ≥ md. Sits above the footer until unmounted. */}
      <MobileBuyBar />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/terminos" element={<LegalPage document="terms" />} />
        <Route path="/privacidad" element={<LegalPage document="privacy" />} />
        <Route path="/datos-personales" element={<LegalPage document="data" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {/* Mounted once; opened from header, pricing documents and CTA band. */}
      <CheckoutDialog />
    </BrowserRouter>
  );
}
