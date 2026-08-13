import { useEffect, useMemo, useRef, useState } from "react";
import { getPokemonDetails, getPokemonList, searchPokemon } from "@/lib/pokeapi";
import type { PokemonApiSummary, PokemonSelection } from "@/lib/types";
import PokemonSprite from "@/components/PokemonSprite";

type PokemonAutocompleteProps = {
  value: string;
  onChange: (nextValue: string) => void;
  onSelect?: (selection: PokemonSelection) => void;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
};

export default function PokemonAutocomplete({
  value,
  onChange,
  onSelect,
  disabled = false,
  placeholder = "Pokémon suchen…",
  label,
}: PokemonAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [options, setOptions] = useState<PokemonApiSummary[]>([]);
  const sourceListRef = useRef<PokemonApiSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadList = async () => {
      try {
        const list = await getPokemonList();
        if (!mounted) return;
        setOptions(list);
        sourceListRef.current = list;
        setIsLoaded(true);
      } catch {
        if (!mounted) return;
        setError("PokéAPI momentan nicht erreichbar.");
        setIsLoaded(true);
      }
    };

    void loadList();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!value.trim()) {
      setOptions([]);
      setOpen(false);
      setHighlightedIndex(0);
      return;
    }

    const handleSearch = async () => {
      try {
        const matches = await searchPokemon(value, sourceListRef.current.length > 0 ? sourceListRef.current : undefined);
        setOptions(matches);
        setHighlightedIndex(0);
        setOpen(matches.length > 0);
      } catch {
        setError("Pokémon-Liste konnte nicht geladen werden.");
      }
    };

    if (options.length > 0 || isLoaded) {
      void handleSearch();
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const suggestions = useMemo(() => {
    if (!value.trim()) return [];
    return options.slice(0, 10);
  }, [options, value]);

  const chooseOption = async (option: PokemonApiSummary) => {
    const nextValue = option.displayName ?? option.name;
    onChange(nextValue);
    setOpen(false);

    if (onSelect) {
      const details = await getPokemonDetails(option.name);

      if (details) {
        onSelect(details);
      } else {
        onSelect({
          id: option.id,
          name: option.name,
          apiName: option.name,
          displayName: option.displayName ?? option.name,
          spriteUrl: option.spriteUrl,
          types: [],
          abilities: [],
        });
      }
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) => (current + 1) % suggestions.length);
      setOpen(true);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
      setOpen(true);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selected = suggestions[highlightedIndex];
      if (selected) {
        void chooseOption(selected);
      }
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      setHighlightedIndex(0);
    }
  };

  return (
    <div className="pokemonAutocomplete" ref={wrapperRef}>
      {label && <label>{label}</label>}
      <input
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue);
          setOpen(Boolean(nextValue.trim()) && suggestions.length > 0);
        }}
        onFocus={() => {
          if (value.trim() && suggestions.length > 0) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
      />

      {error && <small className="autocompleteError">{error}</small>}

      {open && suggestions.length > 0 && (
        <div className="autocompleteDropdown" role="listbox" aria-label="Pokémonvorschläge">
          {suggestions.map((option, index) => (
            <button
              key={`${option.name}-${index}`}
              type="button"
              className={index === highlightedIndex ? "autocompleteItem active" : "autocompleteItem"}
              onMouseDown={(event) => {
                event.preventDefault();
                void chooseOption(option);
              }}
            >
              <PokemonSprite spriteUrl={option.spriteUrl} alt={option.name} size={32} />
              <span><strong>{option.displayName ?? option.name}</strong><small>#{option.id ?? "—"}{option.displayName ? ` · ${option.name}` : ""}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
