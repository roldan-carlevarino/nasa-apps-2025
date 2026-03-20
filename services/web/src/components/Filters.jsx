import { useState, useMemo, useRef, useEffect, useCallback } from 'react';

// Custom searchable dropdown (combobox) with inline search where the option
// "Todos los municipios" lives. Replaces native <select> + external search.
export default function Filters({ onChange, municipios = [], value = "" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0); // index inside rendered options incl. "Todos"
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Build filtered list (excluding the synthetic "Todos" which we prepend later)
  const filteredMunicipios = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return municipios;
    return municipios.filter(m => m.toLowerCase().includes(q));
  }, [query, municipios]);

  // Combined options: first synthetic global option.
  const options = useMemo(() => ["", ...filteredMunicipios.slice(0, 600)], [filteredMunicipios]);

  // When the external value changes (e.g., map click) reflect in query unless user is typing.
  useEffect(() => {
    if (!open) {
      if (!value) {
        setQuery("");
      } else {
        setQuery(value);
      }
    }
  }, [value, open]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    // Reset highlight when options change
    setHighlight(0);
  }, [query]);

  const selectValue = useCallback((val) => {
    onChange(val);
    setOpen(false);
    if (val === "") {
      setQuery("");
    } else {
      setQuery(val);
    }
  }, [onChange]);

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      setTimeout(() => setHighlight(0), 0);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(options.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = options[highlight];
      selectValue(chosen);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const displayLabel = value || "";
  const placeholder = "Todos los municipios";

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex items-center">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls="municipios-listbox"
          aria-autocomplete="list"
          placeholder={placeholder}
          value={open ? query : (displayLabel || "")}
          onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="p-2 rounded border border-blue-200 shadow focus:ring-2 focus:ring-blue-400 focus:outline-none bg-white text-blue-900 text-sm w-56 pr-8"
        />
        { (value || query) && (
          <button
            type="button"
            onClick={() => { setQuery(""); selectValue(""); inputRef.current?.focus(); setOpen(true); }}
            className="-ml-8 text-blue-500 hover:text-blue-700 focus:outline-none"
            aria-label="Limpiar selección"
          >✕</button>
        )}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label="Abrir"
          className="-ml-6 mr-1 text-blue-500 hover:text-blue-700 focus:outline-none"
        >▾</button>
      </div>
      {open && (
        <ul
          id="municipios-listbox"
          role="listbox"
          className="absolute z-[3000] mt-1 max-h-72 w-full overflow-auto rounded border border-blue-200 bg-white shadow-xl text-sm"
        >
          {/* Synthetic 'Todos' option */}
          <li
            role="option"
            aria-selected={value === ""}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectValue("")}
            className={`cursor-pointer px-3 py-2 border-b border-blue-50 ${highlight === 0 ? 'bg-blue-100 text-blue-900' : 'hover:bg-blue-50'} ${value === '' ? 'font-semibold' : ''}`}
          >
            {placeholder}
          </li>
          {filteredMunicipios.length === 0 && (
            <li className="px-3 py-2 text-blue-400 select-none">Sin coincidencias</li>
          )}
          {filteredMunicipios.slice(0,600).map((m, idx) => {
            const absoluteIndex = idx + 1; // offset because of synthetic first option
            const selected = value === m;
            return (
              <li
                key={m}
                role="option"
                aria-selected={selected}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectValue(m)}
                className={`cursor-pointer px-3 py-1.5 ${highlight === absoluteIndex ? 'bg-blue-100 text-blue-900' : 'hover:bg-blue-50'} ${selected ? 'font-medium' : ''}`}
                onMouseEnter={() => setHighlight(absoluteIndex)}
              >
                {m}
              </li>
            );
          })}
          {filteredMunicipios.length > 600 && (
            <li className="px-3 py-1 text-xs text-blue-400 bg-blue-50 sticky bottom-0">Mostrando primeras 600 coincidencias… refine búsqueda</li>
          )}
        </ul>
      )}
    </div>
  );
}
