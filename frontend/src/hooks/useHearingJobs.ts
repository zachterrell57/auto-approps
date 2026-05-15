import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import type {
  HearingCreateInput,
  HearingExportFormat,
  HearingJobSummary,
  HearingOutputType,
  HearingTranscriptSegment,
  HearingWatchItemDraft,
  HearingWorkspace,
} from "@/lib/types";

export function useHearingJobs() {
  const [jobs, setJobs] = useState<HearingJobSummary[]>([]);
  const [workspace, setWorkspace] = useState<HearingWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshJobs = useCallback(async () => {
    const nextJobs = await api.listHearingJobs();
    setJobs(nextJobs);
    return nextJobs;
  }, []);

  const loadWorkspace = useCallback(async (id: string) => {
    const next = await api.getHearingWorkspace(id);
    setWorkspace(next);
    return next;
  }, []);

  useEffect(() => {
    void refreshJobs().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [refreshJobs]);

  const runAction = useCallback(
    async <T,>(label: string, action: () => Promise<T>, reloadId?: string) => {
      setLoading(true);
      setBusyLabel(label);
      setError(null);
      try {
        const result = await action();
        await refreshJobs();
        if (reloadId) await loadWorkspace(reloadId);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setLoading(false);
        setBusyLabel(null);
      }
    },
    [loadWorkspace, refreshJobs],
  );

  const createJob = useCallback(
    async (input: HearingCreateInput) =>
      runAction("Creating hearing job", async () => {
        const job = await api.createHearingJob(input);
        await loadWorkspace(job.id);
        return job;
      }),
    [loadWorkspace, runAction],
  );

  const resolveJob = useCallback(
    async (id: string) =>
      runAction("Resolving source", () => api.resolveHearingJob(id), id),
    [runAction],
  );

  const resolveStream = useCallback(
    async (id: string) =>
      runAction("Resolving YouTube video", () => api.resolveHearingStream(id), id),
    [runAction],
  );

  const startCapture = useCallback(
    async (id: string, streamUrl?: string) =>
      runAction(
        "Starting YouTube capture",
        () => api.startHearingCapture(id, streamUrl),
        id,
      ),
    [runAction],
  );

  const stopCapture = useCallback(
    async (id: string) =>
      runAction("Finalizing live transcript", () => api.stopHearingCapture(id), id),
    [runAction],
  );

  const refreshCaptureStatus = useCallback(
    async (id: string) => {
      const next = await api.getHearingCaptureStatus(id);
      setWorkspace(next);
      await refreshJobs();
      return next;
    },
    [refreshJobs],
  );

  const importTranscript = useCallback(
    async (
      id: string,
      input:
        | { text: string; filename?: string; source?: HearingTranscriptSegment["source"] }
        | { transcript_url: string }
        | { media_url: string },
    ) =>
      runAction(
        "Importing transcript",
        () => api.importHearingTranscript({ hearing_job_id: id, ...input }),
        id,
      ),
    [runAction],
  );

  const saveWatchlist = useCallback(
    async (id: string, watchItems: HearingWatchItemDraft[]) =>
      runAction(
        "Saving watchlist",
        () => api.updateHearingWatchlist(id, watchItems),
        id,
      ),
    [runAction],
  );

  const detectHits = useCallback(
    async (id: string) =>
      runAction("Detecting watchlist hits", () => api.runHearingWatchlist(id), id),
    [runAction],
  );

  const generateOutput = useCallback(
    async (
      id: string,
      outputType: HearingOutputType,
      reviewerInstructions?: string,
    ) =>
      runAction(
        "Generating output",
        () =>
          api.generateHearingOutput({
            hearing_job_id: id,
            output_type: outputType,
            reviewer_instructions: reviewerInstructions,
          }),
        id,
      ),
    [runAction],
  );

  const runPipeline = useCallback(
    async (
      id: string,
      outputType?: HearingOutputType,
      reviewerInstructions?: string,
    ) =>
      runAction(
        "Running hearing pipeline",
        () =>
          api.runHearingJob({
            hearing_job_id: id,
            output_type: outputType,
            reviewer_instructions: reviewerInstructions,
          }),
        id,
      ),
    [runAction],
  );

  const generateFinalBrief = useCallback(
    async (
      id: string,
      outputType?: HearingOutputType,
      reviewerInstructions?: string,
    ) =>
      runAction(
        "Generating final briefing",
        () =>
          api.generateFinalHearingBrief({
            hearing_job_id: id,
            output_type: outputType,
            reviewer_instructions: reviewerInstructions,
          }),
        id,
      ),
    [runAction],
  );

  const saveOutput = useCallback(
    async (
      id: string,
      outputId: string,
      markdown: string,
      reviewStatus: "unreviewed" | "verified" | "needs_review",
    ) =>
      runAction(
        "Saving review",
        () =>
          api.updateHearingReview({
            output_id: outputId,
            output_markdown: markdown,
            output_review_status: reviewStatus,
          }),
        id,
      ),
    [runAction],
  );

  const markSegment = useCallback(
    async (
      id: string,
      segmentId: string,
      reviewStatus: "unreviewed" | "verified" | "needs_review",
      speakerLabel?: string,
    ) =>
      runAction(
        "Updating transcript review",
        () =>
          api.updateHearingReview({
            segment_id: segmentId,
            segment_review_status: reviewStatus,
            speaker_label: speakerLabel,
          }),
        id,
      ),
    [runAction],
  );

  const updateHitStatus = useCallback(
    async (
      id: string,
      hitId: string,
      status: "new" | "reviewed" | "dismissed" | "exported",
    ) =>
      runAction(
        "Updating hit",
        () => api.updateHearingReview({ hit_id: hitId, hit_status: status }),
        id,
      ),
    [runAction],
  );

  const updateClaimStatus = useCallback(
    async (
      id: string,
      claimId: string,
      status: "supported" | "weak_support" | "unsupported" | "needs_review",
    ) =>
      runAction(
        "Updating claim",
        () =>
          api.updateHearingReview({
            claim_id: claimId,
            claim_verification_status: status,
          }),
        id,
      ),
    [runAction],
  );

  const addComment = useCallback(
    async (
      id: string,
      targetType: "job" | "segment" | "hit" | "claim" | "output",
      targetId: string,
      comment: string,
    ) =>
      runAction(
        "Saving comment",
        () =>
          api.addHearingComment({
            hearing_job_id: id,
            target_type: targetType,
            target_id: targetId,
            comment,
          }),
        id,
      ),
    [runAction],
  );

  const exportResults = useCallback(
    async (id: string, format: HearingExportFormat, outputId?: string) =>
      runAction("Exporting", async () => {
        const result = await api.exportHearingResults({
          hearing_job_id: id,
          format,
          output_id: outputId,
        });
        const blob = new Blob([result.buffer], { type: result.mime_type });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        return result;
      }, id),
    [runAction],
  );

  return {
    jobs,
    workspace,
    loading,
    busyLabel,
    error,
    refreshJobs,
    loadWorkspace,
    createJob,
    resolveJob,
    resolveStream,
    startCapture,
    stopCapture,
    refreshCaptureStatus,
    importTranscript,
    saveWatchlist,
    detectHits,
    generateOutput,
    runPipeline,
    generateFinalBrief,
    saveOutput,
    markSegment,
    updateHitStatus,
    updateClaimStatus,
    addComment,
    exportResults,
    setError,
  };
}
