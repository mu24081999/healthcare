import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { api } from "../api";
import type { ClinicRow } from "../api";
import { useSyncTick } from "../sync";

interface ClinicContextValue {
  clinic: ClinicRow | null;
  /** Call after saving clinic info to refresh the cached data globally. */
  refresh: () => void;
}

const ClinicContext = createContext<ClinicContextValue>({
  clinic: null,
  refresh: () => {},
});

export function ClinicProvider({ children }: { children: ReactNode }) {
  const [clinic, setClinic] = useState<ClinicRow | null>(null);
  const syncTick = useSyncTick();

  const load = () => {
    api
      .clinicGet()
      .then((data) => {
        console.log("Clinic data loaded:", data);
        setClinic(data);
      })
      .catch((e) => console.error("Clinic load error:", e));
  };

  // Fetch clinic info on mount
  useEffect(() => {
    load();
  }, [syncTick]);

  return (
    <ClinicContext.Provider value={{ clinic, refresh: load }}>
      {children}
    </ClinicContext.Provider>
  );
}

export function useClinic() {
  return useContext(ClinicContext);
}
