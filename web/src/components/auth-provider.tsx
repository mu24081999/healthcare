"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import type { SessionUser } from "@/lib/types";

type AuthState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "user"; user: SessionUser };

const Ctx = createContext<{
  state: AuthState;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
} | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    const user = await api.authSession();
    if (user) setState({ status: "user", user });
    else setState({ status: "guest" });
  }, []);

  useEffect(() => {
    refresh().catch(() => setState({ status: "guest" }));
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const user = await api.authLogin(username, password);
    setState({ status: "user", user });
  }, []);

  const logout = useCallback(async () => {
    await api.authLogout();
    setState({ status: "guest" });
  }, []);

  const v = useMemo(
    () => ({ state, login, logout, refresh }),
    [state, login, logout, refresh]
  );

  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const x = useContext(Ctx);
  if (!x) throw new Error("AuthProvider missing");
  return x;
}
