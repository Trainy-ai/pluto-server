import { useState, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SparklesIcon } from "lucide-react";
import { makeRegexValue, makeGlobValue, globToRegex } from "./glob-utils";
import { useDistinctFileLogNames, useRunFileLogNames, useSearchFileLogNames, useRegexSearchFileLogNames } from "../../~queries/file-log-names";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import { SYNTHETIC_CONSOLE_ENTRIES } from "./console-log-constants";
import type { FileGroupWidgetConfig } from "../../~types/dashboard-types";
import { MetricResultsList } from "./metric-results-list";
import { RegexSearchPanel } from "./regex-search-panel";
import { SelectedBadges } from "./selected-badges";

interface FilesConfigFormProps {
  config: Partial<FileGroupWidgetConfig>;
  onChange: (config: Partial<FileGroupWidgetConfig>) => void;
  organizationId: string;
  projectName: string;
  selectedRunIds?: string[];
}

export function FilesConfigForm({
  config,
  onChange,
  organizationId,
  projectName,
  selectedRunIds,
}: FilesConfigFormProps) {
  const [fileMode, setFileMode] = useState<"search" | "regex">("search");
  const [regexPattern, setRegexPattern] = useState("");
  const [debouncedRegex, setDebouncedRegex] = useState("");
  const [isInvalidRegex, setIsInvalidRegex] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (regexPattern.trim() && !isInvalidRegex) {
        setDebouncedRegex(regexPattern.trim());
      } else {
        setDebouncedRegex("");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [regexPattern, isInvalidRegex]);

  useEffect(() => {
    if (!regexPattern.trim()) {
      setIsInvalidRegex(false);
      return;
    }
    try {
      new RegExp(regexPattern.trim());
      setIsInvalidRegex(false);
    } catch {
      setIsInvalidRegex(true);
    }
  }, [regexPattern]);

  const { data: regexResults, isFetching: isRegexSearching } =
    useRegexSearchFileLogNames(organizationId, projectName, debouncedRegex);

  const regexFiles = useMemo(() => {
    const backendFiles = regexResults?.files?.map((f) => f.logName) ?? [];
    if (!debouncedRegex) return backendFiles;
    try {
      const re = new RegExp(debouncedRegex);
      const syntheticMatches = SYNTHETIC_CONSOLE_ENTRIES
        .filter((e) => re.test(e.logName))
        .map((e) => e.logName);
      return [...syntheticMatches, ...backendFiles];
    } catch { return backendFiles; }
  }, [regexResults, debouncedRegex]);

  const regexTypeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of SYNTHETIC_CONSOLE_ENTRIES) { map.set(e.logName, e.logType); }
    for (const f of regexResults?.files ?? []) { map.set(f.logName, f.logType); }
    return map;
  }, [regexResults]);

  const selectedValues = config.files ?? [];

  const handleToggle = (file: string) => {
    const current = config.files ?? [];
    if (current.includes(file)) {
      onChange({ ...config, files: current.filter((f) => f !== file) });
    } else {
      onChange({ ...config, files: [...current, file] });
    }
  };

  const handleRegexSelectAll = () => {
    const current = new Set(config.files ?? []);
    for (const f of regexFiles) { current.add(f); }
    onChange({ ...config, files: Array.from(current) });
  };

  const handleApplyRegexDynamic = () => {
    const trimmed = regexPattern.trim();
    if (!trimmed || isInvalidRegex) return;
    const regexVal = makeRegexValue(trimmed);
    const current = config.files ?? [];
    if (!current.includes(regexVal)) {
      onChange({ ...config, files: [...current, regexVal] });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>File Selection Mode</Label>
        <Tabs value={fileMode} onValueChange={(v) => setFileMode(v as "search" | "regex")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="regex">Regex</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {fileMode === "search" ? (
        <SearchFilePanel
          organizationId={organizationId}
          projectName={projectName}
          selectedRunIds={selectedRunIds}
          selectedValues={selectedValues}
          onToggle={handleToggle}
          onSelectAll={(files) => {
            const current = new Set(selectedValues);
            for (const f of files) { current.add(f); }
            onChange({ ...config, files: Array.from(current) });
          }}
          onApplyGlob={(pattern) => {
            const globVal = makeGlobValue(pattern);
            if (!selectedValues.includes(globVal)) {
              onChange({ ...config, files: [...selectedValues, globVal] });
            }
          }}
        />
      ) : (
        <RegexSearchPanel
          regexPattern={regexPattern}
          onRegexChange={setRegexPattern}
          isInvalidRegex={isInvalidRegex}
          isRegexSearching={isRegexSearching}
          regexMetrics={regexFiles}
          selectedValues={selectedValues}
          onToggle={handleToggle}
          onSelectAll={handleRegexSelectAll}
          onApplyDynamic={handleApplyRegexDynamic}
          itemLabel="file"
        />
      )}

      <SelectedBadges
        values={selectedValues}
        onRemove={(v) => onChange({ ...config, files: selectedValues.filter((f) => f !== v) })}
      />
    </div>
  );
}

// Search panel for files — fuzzy + glob search with inline results
function SearchFilePanel({
  organizationId,
  projectName,
  selectedRunIds,
  selectedValues,
  onToggle,
  onSelectAll,
  onApplyGlob,
}: {
  organizationId: string;
  projectName: string;
  selectedRunIds?: string[];
  selectedValues: string[];
  onToggle: (file: string) => void;
  onSelectAll: (files: string[]) => void;
  onApplyGlob: (pattern: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const isGlob = search.includes("*") || search.includes("?");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(isGlob ? search.replace(/[*?]/g, "") : search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, isGlob]);

  const { data: initialFiles, isLoading: isLoadingInitial } =
    useDistinctFileLogNames(organizationId, projectName);
  const { data: runFiles } = useRunFileLogNames(organizationId, projectName, selectedRunIds ?? []);
  const runFileSet = useMemo(() => {
    if (!runFiles?.files) return null;
    const set = new Set(runFiles.files.map((f) => f.logName));
    for (const e of SYNTHETIC_CONSOLE_ENTRIES) { set.add(e.logName); }
    return set;
  }, [runFiles]);
  const { data: searchResults, isFetching: isSearching } =
    useSearchFileLogNames(organizationId, projectName, debouncedSearch);

  const typeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of SYNTHETIC_CONSOLE_ENTRIES) { map.set(f.logName, f.logType); }
    for (const f of initialFiles?.files ?? []) { map.set(f.logName, f.logType); }
    for (const f of searchResults?.files ?? []) { map.set(f.logName, f.logType); }
    for (const f of runFiles?.files ?? []) { map.set(f.logName, f.logType); }
    return map;
  }, [initialFiles, searchResults, runFiles]);

  const filteredFiles = useMemo(() => {
    const syntheticNames = SYNTHETIC_CONSOLE_ENTRIES.map((e) => e.logName);
    const initial = (initialFiles?.files ?? []).map((f) => f.logName);
    const searched = (searchResults?.files ?? []).map((f) => f.logName);
    const merged = Array.from(new Set([...syntheticNames, ...searched, ...initial]));
    const trimmed = search.trim();
    if (!trimmed) return merged.sort((a, b) => a.localeCompare(b));
    if (isGlob) {
      try {
        const regex = globToRegex(trimmed);
        return merged.filter((m) => regex.test(m)).sort((a, b) => a.localeCompare(b));
      } catch { return []; }
    }
    return fuzzyFilter(merged, search);
  }, [initialFiles, searchResults, search, isGlob]);

  const isLoading = isLoadingInitial || isSearching;

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label>Search Files</Label>
        <Input
          placeholder="Search files... (use * or ? for glob patterns)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Fuzzy text search. Use <code>*</code> / <code>?</code> for glob patterns (e.g., <code>distributions/*</code>).
        </p>
      </div>
      <MetricResultsList
        metrics={filteredFiles}
        selectedValues={selectedValues}
        isLoading={isLoading}
        emptyMessage="No files found."
        itemLabel="file"
        typeMap={typeMap}
        onToggle={onToggle}
        onSelectAll={() => onSelectAll(filteredFiles)}
        runMetricSet={runFileSet}
        footer={
          isGlob && search.trim() ? (
            <div className="flex items-center gap-2 border-t px-3 py-2">
              <SparklesIcon className="size-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-xs text-muted-foreground">Apply as dynamic pattern</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-3 text-xs"
                onClick={() => onApplyGlob(search.trim())}
                disabled={selectedValues.includes(makeGlobValue(search.trim()))}
              >
                {selectedValues.includes(makeGlobValue(search.trim())) ? "Applied" : "Apply"}
              </Button>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
