import { useMutation } from "@tanstack/react-query";

interface ExecutePayload {
  positionId: number;
  usePrivate: boolean;
}

interface ExecuteResult {
  hash: string;
  mode: "private" | "public";
}

async function executePositionRequest(payload: ExecutePayload): Promise<ExecuteResult> {
  const response = await fetch("/api/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? "Failed to submit execution transaction");
  }

  return data as ExecuteResult;
}

export function useExecutePosition() {
  return useMutation({
    mutationKey: ["execute-position"],
    mutationFn: executePositionRequest,
  });
}
