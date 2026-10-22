import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
let csrfToken = "";
const apiBase = import.meta.env.VITE_API_BASE ?? "/api/v1";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public fieldErrors: any[] = [],
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await fetch(apiBase + path, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body
        ? { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }
        : {}),
      ...options.headers,
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new ApiError(
      data.error?.message ?? "请求失败，请稍后重试",
      r.status,
      data.error?.code ?? "REQUEST_FAILED",
      data.error?.fieldErrors ?? [],
    );
  if (data.csrfToken) csrfToken = data.csrfToken;
  return data;
}
export const json = (value: unknown) => JSON.stringify(value);
interface Auth {
  user: { id: string; username: string } | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  notify: (s: string) => void;
}
const AuthContext = createContext<Auth>(null!);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Auth["user"]>(null),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState("");
  useEffect(() => {
    api("/auth/me")
      .then((x) => setUser(x.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 4500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login: async (username, password) => {
          const x = await api("/auth/login", {
            method: "POST",
            body: json({ username, password }),
          });
          setUser(x.user);
        },
        logout: async () => {
          await api("/auth/logout", { method: "POST", body: "{}" });
          csrfToken = "";
          setUser(null);
        },
        notify: setNotice,
      }}
    >
      {children}
      {notice && (
        <div role="status" className="toast">
          {notice}
        </div>
      )}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
export function useData<T = any>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    setError("");
    return api<T>(path)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    let live = true;
    setLoading(true);
    setData(null);
    setError("");
    api<T>(path)
      .then((x) => {
        if (live) setData(x);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path]);
  return { data, setData, error, loading, reload: load };
}
