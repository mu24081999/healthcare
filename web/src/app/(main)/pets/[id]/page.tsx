import { Suspense } from "react";
import PetDetailPage from "@/components/pages/pet-detail-page";

export default function Page() {
  return (
    <Suspense fallback={<div className="page"><p>Loading…</p></div>}>
      <PetDetailPage />
    </Suspense>
  );
}
