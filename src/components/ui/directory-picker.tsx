"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Folder,
  FolderGit2,
  ChevronUp,
  Loader2,
  Check,
  X,
} from "lucide-react";

interface DirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

interface DirectoryPickerProps {
  onSelect: (path: string) => void;
  onCancel: () => void;
  gitOnly?: boolean;
}

export function DirectoryPicker({ onSelect, onCancel, gitOnly }: DirectoryPickerProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState("");

  const browse = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = path ? `?path=${encodeURIComponent(path)}` : "";
      const res = await fetch(`/api/filesystem${params}`);
      if (!res.ok) {
        setError("Cannot read directory");
        return;
      }
      const data = await res.json();
      setCurrentPath(data.current);
      setParentPath(data.parent);
      setManualPath(data.current);
      setEntries(data.entries);
    } catch {
      setError("Failed to browse");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { browse(); }, [browse]);

  const handleSelect = (path: string) => {
    onSelect(path);
  };

  const handleNavigate = (path: string) => {
    browse(path);
  };

  const handleManualGo = () => {
    if (manualPath.trim()) browse(manualPath.trim());
  };

  return (
    <div className="border border-accent/30 bg-surface space-y-0">
      {/* Path bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40">
        <input
          type="text"
          value={manualPath}
          onChange={(e) => setManualPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleManualGo()}
          className="flex-1 bg-background border border-border px-2 py-1 text-[13px] font-mono text-foreground outline-none focus:border-accent"
          placeholder="/path/to/directory"
        />
        <button
          onClick={handleManualGo}
          className="text-[12px] font-mono text-accent hover:text-accent-dim"
        >
          go
        </button>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 text-[12px] font-mono text-red">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
        </div>
      )}

      {/* Directory listing */}
      {!loading && (
        <div className="max-h-64 overflow-y-auto">
          {/* Parent directory */}
          {parentPath && (
            <button
              onClick={() => handleNavigate(parentPath)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-hover transition-colors"
            >
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[13px] font-mono text-muted-foreground">..</span>
            </button>
          )}

          {entries.map((entry) => (
            <div
              key={entry.path}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover transition-colors group"
            >
              {/* Navigate into directory */}
              <button
                onClick={() => handleNavigate(entry.path)}
                className="flex items-center gap-2 flex-1 text-left min-w-0"
              >
                {entry.isGitRepo ? (
                  <FolderGit2 className="h-3.5 w-3.5 text-accent shrink-0" />
                ) : (
                  <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <span className={`text-[13px] font-mono truncate ${entry.isGitRepo ? "text-foreground" : "text-muted-foreground"}`}>
                  {entry.name}
                </span>
                {entry.isGitRepo && (
                  <span className="text-[10px] font-mono text-accent border border-accent/30 px-1 shrink-0">
                    git
                  </span>
                )}
              </button>

              {/* Select button */}
              {(!gitOnly || entry.isGitRepo) && (
                <button
                  onClick={() => handleSelect(entry.path)}
                  className="opacity-0 group-hover:opacity-100 text-accent hover:text-accent-dim transition-all shrink-0"
                  title="Select this directory"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}

          {entries.length === 0 && (
            <div className="px-3 py-4 text-[12px] font-mono text-muted text-center">
              empty directory
            </div>
          )}
        </div>
      )}

      {/* Select current directory */}
      {!loading && currentPath && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-border/40">
          <span className="text-[11px] font-mono text-muted truncate mr-2">
            {currentPath}
          </span>
          <button
            onClick={() => handleSelect(currentPath)}
            className="text-[12px] font-mono text-accent hover:underline whitespace-nowrap"
          >
            select this folder
          </button>
        </div>
      )}
    </div>
  );
}
