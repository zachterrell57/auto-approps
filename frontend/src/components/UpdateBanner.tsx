import { Download, RefreshCw } from "lucide-react";
import type { UpdateStatusType } from "@/lib/types";

interface UpdateBannerProps {
  status: Extract<UpdateStatusType, "available" | "downloaded">;
  releaseName?: string;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({
  status,
  releaseName,
  onInstall,
  onDismiss,
}: UpdateBannerProps) {
  return (
    <div className="mx-5 mt-3 flex items-center gap-3 rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-2.5 text-sm text-amber-800">
      {status === "downloaded" ? (
        <Download className="h-4 w-4 shrink-0 text-amber-600" />
      ) : (
        <RefreshCw className="h-4 w-4 shrink-0 text-amber-600 animate-spin" />
      )}
      <span className="flex-1">
        {status === "downloaded"
          ? `A new version${releaseName ? ` (${releaseName})` : ""} is ready to install.`
          : `A new version${releaseName ? ` (${releaseName})` : ""} is available and downloading in the background.`}
      </span>
      {status === "downloaded" && (
        <button
          type="button"
          onClick={onInstall}
          className="h-8 rounded-lg bg-amber-600 px-3 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
        >
          Restart Now
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="h-8 rounded-lg border border-amber-300/70 px-3 text-xs font-medium text-amber-700 hover:bg-amber-100/70 transition-colors"
      >
        {status === "downloaded" ? "Later" : "Dismiss"}
      </button>
    </div>
  );
}
