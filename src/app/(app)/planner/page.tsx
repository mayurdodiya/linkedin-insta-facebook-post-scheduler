import { Suspense } from 'react';
import Planner from '@/views/Planner';

export default function Page() {
  // Planner reads ?instant=1 via useSearchParams, which needs a Suspense boundary
  return (
    <Suspense fallback={null}>
      <Planner />
    </Suspense>
  );
}
