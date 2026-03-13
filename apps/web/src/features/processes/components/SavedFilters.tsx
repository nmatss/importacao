import { useState, useEffect, useCallback } from 'react';
import { Bookmark, BookmarkCheck, Trash2, Plus, X, ChevronDown } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────

export interface FilterPreset {
  id: string;
  name: string;
  filters: {
    status?: string;
    brand?: string;
    search?: string;
  };
  createdAt: string;
}

interface SavedFiltersProps {
  currentFilters: {
    status?: string;
    brand?: string;
    search?: string;
  };
  onApplyFilter: (filters: FilterPreset['filters']) => void;
  className?: string;
}

// ── Storage helpers ─────────────────────────────────────────────────────

const STORAGE_KEY = 'importacao_saved_filters';

function loadPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePresets(presets: FilterPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

// ── Component ────────────────────────────────────────────────────────────

export function SavedFilters({ currentFilters, onApplyFilter, className }: SavedFiltersProps) {
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  const hasActiveFilters = Boolean(currentFilters.status || currentFilters.brand || currentFilters.search);

  const handleSave = useCallback(() => {
    if (!newName.trim() || !hasActiveFilters) return;

    const preset: FilterPreset = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: newName.trim(),
      filters: { ...currentFilters },
      createdAt: new Date().toISOString(),
    };

    const updated = [...presets, preset];
    setPresets(updated);
    savePresets(updated);
    setNewName('');
    setShowSaveForm(false);
  }, [newName, currentFilters, presets, hasActiveFilters]);

  const handleDelete = useCallback(
    (id: string) => {
      const updated = presets.filter((p) => p.id !== id);
      setPresets(updated);
      savePresets(updated);
    },
    [presets],
  );

  const handleApply = useCallback(
    (preset: FilterPreset) => {
      onApplyFilter(preset.filters);
      setIsOpen(false);
    },
    [onApplyFilter],
  );

  const formatFilterSummary = (filters: FilterPreset['filters']): string => {
    const parts: string[] = [];
    if (filters.status) parts.push(`Status: ${filters.status}`);
    if (filters.brand) parts.push(`Marca: ${filters.brand}`);
    if (filters.search) parts.push(`Busca: "${filters.search}"`);
    return parts.join(' | ') || 'Sem filtros';
  };

  return (
    <div className={cn('relative', className)}>
      <div className="flex items-center gap-2">
        {/* Dropdown trigger */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
            presets.length > 0
              ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
          )}
        >
          <Bookmark className="h-4 w-4" />
          Filtros Salvos
          {presets.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-blue-600 text-white text-xs">
              {presets.length}
            </span>
          )}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
        </button>

        {/* Save current filter button */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => setShowSaveForm(!showSaveForm)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Salvar Filtro Atual
          </button>
        )}
      </div>

      {/* Save form */}
      {showSaveForm && (
        <div className="absolute top-full left-0 mt-2 z-20 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-slate-900">Salvar Filtro</p>
            <button type="button" onClick={() => setShowSaveForm(false)}>
              <X className="h-4 w-4 text-slate-400" />
            </button>
          </div>
          <div className="mb-3">
            <p className="text-xs text-slate-500 mb-2">{formatFilterSummary(currentFilters)}</p>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome do filtro..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={!newName.trim()}
            className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Salvar
          </button>
        </div>
      )}

      {/* Presets dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 z-20 w-80 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          {presets.length === 0 ? (
            <div className="p-6 text-center">
              <Bookmark className="h-6 w-6 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">Nenhum filtro salvo</p>
              <p className="text-xs text-slate-400 mt-1">
                Aplique filtros e clique em "Salvar Filtro Atual"
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center justify-between gap-2 p-3 hover:bg-slate-50 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => handleApply(preset)}
                    className="flex-1 text-left min-w-0"
                  >
                    <p className="text-sm font-medium text-slate-900 truncate">{preset.name}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {formatFilterSummary(preset.filters)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(preset.id);
                    }}
                    className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Click-away overlay */}
      {(isOpen || showSaveForm) && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => {
            setIsOpen(false);
            setShowSaveForm(false);
          }}
        />
      )}
    </div>
  );
}
