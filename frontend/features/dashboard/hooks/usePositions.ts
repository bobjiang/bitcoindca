import { useQuery } from "@tanstack/react-query";
import { demoSnapshot } from "../data/mock";

async function fetchDemoSnapshot() {
  // Simulate subgraph call latency to exercise query states
  await new Promise((resolve) => setTimeout(resolve, 150));
  return demoSnapshot;
}

export function usePositions() {
  return useQuery({
    queryKey: ["positions", "demo"],
    queryFn: fetchDemoSnapshot,
    staleTime: 60_000,
  });
}
