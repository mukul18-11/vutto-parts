"use client";

import { CameraIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { IScannerControls } from "@zxing/browser";
import { Button } from "@/components/ui/button";
import { cameraErrorKey, classifyScan, type CameraErrorKey } from "@/lib/bin-code";
import { useT } from "@/lib/i18n/client";

type Props = {
  workshopCode: string;
  /** A valid bin code of the user's workshop; return false when it is not a bin offered here. */
  onCode: (code: string) => boolean;
  disabled?: boolean;
};

const noop = () => () => {};
const cameraUsable = () => window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function";

/**
 * QR scanning per SPEC §14: @zxing/browser is loaded only when Scan is tapped; the camera is
 * requested inside the tap (iOS needs the user gesture); <video playsinline muted autoplay>;
 * back camera preferred; QR only; every track stops on the first valid read, close, unmount and
 * page hide. Hidden without a secure context or camera API — the typeahead always works.
 */
export function BinScanner({ workshopCode, onCode, disabled }: Props) {
  const t = useT();
  const usable = useSyncExternalStore(noop, cameraUsable, () => false);
  const [phase, setPhase] = useState<"idle" | "starting" | "scanning">("idle");
  const [cameraError, setCameraError] = useState<CameraErrorKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const runRef = useRef(0);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  const stopAll = useCallback(() => {
    runRef.current += 1; // a start still awaiting the camera stops its stream when it resolves
    try {
      controlsRef.current?.stop();
    } catch {
      // already stopped
    }
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setPhase("idle");
  }, []);

  // Unmount and page hide always release the camera.
  useEffect(() => {
    const onHide = () => stopAll();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stopAll();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      stopAll();
    };
  }, [stopAll]);

  const start = async () => {
    const run = ++runRef.current;
    setPhase("starting");
    setCameraError(null);
    setMessage(null);
    try {
      const [stream, zxing] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }),
        import("@zxing/browser"),
      ]);
      if (run !== runRef.current || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setPhase("scanning");
      const reader = new zxing.BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 200 });
      const controls = await reader.decodeFromStream(stream, videoRef.current, (result) => {
        if (!result || run !== runRef.current) return;
        const scan = classifyScan(result.getText(), workshopCode);
        if (!scan.ok) {
          setMessage(
            scan.reason === "other_workshop"
              ? t("binPicker.otherWorkshop", { name: t(`binPicker.wsName.${scan.workshopCode}`) })
              : t("binPicker.notBinLabel"),
          );
          return;
        }
        if (onCodeRef.current(scan.code)) stopAll();
        else setMessage(t("binPicker.binNotHere", { code: scan.code }));
      });
      if (run !== runRef.current) controls.stop();
      else controlsRef.current = controls;
    } catch (e) {
      if (run !== runRef.current) return;
      stopAll();
      setCameraError(cameraErrorKey(e));
    }
  };

  if (!usable) return null;

  return (
    <div className="flex flex-col gap-2">
      {phase === "idle" ? (
        <Button type="button" variant="outline" className="h-12 text-base" disabled={disabled} onClick={start}>
          <CameraIcon className="size-5" /> {t("binPicker.scan")}
        </Button>
      ) : (
        <Button type="button" variant="outline" className="h-12 text-base" onClick={stopAll}>
          <XIcon className="size-5" /> {t("binPicker.closeScanner")}
        </Button>
      )}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={phase === "idle" ? "hidden" : "aspect-square w-full max-w-sm rounded-lg bg-black object-cover"}
      />
      {phase === "starting" && <p className="text-sm text-muted-foreground">{t("binPicker.starting")}</p>}
      {message && (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
          {message}
        </p>
      )}
      {cameraError && (
        <p role="alert" className="text-sm text-destructive">
          {t(`binPicker.camera.${cameraError}`)}
        </p>
      )}
    </div>
  );
}
