import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { PageFrame } from "./components/page-frame";
import { Hero } from "./components/hero";
import { Counter } from "./components/counter";
import { Thesis } from "./components/thesis";
import { OfflinePanel } from "./components/offline-panel";
import { Pricing } from "./components/pricing";
import { Steps } from "./components/steps";
import { Faq } from "./components/faq";
import { CtaBand } from "./components/cta-band";
import { MobileBuyBar } from "./components/mobile-buy-bar";
import { StructuredData } from "./components/structured-data";
import { CheckoutDialog } from "./components/checkout-dialog";
import { LegalPage } from "./components/legal-page";
import { NotFound } from "./components/not-found";
import { usePlansStore } from "./stores/plans-store";

/**
 * Resets scroll on navigation, but honours a fragment.
 *
 * The fragment needs looking up by hand. This is an SPA: on a cold load the
 * browser tries to jump before React has rendered the target, so the jump finds
 * nothing and the shared link /#faq silently lands on the hero. Resolving it
 * here is also why the hash branch does not scroll to the top.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    document
      .getElementById(decodeURIComponent(hash.slice(1)))
      ?.scrollIntoView();
  }, [pathname, hash]);

  return null;
}

function LandingPage() {
  // Seed prices paint immediately; this refreshes them in place from the
  // server. Fire-and-forget: failures keep the seed and the status line
  // in the pricing section explains it.
  const loadPlansFromServer = usePlansStore((state) => state.loadFromServer);
  const plans = usePlansStore((state) => state.plans);

  useEffect(() => {
    void loadPlansFromServer();
  }, [loadPlansFromServer]);

  return (
    <>
      <PageFrame>
        <StructuredData plans={plans} />
        <main id="contenido">
          <Hero />
          <Counter />
          <Thesis />
          <OfflinePanel />
          <Pricing />
          <Steps />
          <Faq />
          <CtaBand />
        </main>
      </PageFrame>
      {/* Mobile-only; hidden ≥ lg. Sits above the footer until unmounted. */}
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
        <Route
          path="/terminos"
          element={
            <PageFrame>
              <LegalPage document="terms" />
            </PageFrame>
          }
        />
        <Route
          path="/privacidad"
          element={
            <PageFrame>
              <LegalPage document="privacy" />
            </PageFrame>
          }
        />
        <Route
          path="/datos-personales"
          element={
            <PageFrame>
              <LegalPage document="data" />
            </PageFrame>
          }
        />
        {/* A branded 404, not a silent redirect: the visitor asked for a
            specific document and deserves to be told which one is missing. */}
        <Route
          path="*"
          element={
            <PageFrame>
              <NotFound />
            </PageFrame>
          }
        />
      </Routes>
      {/* Mounted once; opened from header, pricing documents and CTA band. */}
      <CheckoutDialog />
    </BrowserRouter>
  );
}
