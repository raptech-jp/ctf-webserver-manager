"use client";

import { useCallback, useEffect, useState } from "react";
import type { DragEvent } from "react";
import Link from "next/link";
import { AGENT_URL } from "../lib/api";

type Challenge = {
  id: string;
  name: string;
  runtime: "php" | "flask";
  runtime_version: string;
  db_type: "none" | "mysql";
  created_at: string;
  updated_at: string;
  files_hash: string;
  storage_path: string;
};

type Instance = {
  id: string;
  challenge_id: string;
  status: "running" | "stopped" | "error";
  host_port: number;
  container_port: number;
  compose_project: string;
  created_at: string;
  updated_at: string;
};

type ChallengeDetail = {
  challenge: Challenge;
  instances: Instance[];
};

type ChallengeForm = {
  name: string;
  runtime: "php" | "flask";
  runtime_version: string;
  db_type: "none" | "mysql";
  zip: File | null;
};

const runtimeDefaults: Record<ChallengeForm["runtime"], string> = {
  php: "8.2",
  flask: "3.11",
};

export default function Home() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [details, setDetails] = useState<Record<string, ChallengeDetail>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsText, setLogsText] = useState("");
  const [isChallengeDrag, setIsChallengeDrag] = useState(false);
  const [isImportDrag, setIsImportDrag] = useState(false);

  const [challengeForm, setChallengeForm] = useState<ChallengeForm>({
    name: "",
    runtime: "php",
    runtime_version: runtimeDefaults.php,
    db_type: "none",
    zip: null,
  });
  const [importZip, setImportZip] = useState<File | null>(null);

  const fetchDetail = useCallback(async (challengeId: string) => {
    const response = await fetch(`${AGENT_URL}/challenges/${challengeId}`);
    if (!response.ok) {
      throw new Error("Challenge詳細の取得に失敗しました");
    }
    const data = (await response.json()) as ChallengeDetail;
    setDetails((prev) => ({ ...prev, [challengeId]: data }));
    return data;
  }, []);

  const fetchChallenges = useCallback(async () => {
    const response = await fetch(`${AGENT_URL}/challenges`);
    if (!response.ok) {
      throw new Error("Challenge一覧の取得に失敗しました");
    }
    const data = (await response.json()) as Challenge[];
    setChallenges(data);
    setDetails((prev) => {
      const next: Record<string, ChallengeDetail> = {};
      for (const challenge of data) {
        if (prev[challenge.id]) {
          next[challenge.id] = prev[challenge.id];
        }
      }
      return next;
    });
    await Promise.allSettled(data.map((challenge) => fetchDetail(challenge.id)));
  }, [fetchDetail]);

  useEffect(() => {
    fetchChallenges().catch((err) => setError(err.message));
  }, [fetchChallenges]);
  const ensureDetail = useCallback(
    async (challengeId: string) => {
      if (details[challengeId]) {
        return details[challengeId];
      }
      return await fetchDetail(challengeId);
    },
    [details, fetchDetail]
  );

  const ensureInstance = useCallback(
    async (challengeId: string) => {
      const detail = await ensureDetail(challengeId);
      if (detail.instances.length === 0) {
        throw new Error("インスタンスがありません");
      }
      return detail.instances[0];
    },
    [ensureDetail]
  );

  const handleCreateChallenge = async () => {
    setError(null);
    setNotice(null);
    if (!challengeForm.zip) {
      setError("ZIPファイルを選択してください");
      return;
    }
    if (!challengeForm.name.trim()) {
      setError("名前を入力してください");
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("zip", challengeForm.zip);
      formData.append(
        "metadata",
        JSON.stringify({
          name: challengeForm.name,
          runtime: challengeForm.runtime,
          runtime_version: challengeForm.runtime_version,
          db_type: challengeForm.db_type,
        })
      );
      const response = await fetch(`${AGENT_URL}/challenges`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Challenge作成に失敗しました");
      }
      setChallengeForm((prev) => ({ ...prev, name: "", zip: null }));
      setNotice("Challengeを登録しました");
      await fetchChallenges();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const extractZipFile = (files: FileList | null): File | null => {
    if (!files || files.length === 0) {
      return null;
    }
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("ZIPファイルを選択してください");
      return null;
    }
    setError(null);
    return file;
  };

  const handleChallengeDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsChallengeDrag(false);
    const file = extractZipFile(event.dataTransfer?.files ?? null);
    if (file) {
      setChallengeForm((prev) => ({ ...prev, zip: file }));
    }
  };

  const handleImportDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsImportDrag(false);
    const file = extractZipFile(event.dataTransfer?.files ?? null);
    if (file) {
      setImportZip(file);
    }
  };

  const handleImport = async () => {
    setError(null);
    setNotice(null);
    if (!importZip) {
      setError("インポート用ZIPを選択してください");
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("zip", importZip);
      const response = await fetch(`${AGENT_URL}/import`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "インポートに失敗しました");
      }
      setImportZip(null);
      setNotice("インポートが完了しました");
      await fetchChallenges();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async (challengeId: string) => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const response = await fetch(`${AGENT_URL}/instances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge_id: challengeId }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "起動に失敗しました");
      }
      setNotice("インスタンスを起動しました");
      await fetchDetail(challengeId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async (challengeId: string) => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const instance = await ensureInstance(challengeId);
      const response = await fetch(`${AGENT_URL}/instances/${instance.id}/stop`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "停止に失敗しました");
      }
      setNotice("停止しました");
      await fetchDetail(challengeId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogs = async (challengeId: string) => {
    setError(null);
    setLoading(true);
    try {
      const instance = await ensureInstance(challengeId);
      const response = await fetch(`${AGENT_URL}/instances/${instance.id}/logs?tail=200`);
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "ログ取得に失敗しました");
      }
      const data = (await response.json()) as { logs: string };
      setLogsText(data.logs || "(No logs)");
      setLogsOpen(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (challengeId: string) => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const response = await fetch(`${AGENT_URL}/challenges/${challengeId}/export`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "エクスポートに失敗しました");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "challenge-pack.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setNotice("エクスポートしました");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteChallenge = async (challengeId: string) => {
    if (!confirm("このChallengeを削除します。よろしいですか？")) {
      return;
    }
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const response = await fetch(`${AGENT_URL}/challenges/${challengeId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Challenge削除に失敗しました");
      }
      setNotice("Challengeを削除しました");
      await fetchChallenges();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = (hostPort: number) => {
    window.open(`http://127.0.0.1:${hostPort}/`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="min-h-screen px-6 py-10 text-foreground">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-mono uppercase tracking-[0.3em] text-zinc-500">
            Local CTF Orchestration
          </p>
          <h1 className="text-3xl font-semibold text-zinc-900">CTF Web Launcher</h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-600">
            ZIPを登録し、ランタイムとDBを選ぶだけでDocker Composeの起動・停止・ログ確認を行います。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="rounded-full border border-zinc-300 bg-white/70 px-5 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-400"
          >
            Settings
          </Link>
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-6">
          <section
            className={`rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-sm transition ${
              isChallengeDrag ? "ring-2 ring-zinc-900/20" : ""
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsChallengeDrag(true);
            }}
            onDragLeave={() => setIsChallengeDrag(false)}
            onDrop={handleChallengeDrop}
          >
            <h2 className="mb-4 text-lg font-semibold text-zinc-900">New Challenge</h2>
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">Name</span>
                <input
                  value={challengeForm.name}
                  onChange={(event) =>
                    setChallengeForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                  placeholder="My CTF Challenge"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">
                    Runtime
                  </span>
                  <select
                    value={challengeForm.runtime}
                    onChange={(event) =>
                      setChallengeForm((prev) => ({
                        ...prev,
                        runtime: event.target.value as ChallengeForm["runtime"],
                        runtime_version: runtimeDefaults[
                          event.target.value as ChallengeForm["runtime"]
                        ],
                      }))
                    }
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="php">PHP (Apache)</option>
                    <option value="flask">Flask (Gunicorn)</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">
                    Version
                  </span>
                  <input
                    value={challengeForm.runtime_version}
                    onChange={(event) =>
                      setChallengeForm((prev) => ({
                        ...prev,
                        runtime_version: event.target.value,
                      }))
                    }
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                    placeholder="8.2"
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">DB</span>
                <select
                  value={challengeForm.db_type}
                  onChange={(event) =>
                    setChallengeForm((prev) => ({
                      ...prev,
                      db_type: event.target.value as ChallengeForm["db_type"],
                    }))
                  }
                  className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="none">None</option>
                  <option value="mysql">MySQL</option>
                </select>
              </label>
              <div>
                <span className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">
                  ZIP
                </span>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-600 hover:border-zinc-400">
                  <input
                    type="file"
                    accept=".zip"
                    onChange={(event) =>
                      setChallengeForm((prev) => ({
                        ...prev,
                        zip: extractZipFile(event.target.files),
                      }))
                    }
                    className="sr-only"
                  />
                  <span className="font-semibold">ファイルを選択</span>
                  <span className="truncate text-xs text-zinc-500">
                    {challengeForm.zip ? challengeForm.zip.name : "未選択"}
                  </span>
                </label>
              </div>
              <button
                className="w-full rounded-2xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
                onClick={handleCreateChallenge}
                disabled={loading}
              >
                登録
              </button>
            </div>
          </section>

          <section
            className={`rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-sm transition ${
              isImportDrag ? "ring-2 ring-zinc-900/20" : ""
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsImportDrag(true);
            }}
            onDragLeave={() => setIsImportDrag(false)}
            onDrop={handleImportDrop}
          >
            <h2 className="mb-4 text-lg font-semibold text-zinc-900">Import Pack</h2>
            <div className="space-y-3 text-sm">
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-600 hover:border-zinc-400">
                <input
                  type="file"
                  accept=".zip"
                  onChange={(event) => setImportZip(extractZipFile(event.target.files))}
                  className="sr-only"
                />
                <span className="font-semibold">ファイルを選択</span>
                <span className="truncate text-xs text-zinc-500">
                  {importZip ? importZip.name : "未選択"}
                </span>
              </label>
              <button
                className="w-full rounded-2xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:border-zinc-400"
                onClick={handleImport}
                disabled={loading}
              >
                インポート
              </button>
            </div>
          </section>

        </aside>

        <section className="rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-sm">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900">Challenges</h2>
            </div>
            <div className="space-y-3">
              {challenges.length === 0 && (
                <p className="text-sm text-zinc-500">まだ登録されていません。</p>
              )}
              {challenges.map((challenge) => {
                const detail = details[challenge.id];
                const instance = detail?.instances[0];
                const openDisabled = !instance || instance.status !== "running";
                const statusLabel = instance ? instance.status.toUpperCase() : "IDLE";
                const portLabel = instance ? `Port ${instance.host_port}` : "未起動";
                return (
                  <div
                    key={challenge.id}
                    className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-semibold text-zinc-900">
                            {challenge.name}
                          </h3>
                          <span className="text-xs uppercase tracking-wide text-zinc-500">
                            {challenge.runtime}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500">
                          DB: {challenge.db_type} · {new Date(challenge.created_at).toLocaleString()}
                        </p>
                        <p className="mt-2 text-xs font-semibold text-zinc-700">
                          {statusLabel} · {portLabel}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-600 hover:border-zinc-400"
                          onClick={() => handleStart(challenge.id)}
                          disabled={loading || instance?.status === "running"}
                        >
                          Start
                        </button>
                        <button
                          className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-600 hover:border-zinc-400"
                          onClick={() => handleLogs(challenge.id)}
                          disabled={loading || !instance}
                        >
                          Logs
                        </button>
                        <button
                          className={`rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold transition ${
                            openDisabled
                              ? "cursor-not-allowed text-zinc-300"
                              : "text-zinc-600 hover:border-zinc-400"
                          }`}
                          onClick={() => instance && handleOpen(instance.host_port)}
                          disabled={openDisabled}
                        >
                          Open
                        </button>
                        <button
                          className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-600 hover:border-zinc-400"
                          onClick={() => handleStop(challenge.id)}
                          disabled={loading || !instance || instance.status !== "running"}
                        >
                          Stop
                        </button>
                        <button
                          className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-600 hover:border-zinc-400"
                          onClick={() => handleExport(challenge.id)}
                          disabled={loading}
                        >
                          Export
                        </button>
                        <button
                          className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-500 hover:border-red-300"
                          onClick={() => handleDeleteChallenge(challenge.id)}
                          disabled={loading}
                        >
                          Delete Challenge
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-3 text-xs text-zinc-500">
              スタート後は <span className="font-mono">http://127.0.0.1:&lt;port&gt;/</span> を開きます。
            </div>
          </div>
        </section>
      </div>

      {logsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-3xl rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-900">Logs</h3>
              <button
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-600"
                onClick={() => setLogsOpen(false)}
              >
                Close
              </button>
            </div>
            <pre className="mt-4 max-h-[60vh] overflow-auto rounded-2xl bg-zinc-900 p-4 text-xs text-emerald-100">
{logsText}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
