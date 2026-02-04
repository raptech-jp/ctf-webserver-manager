"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AGENT_URL } from "../../lib/api";

type PortRangeInput = {
  start: string;
  end: string;
};

export default function SettingsPage() {
  const [ranges, setRanges] = useState<PortRangeInput[]>([]);
  const [mysqlRootPassword, setMysqlRootPassword] = useState("");
  const [mysqlDatabase, setMysqlDatabase] = useState("ctf");
  const [mysqlUser, setMysqlUser] = useState("root");
  const [mysqlPassword, setMysqlPassword] = useState("");
  const [host, setHost] = useState("");
  const [hostScheme, setHostScheme] = useState<"http" | "https">("http");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "error" | "notice"; message: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastShowRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`${AGENT_URL}/settings`)
      .then((res) => res.json())
      .then((data) => {
        const nextRanges = (data.port_ranges ?? []).map((range: { start: number; end: number }) => ({
          start: String(range.start),
          end: String(range.end),
        }));
        setRanges(nextRanges);
        setHost(data.host ?? "");
        setHostScheme(data.host_scheme === "https" ? "https" : "http");
        setMysqlRootPassword(data.mysql_root_password ?? "");
        setMysqlDatabase(data.mysql_database ?? "ctf");
        setMysqlUser(data.mysql_user ?? "root");
        setMysqlPassword(data.mysql_password ?? "");
      })
      .catch(() => setError("設定の取得に失敗しました"));
  }, []);

  useEffect(() => {
    const message = error ?? notice;
    const type = error ? "error" : notice ? "notice" : null;
    if (!message || !type) {
      return;
    }
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    if (toastShowRef.current) {
      clearTimeout(toastShowRef.current);
    }
    setToast(null);
    toastShowRef.current = setTimeout(() => {
      setToast({ type, message });
      toastTimerRef.current = setTimeout(() => {
        setToast(null);
        setError(null);
        setNotice(null);
      }, 2500);
    }, 60);
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      if (toastShowRef.current) {
        clearTimeout(toastShowRef.current);
      }
    };
  }, [error, notice]);

  const updateRange = (index: number, key: keyof PortRangeInput, value: string) => {
    setRanges((prev) =>
      prev.map((range, i) => (i === index ? { ...range, [key]: value } : range))
    );
  };

  const addRange = () => {
    setRanges((prev) => [...prev, { start: "44000", end: "44100" }]);
  };

  const removeRange = (index: number) => {
    setRanges((prev) => prev.filter((_, i) => i !== index));
  };

  const savePortRanges = async () => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const parsedRanges = ranges.map((range) => {
        if (range.start.trim() === "" || range.end.trim() === "") {
          throw new Error("Start/Endを入力してください");
        }
        const start = Number(range.start);
        const end = Number(range.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          throw new Error("Start/Endは数値で入力してください");
        }
        return { start, end };
      });
      const response = await fetch(`${AGENT_URL}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          port_ranges: parsedRanges,
        }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "保存に失敗しました");
      }
      setNotice("保存しました");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const saveMysqlSettings = async () => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const response = await fetch(`${AGENT_URL}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mysql_root_password: mysqlRootPassword,
          mysql_database: mysqlDatabase,
          mysql_user: mysqlUser,
          mysql_password: mysqlUser === "root" ? mysqlRootPassword : mysqlPassword,
        }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "保存に失敗しました");
      }
      setNotice("保存しました");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const saveFqdn = async () => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const response = await fetch(`${AGENT_URL}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host,
          host_scheme: hostScheme,
        }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "保存に失敗しました");
      }
      setNotice("保存しました");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-mono uppercase tracking-[0.3em] text-zinc-500">
            Settings
          </p>
          <h1 className="text-3xl font-semibold text-zinc-900">Settings</h1>
          <p className="mt-2 text-sm text-zinc-600">
            起動設定とMySQL認証情報をまとめて管理します。
          </p>
        </div>
        <Link
          href="/"
          className="rounded-full border border-zinc-300 bg-white/70 px-5 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-400"
        >
          Back
        </Link>
      </header>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div
            className={`toast-float pointer-events-auto rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
              toast.type === "error"
                ? "border-red-200 bg-red-50/80 text-red-700"
                : "border-emerald-200 bg-emerald-50/80 text-emerald-700"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      <section className="rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">Port Ranges</h2>
          <p className="mt-1 text-sm text-zinc-600">
            空きポート探索に利用する範囲を指定します。
          </p>
        </div>
        <div className="space-y-4">
          {ranges.map((range, index) => (
            <div key={index} className="flex flex-wrap gap-3">
              <label className="flex flex-col text-sm">
                <span className="text-xs uppercase tracking-wide text-zinc-500">Start</span>
                <input
                  type="number"
                  value={range.start}
                  onChange={(event) => updateRange(index, "start", event.target.value)}
                  className="w-32 rounded-2xl border border-zinc-200 bg-white px-3 py-2"
                />
              </label>
              <label className="flex flex-col text-sm">
                <span className="text-xs uppercase tracking-wide text-zinc-500">End</span>
                <input
                  type="number"
                  value={range.end}
                  onChange={(event) => updateRange(index, "end", event.target.value)}
                  className="w-32 rounded-2xl border border-zinc-200 bg-white px-3 py-2"
                />
              </label>
              <button
                className="mt-6 rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-600 hover:border-zinc-400"
                onClick={() => removeRange(index)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:border-zinc-400"
            onClick={addRange}
          >
            Add Range
          </button>
          <button
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
            onClick={savePortRanges}
            disabled={loading}
          >
            Save
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">Host</h2>
          <p className="mt-1 text-sm text-zinc-600">
            URLコピー用のHostを指定します（例: ctf.example.com）。
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-sm">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Scheme</span>
            <select
              value={hostScheme}
              onChange={(event) =>
                setHostScheme(event.target.value === "https" ? "https" : "http")
              }
              className="h-10 rounded-2xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="http">http</option>
              <option value="https">https</option>
            </select>
          </label>
          <label className="flex flex-1 flex-col text-sm">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Host</span>
            <input
              type="text"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              className="rounded-2xl border border-zinc-200 bg-white px-3 py-2"
              placeholder="ctf.example.com"
            />
          </label>
          <button
            className="h-10 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
            onClick={saveFqdn}
            disabled={loading}
          >
            Save
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">MySQL</h2>
          <p className="mt-1 text-sm text-zinc-600">
            ChallengeでMySQLを選択した場合に使用される認証情報です。
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col text-sm">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Root Password</span>
            <input
              type="text"
              value={mysqlRootPassword}
              onChange={(event) => setMysqlRootPassword(event.target.value)}
              className="rounded-2xl border border-zinc-200 bg-white px-3 py-2"
            />
          </label>
          <label className="flex flex-col text-sm">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Database</span>
            <input
              type="text"
              value={mysqlDatabase}
              onChange={(event) => setMysqlDatabase(event.target.value)}
              className="rounded-2xl border border-zinc-200 bg-white px-3 py-2"
            />
          </label>
          <label className="flex flex-col text-sm">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Username</span>
            <input
              type="text"
              value={mysqlUser}
              onChange={(event) => setMysqlUser(event.target.value)}
              className="rounded-2xl border border-zinc-200 bg-white px-3 py-2"
            />
          </label>
          <label className="flex flex-col text-sm">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Password</span>
            <input
              type="text"
              value={mysqlUser === "root" ? mysqlRootPassword : mysqlPassword}
              onChange={(event) => setMysqlPassword(event.target.value)}
              disabled={mysqlUser === "root"}
              className={`rounded-2xl border border-zinc-200 px-3 py-2 ${
                mysqlUser === "root" ? "bg-zinc-100 text-zinc-400" : "bg-white"
              }`}
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Usernameが <span className="font-mono">root</span> の場合、PasswordはRoot Passwordと同一になります。
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
            onClick={saveMysqlSettings}
            disabled={loading}
          >
            Save
          </button>
        </div>
      </section>
    </div>
  );
}
