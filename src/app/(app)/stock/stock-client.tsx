"use client";

import { useRouter } from "next/navigation";
import { PartPicker } from "@/components/part-picker";
import { RpcButton } from "@/components/rpc-dialog";
import { useT } from "@/lib/i18n/client";
import { requestBinCount } from "./actions";

/** Part search (search_parts) that opens the part's stock card via ?part=. */
export function StockSearch({ workshopId, selectedId, baseHref }: { workshopId: string; selectedId: string | null; baseHref: string }) {
  const router = useRouter();
  return (
    <PartPicker
      workshopId={workshopId}
      selectedId={selectedId}
      testId="stock-search"
      onPick={(p) => {
        const sep = baseHref.includes("?") ? "&" : "?";
        router.push(`${baseHref}${sep}part=${p.part_id}`);
      }}
    />
  );
}

/** "Bin count wrong": puts the bin on the manager's count list (request_bin_count). */
export function BinCountWrong({ userId, binId, code }: { userId: string; binId: string; code: string }) {
  const t = useT();
  return (
    <RpcButton
      userId={userId}
      action={requestBinCount}
      values={{ bin_id: binId }}
      label={t("stock.binCountWrong")}
      variant="outline"
      testId={`count-wrong-${code}`}
    />
  );
}
