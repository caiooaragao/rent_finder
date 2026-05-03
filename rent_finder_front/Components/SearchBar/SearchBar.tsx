"use client";

import * as React from "react";
import {
  LocationCity,
  LocationOn,
  MapsHomeWorkOutlined,
  SearchOutlined,
} from "@mui/icons-material";
import {
  searchBarOptionKey,
  type SearchBarOption,
} from "@/lib/searchBarOption";
import {
  LISTING_SEARCH_SCOPE_LABELS,
  type ListingSearchScope,
  searchPlaceholderForScope,
} from "@/lib/listingSearchScope";
import { searchBarNoOptionsText } from "@/lib/searchBarCopy";

/** Motivos de mudança do texto (equivalente ao fluxo anterior com Autocomplete). */
export type SearchBarInputChangeReason = "input" | "clear" | "reset";

export interface SearchBarProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onInputChangeReason?: (
    value: string,
    reason: SearchBarInputChangeReason,
  ) => void;
  onSubmit?: (query: string) => void;
  suggestions?: SearchBarOption[];
  onSelectSuggestion?: (suggestion: SearchBarOption) => void;
  onSuggestionHover?: (suggestion: SearchBarOption | null) => void;
  searchScope?: ListingSearchScope;
  onSearchScopeChange?: (scope: ListingSearchScope) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

export function SearchBar({
  value: valueProp,
  defaultValue = "",
  onChange,
  onInputChangeReason,
  onSubmit,
  suggestions = [],
  onSelectSuggestion,
  onSuggestionHover,
  searchScope = "tudo",
  onSearchScopeChange,
  placeholder: placeholderProp,
  className,
  id = "search-bar-input",
}: SearchBarProps) {
  const placeholder =
    placeholderProp ?? searchPlaceholderForScope(searchScope);
  const [internal, setInternal] = React.useState(defaultValue);
  const isControlled = valueProp !== undefined;
  const value = isControlled ? valueProp : internal;

  const setValue = (next: string) => {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  };

  const [focused, setFocused] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const listboxId = `${id}-listbox`;

  const scopeOptions = React.useMemo(
    () =>
      (["bairro", "cidade", "tudo"] as const).map((s) => ({
        value: s,
        label: LISTING_SEARCH_SCOPE_LABELS[s],
      })),
    [],
  );

  const showPanel =
    focused &&
    (searchScope === "bairro" || searchScope === "cidade"
      ? true
      : suggestions.length > 0 || value.trim().length > 0);

  const showNoOptions = showPanel && suggestions.length === 0;
  const noOptionsLabel = searchBarNoOptionsText(searchScope);

  React.useEffect(() => {
    setHighlightedIndex(-1);
  }, [suggestions]);

  React.useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setFocused(false);
        setHighlightedIndex(-1);
        onSuggestionHover?.(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onSuggestionHover]);

  const emitInputChange = (next: string, reason: SearchBarInputChangeReason) => {
    setValue(next);
    onInputChangeReason?.(next, reason);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    if (next === "" && value !== "") {
      emitInputChange("", "clear");
    } else {
      emitInputChange(next, "input");
    }
    setHighlightedIndex(-1);
  };

  const selectOption = (option: SearchBarOption) => {
    onSelectSuggestion?.(option);
    setFocused(false);
    setHighlightedIndex(-1);
    onSuggestionHover?.(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showPanel) {
      if (e.key === "Enter") {
        e.preventDefault();
        onSubmit?.(value.trim());
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setFocused(false);
      setHighlightedIndex(-1);
      onSuggestionHover?.(null);
      return;
    }

    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) => {
          const next = i < suggestions.length - 1 ? i + 1 : 0;
          if (suggestions[next]) onSuggestionHover?.(suggestions[next]);
          return next;
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => {
          const next = i > 0 ? i - 1 : suggestions.length - 1;
          if (suggestions[next]) onSuggestionHover?.(suggestions[next]);
          return next;
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const idx = highlightedIndex >= 0 ? highlightedIndex : 0;
        if (suggestions[idx]) selectOption(suggestions[idx]);
        else onSubmit?.(value.trim());
        return;
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSubmit?.(value.trim());
    }
  };

  React.useEffect(() => {
    if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
      onSuggestionHover?.(suggestions[highlightedIndex]);
    }
  }, [highlightedIndex, suggestions, onSuggestionHover]);

  return (
    <div
      ref={containerRef}
      className={`flex w-full flex-col gap-2 ${className ?? ""}`}
    >
      <div className="relative w-full">
        <div className="flex items-center gap-1 rounded-lg border border-[var(--rf-search-dropdown-border)] bg-[var(--rf-search-input-bg)] px-2 py-1.5 pl-2">
          <span className="flex size-[18px] shrink-0 items-center justify-center text-[var(--rf-text-secondary)]">
            <SearchOutlined className="!text-[18px]" />
          </span>
          <input
            id={id}
            name="q"
            type="search"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={showPanel ? listboxId : undefined}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            autoComplete="off"
            placeholder={placeholder}
            aria-label="Buscar imóveis"
            value={value}
            onChange={handleInputChange}
            onFocus={() => {
              setFocused(true);
              setHighlightedIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            className="min-w-0 flex-1 border-0 bg-transparent py-0.5 text-[0.8125rem] leading-snug text-foreground outline-none ring-0 placeholder:text-[var(--rf-text-secondary)]"
          />
        </div>

        {showPanel ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Sugestões"
            onMouseLeave={() => onSuggestionHover?.(null)}
            className="absolute left-0 right-0 top-full z-[1400] mt-1 max-h-80 overflow-y-auto rounded-lg border border-[var(--rf-search-dropdown-border)] bg-[var(--rf-search-dropdown-bg)] py-1.5 text-[0.8125rem] shadow-[var(--rf-shadow-dropdown)]"
          >
            {showNoOptions ? (
              <li
                role="presentation"
                className="px-3 py-2 text-[0.75rem] text-[var(--rf-text-secondary)]"
              >
                {noOptionsLabel}
              </li>
            ) : (
              suggestions.map((option, index) => {
                const Icon =
                  option.kind === "cidade"
                    ? LocationCity
                    : option.kind === "bairro"
                      ? LocationOn
                      : MapsHomeWorkOutlined;
                const selected = index === highlightedIndex;
                return (
                  <li
                    key={searchBarOptionKey(option)}
                    role="option"
                    aria-selected={selected}
                    id={`${id}-opt-${searchBarOptionKey(option)}`}
                    className={`mx-1 my-0.5 cursor-pointer rounded-md px-0.5 py-1 ${
                      selected ? "bg-black/[0.06] dark:bg-white/[0.08]" : ""
                    }`}
                    onMouseEnter={() => {
                      setHighlightedIndex(index);
                      onSuggestionHover?.(option);
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectOption(option);
                    }}
                  >
                    <div className="flex w-full items-start gap-1 px-0.5">
                      <div
                        aria-hidden
                        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--rf-primary-soft-bg)] text-[var(--rf-primary-main)]"
                      >
                        <Icon className="text-[0.8125rem]" />
                      </div>
                      <div className="min-w-0 flex-1 pt-px">
                        <p className="text-[0.75rem] font-medium leading-snug tracking-tight">
                          {option.primaryLabel}
                        </p>
                        <p className="mt-0.5 block text-[0.6875rem] leading-snug text-[var(--rf-text-secondary)]">
                          {option.secondaryLabel}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </div>

      {onSearchScopeChange ? (
        <div className="flex flex-col gap-1.5">
          <span
            className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--rf-text-secondary)]"
            id={`${id}-scope-label`}
          >
            Buscando por
          </span>
          <div
            className="flex flex-col gap-1.5"
            role="radiogroup"
            aria-labelledby={`${id}-scope-label`}
          >
            {scopeOptions.map(({ value: scopeValue, label }) => {
              const selected = searchScope === scopeValue;
              return (
                <button
                  key={scopeValue}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={label}
                  onClick={() => onSearchScopeChange(scopeValue)}
                  className={`cursor-pointer rounded-lg border px-2 py-1 text-left text-[0.75rem] leading-snug transition-colors duration-200 ${
                    selected
                      ? "border-[var(--rf-primary-main)] bg-[var(--rf-primary-soft-bg)] text-foreground hover:border-[var(--rf-primary-dark)] hover:bg-[var(--rf-search-scope-selected-hover-bg)]"
                      : "border-[var(--rf-search-dropdown-border)] bg-transparent text-foreground hover:border-[var(--rf-search-scope-hover-border)] hover:bg-[var(--rf-sidebar-hover)]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default SearchBar;
