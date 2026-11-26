import { Suspense } from "react";
import { Home } from "./_home";
import { Loading } from "./_ui";

export default function ShopHome() {
  return (
    <Suspense fallback={<Loading />}>
      <Home />
    </Suspense>
  );
}
