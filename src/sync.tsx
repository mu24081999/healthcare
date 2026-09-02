import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type SyncStatus = "online" | "offline" | "syncing";

type SyncContextValue = {
  tick: number;
  status: SyncStatus;
  refreshSync: () => void;
  /** Latest silent live-update banner text (empty when hidden). */
  liveNotice: string;
};

const SyncContext = createContext<SyncContextValue>({
  tick: 0,
  status: "syncing",
  refreshSync: () => {},
  liveNotice: "",
});

type RemoteUpdatePayload = {
  pulled?: number;
  deleted?: number;
  pushed?: number;
};

const NOTICE_MS = 2000;

function requestSync() {
  invoke("sync_db").catch((e) => console.error("Sync error:", e));
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState<SyncStatus>(
    navigator.onLine ? "syncing" : "offline",
  );
  const [liveNotice, setLiveNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeVisible = useRef(false);

  const hideNotice = useCallback(() => {
    setLiveNotice("");
    noticeVisible.current = false;
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    }
  }, []);

  const showSilentNotice = useCallback(
    (message: string) => {
      setLiveNotice(message);
      // Continuous sync polls must not keep extending the hide timer —
      // otherwise the toast never disappears while devices are online.
      if (noticeVisible.current) {
        return;
      }
      noticeVisible.current = true;
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
      }
      noticeTimer.current = setTimeout(() => {
        hideNotice();
      }, NOTICE_MS);
    },
    [hideNotice],
  );

  const refreshSync = useCallback(() => {
    if (!navigator.onLine) {
      setStatus("offline");
      return;
    }
    setStatus("syncing");
    requestSync();
  }, []);

  useEffect(() => {
    const disposers: Array<() => void> = [];

    void listen<string>("sync-status", (event) => {
      const next = event.payload;
      if (next === "online" || next === "offline" || next === "syncing") {
        setStatus(next);
      }
    }).then((dispose) => disposers.push(dispose));

    void listen("sync-complete", () => {
      // Silent UI refresh across all screens that use useSyncTick().
      setTick((value) => value + 1);
      setStatus("online");
    }).then((dispose) => disposers.push(dispose));

    void listen<RemoteUpdatePayload>("sync-remote-update", (event) => {
      const pulled = event.payload?.pulled ?? 0;
      const deleted = event.payload?.deleted ?? 0;
      const total = pulled + deleted;
      if (total <= 0) return;
      // Bump tick again so lists refresh even if sync-complete raced.
      setTick((value) => value + 1);
      showSilentNotice(
        total === 1
          ? "Live update · 1 change synced"
          : `Live update · ${total} changes synced`,
      );
    }).then((dispose) => disposers.push(dispose));

    const onOnline = () => {
      setStatus("syncing");
      requestSync();
    };
    const onOffline = () => setStatus("offline");

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    if (navigator.onLine) {
      requestSync();
    }

    return () => {
      disposers.forEach((dispose) => dispose());
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
        noticeTimer.current = null;
      }
      noticeVisible.current = false;
    };
  }, [showSilentNotice]);

  return (
    <SyncContext.Provider value={{ tick, status, refreshSync, liveNotice }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSyncTick() {
  return useContext(SyncContext).tick;
}

export function useSyncStatus() {
  return useContext(SyncContext).status;
}

export function useRefreshSync() {
  return useContext(SyncContext).refreshSync;
}

export function useLiveNotice() {
  return useContext(SyncContext).liveNotice;
}
