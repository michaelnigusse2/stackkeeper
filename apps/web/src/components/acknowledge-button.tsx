"use client";

import { useTransition } from "react";
import { acknowledgeAlertAction } from "@/lib/actions/monitors";

export function AcknowledgeButton({ alertId }: { alertId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="button small"
      disabled={pending}
      onClick={() => start(() => void acknowledgeAlertAction(alertId))}
    >
      {pending ? "Closing…" : "Mark done"}
    </button>
  );
}
